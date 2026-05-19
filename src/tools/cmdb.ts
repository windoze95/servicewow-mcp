import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./registry.js";
import { buildRecordUrl } from "./registry.js";
import type {
  ServiceNowListResponse,
  ServiceNowSingleResponse,
} from "../servicenow/types.js";
import { sanitizeValue } from "../servicenow/queryBuilder.js";
import { validateSysId, normalizeDateBoundary } from "../utils/validators.js";

type WrapHandler = <T>(
  handler: (ctx: ToolContext, args: T) => Promise<unknown>
) => (args: T) => Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
}>;

// cmdb_ci is the parent CMDB table; every CI class (cmdb_ci_server,
// cmdb_ci_db_instance, cmdb_ci_appl, …) extends it, so querying the parent
// surfaces every configuration item in one call. sys_class_name on each row
// identifies the concrete subclass. cmdb_rel_ci holds directed parent→child
// relationships used by dependency mapping.
const CI_TABLE = "cmdb_ci";
const REL_TABLE = "cmdb_rel_ci";

// Reference fields are returned as display values because the shared client
// forces sysparm_display_value=true, so owned_by/location/support_group/etc.
// come back as readable names (the "dot-walked" owner/location/group view).
const CI_SUMMARY_FIELDS = [
  "sys_id",
  "name",
  "sys_class_name",
  "install_status",
  "operational_status",
  "discovery_source",
  "last_discovered",
  "ip_address",
  "fqdn",
  "serial_number",
  "asset_tag",
  "owned_by",
  "managed_by",
  "support_group",
  "assignment_group",
  "location",
  "company",
  "sys_updated_on",
].join(",");

const REL_SUMMARY_FIELDS = [
  "sys_id",
  "parent",
  "child",
  "type",
  "sys_updated_on",
].join(",");

const TICKET_SUMMARY_FIELDS = [
  "sys_id",
  "number",
  "short_description",
  "state",
  "priority",
  "sys_updated_on",
].join(",");

// Tables whose cmdb_ci reference field tells us a CI is actually in use.
const REFERENCE_TABLES: Array<["incidents" | "changes" | "problems", string]> =
  [
    ["incidents", "incident"],
    ["changes", "change_request"],
    ["problems", "problem"],
  ];

interface CiRecord {
  sys_id: string;
  name?: string;
  sys_class_name?: string;
  [key: string]: unknown;
}

interface RelRecord {
  sys_id: string;
  [key: string]: unknown;
}

interface TicketRecord {
  sys_id: string;
  [key: string]: unknown;
}

interface AggregateGroup {
  stats?: { count?: string };
  groupby_fields?: { field: string; value: string; display_value?: string }[];
}

// Link to the concrete subclass table when known (mirrors resolveTable() in
// scheduledJobs.ts for the sysauto parent/subclass hierarchy). cmdb_ci.do also
// resolves to the record's real class form, so the parent table is a safe
// fallback when sys_class_name is absent.
function resolveTable(record: { sys_class_name?: string }): string {
  return record.sys_class_name && record.sys_class_name.length > 0
    ? record.sys_class_name
    : CI_TABLE;
}

export function registerCmdbTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  // search_cis
  server.tool(
    "search_cis",
    "Search the CMDB (cmdb_ci and every subclass: cmdb_ci_server, cmdb_ci_db_instance, cmdb_ci_appl, …) by class, name, discovery source, install status, and last-discovered date range. This is the workhorse for assessing CMDB shape and data quality. Returns a paginated summary list ordered by most recently updated.",
    {
      name: z
        .string()
        .optional()
        .describe("Filter by CI name (LIKE match)"),
      sys_class_name: z
        .string()
        .optional()
        .describe(
          "Filter by exact CI class/table, e.g. 'cmdb_ci_server', 'cmdb_ci_db_instance', 'cmdb_ci_appl'"
        ),
      discovery_source: z
        .string()
        .optional()
        .describe(
          "Filter by discovery_source, e.g. 'ServiceNow', 'SCCM', 'JDBC'"
        ),
      install_status: z
        .string()
        .optional()
        .describe(
          "Filter by install_status value (numeric value, not label), e.g. '1' (Installed), '7' (Retired)"
        ),
      last_discovered_after: z
        .string()
        .optional()
        .describe(
          "Only CIs last discovered on/after this date. YYYY-MM-DD or ISO 8601 (with timezone)."
        ),
      last_discovered_before: z
        .string()
        .optional()
        .describe(
          "Only CIs last discovered on/before this date. YYYY-MM-DD or ISO 8601 (with timezone)."
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum results"),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Result offset for pagination"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          name?: string;
          sys_class_name?: string;
          discovery_source?: string;
          install_status?: string;
          last_discovered_after?: string;
          last_discovered_before?: string;
          limit: number;
          offset: number;
        }
      ) => {
        const queryParts: string[] = [];

        if (args.name) {
          queryParts.push(`nameLIKE${sanitizeValue(args.name)}`);
        }
        if (args.sys_class_name) {
          queryParts.push(
            `sys_class_name=${sanitizeValue(args.sys_class_name)}`
          );
        }
        if (args.discovery_source) {
          queryParts.push(
            `discovery_source=${sanitizeValue(args.discovery_source)}`
          );
        }
        if (args.install_status) {
          queryParts.push(
            `install_status=${sanitizeValue(args.install_status)}`
          );
        }

        const dateFilters: Array<
          [string | undefined, "from" | "to", string]
        > = [
          [args.last_discovered_after, "from", ">="],
          [args.last_discovered_before, "to", "<="],
        ];
        for (const [raw, boundary, op] of dateFilters) {
          if (!raw) continue;
          const normalized = normalizeDateBoundary(raw, boundary);
          if (!normalized) {
            return {
              success: false,
              error: {
                code: "VALIDATION_ERROR",
                message: `Invalid date for last_discovered_${boundary === "from" ? "after" : "before"}: ${raw}. Use YYYY-MM-DD or ISO 8601.`,
              },
            };
          }
          queryParts.push(
            `last_discovered${op}${sanitizeValue(normalized)}`
          );
        }

        queryParts.push("ORDERBYDESCsys_updated_on");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<CiRecord>
        >(`/api/now/table/${CI_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields: CI_SUMMARY_FIELDS,
          },
        });

        return {
          success: true,
          data: data.result.map((r) => ({
            ...r,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              resolveTable(r),
              r.sys_id
            ),
          })),
          metadata: {
            total_count: parseInt(headers["x-total-count"] || "0", 10),
            returned_count: data.result.length,
            offset: args.offset,
          },
        };
      }
    )
  );

  // get_ci
  server.tool(
    "get_ci",
    "Get the full record for one configuration item by sys_id. Fetched from the cmdb_ci parent without a field restriction so every column on the CI's concrete subclass is returned; reference fields (owned_by, managed_by, location, support_group, assignment_group) come back as readable display values.",
    {
      sys_id: z
        .string()
        .describe("Configuration item sys_id (32 hex chars)"),
    },
    wrapHandler(async (ctx: ToolContext, args: { sys_id: string }) => {
      if (!validateSysId(args.sys_id)) {
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "sys_id must be a 32-character sys_id",
          },
        };
      }

      const { data } = await ctx.snClient.get<
        ServiceNowSingleResponse<CiRecord>
      >(`/api/now/table/${CI_TABLE}/${args.sys_id}`);

      return {
        success: true,
        data: {
          ...data.result,
          self_link: buildRecordUrl(
            ctx.instanceUrl,
            resolveTable(data.result),
            data.result.sys_id
          ),
        },
      };
    })
  );

  // get_ci_relationships
  server.tool(
    "get_ci_relationships",
    "Read cmdb_rel_ci for a configuration item in both directions: rows where the CI is the parent (parent_of) and rows where it is the child (child_of). Use this to assess dependency-mapping coverage and relationship health for a CI. Returns up to `limit` rows per direction with per-direction truncation flags.",
    {
      sys_id: z
        .string()
        .describe("Configuration item sys_id (32 hex chars)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(200)
        .describe("Maximum relationship rows per direction"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: { sys_id: string; limit: number }
      ) => {
        if (!validateSysId(args.sys_id)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "sys_id must be a 32-character sys_id",
            },
          };
        }

        // parent=<ci> ⇒ the CI is the parent of each row's child;
        // child=<ci>  ⇒ the CI is the child of each row's parent.
        const fetchRel = async (field: "parent" | "child") => {
          const { data, headers } = await ctx.snClient.get<
            ServiceNowListResponse<RelRecord>
          >(`/api/now/table/${REL_TABLE}`, {
            params: {
              sysparm_query: `${field}=${args.sys_id}^ORDERBYDESCsys_updated_on`,
              sysparm_limit: args.limit,
              sysparm_fields: REL_SUMMARY_FIELDS,
            },
          });
          const totalCount = parseInt(
            headers["x-total-count"] || "0",
            10
          );
          return {
            rows: data.result.map((r) => ({
              ...r,
              self_link: buildRecordUrl(
                ctx.instanceUrl,
                REL_TABLE,
                r.sys_id
              ),
            })),
            metadata: {
              total_count: totalCount,
              returned_count: data.result.length,
              truncated: totalCount > data.result.length,
            },
          };
        };

        const asParent = await fetchRel("parent");
        const asChild = await fetchRel("child");

        return {
          success: true,
          data: {
            ci_sys_id: args.sys_id,
            parent_of: asParent.rows,
            child_of: asChild.rows,
            metadata: {
              parent_of: asParent.metadata,
              child_of: asChild.metadata,
            },
          },
        };
      }
    )
  );

  // count_cis_by_class
  server.tool(
    "count_cis_by_class",
    "Aggregate the entire CMDB by class via the ServiceNow Aggregate API (/api/now/stats/cmdb_ci grouped by sys_class_name with counts). One call returns the shape of the whole CMDB: a count per CI class sorted by count descending, plus the grand total and number of populated classes.",
    {},
    wrapHandler(async (ctx: ToolContext) => {
      const { data } = await ctx.snClient.get<{
        result: AggregateGroup[] | AggregateGroup;
      }>(`/api/now/stats/${CI_TABLE}`, {
        params: {
          sysparm_group_by: "sys_class_name",
          sysparm_count: true,
        },
      });

      const groups = Array.isArray(data.result)
        ? data.result
        : data.result
          ? [data.result]
          : [];

      const classes = groups
        .map((g) => {
          const gb =
            g.groupby_fields?.find(
              (f) => f.field === "sys_class_name"
            ) ?? g.groupby_fields?.[0];
          const count = parseInt(g.stats?.count ?? "0", 10);
          return {
            sys_class_name: gb?.value ?? "",
            label: gb?.display_value ?? gb?.value ?? "",
            count: Number.isFinite(count) ? count : 0,
          };
        })
        .filter((c) => c.sys_class_name.length > 0)
        .sort((a, b) => b.count - a.count);

      const total = classes.reduce((sum, c) => sum + c.count, 0);

      return {
        success: true,
        data: {
          classes,
          metadata: {
            class_count: classes.length,
            total_cis: total,
          },
        },
      };
    })
  );

  // find_stale_cis
  server.tool(
    "find_stale_cis",
    "Find migration-skip candidate CIs by one staleness signal at a time: 'not_recently_discovered' (last_discovered older than stale_after_days), 'retired_but_operational' (install_status Retired yet operational_status Operational), or 'missing_assignment_group' (no assignment_group). Run once per reason. Returns a paginated list with the matching reason echoed in metadata.",
    {
      reason: z
        .enum([
          "not_recently_discovered",
          "retired_but_operational",
          "missing_assignment_group",
        ])
        .describe(
          "Which staleness signal to filter on (run once per reason)"
        ),
      stale_after_days: z
        .number()
        .int()
        .min(1)
        .max(3650)
        .default(90)
        .describe(
          "For reason 'not_recently_discovered': flag CIs whose last_discovered is older than this many days"
        ),
      sys_class_name: z
        .string()
        .optional()
        .describe(
          "Optionally scope to a single CI class/table, e.g. 'cmdb_ci_server'"
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum results"),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Result offset for pagination"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          reason:
            | "not_recently_discovered"
            | "retired_but_operational"
            | "missing_assignment_group";
          stale_after_days: number;
          sys_class_name?: string;
          limit: number;
          offset: number;
        }
      ) => {
        const queryParts: string[] = [];

        if (args.sys_class_name) {
          queryParts.push(
            `sys_class_name=${sanitizeValue(args.sys_class_name)}`
          );
        }

        if (args.reason === "not_recently_discovered") {
          const cutoffMs =
            Date.now() - args.stale_after_days * 24 * 60 * 60 * 1000;
          // Same UTC "YYYY-MM-DD HH:MM:SS" shape ServiceNow encoded queries
          // compare date/time fields against (see normalizeDateBoundary).
          const cutoff = new Date(cutoffMs)
            .toISOString()
            .slice(0, 19)
            .replace("T", " ");
          queryParts.push(`last_discovered<${sanitizeValue(cutoff)}`);
        } else if (args.reason === "retired_but_operational") {
          // install_status 7 = Retired; operational_status 1 = Operational.
          // A retired CI still flagged operational is a data-quality red flag.
          queryParts.push("install_status=7");
          queryParts.push("operational_status=1");
        } else {
          queryParts.push("assignment_groupISEMPTY");
        }

        queryParts.push("ORDERBYDESCsys_updated_on");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<CiRecord>
        >(`/api/now/table/${CI_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields: CI_SUMMARY_FIELDS,
          },
        });

        return {
          success: true,
          data: data.result.map((r) => ({
            ...r,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              resolveTable(r),
              r.sys_id
            ),
          })),
          metadata: {
            reason: args.reason,
            ...(args.reason === "not_recently_discovered"
              ? { stale_after_days: args.stale_after_days }
              : {}),
            total_count: parseInt(headers["x-total-count"] || "0", 10),
            returned_count: data.result.length,
            offset: args.offset,
          },
        };
      }
    )
  );

  // get_ci_ticket_references
  server.tool(
    "get_ci_ticket_references",
    "Count incident, change_request, and problem records that reference a configuration item (via their cmdb_ci field), with a small sample of the most recent of each. Use this to judge which CIs are actually in use versus safe to skip during a migration.",
    {
      sys_id: z
        .string()
        .describe("Configuration item sys_id (32 hex chars)"),
      sample_limit: z
        .number()
        .int()
        .min(0)
        .max(20)
        .default(5)
        .describe(
          "Most-recent sample records to return per ticket type (0 = counts only)"
        ),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: { sys_id: string; sample_limit: number }
      ) => {
        if (!validateSysId(args.sys_id)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "sys_id must be a 32-character sys_id",
            },
          };
        }

        // Resolve the CI first so callers get its identity (and a 404 for an
        // unknown sys_id) before we tally references.
        const { data: ciData } = await ctx.snClient.get<
          ServiceNowSingleResponse<CiRecord>
        >(`/api/now/table/${CI_TABLE}/${args.sys_id}`, {
          params: { sysparm_fields: "sys_id,name,sys_class_name" },
        });

        const references: Record<
          string,
          { count: number; returned: number; sample: unknown[] }
        > = {};
        let totalReferences = 0;

        for (const [key, table] of REFERENCE_TABLES) {
          const { data, headers } = await ctx.snClient.get<
            ServiceNowListResponse<TicketRecord>
          >(`/api/now/table/${table}`, {
            params: {
              sysparm_query: `cmdb_ci=${args.sys_id}^ORDERBYDESCsys_updated_on`,
              sysparm_limit: args.sample_limit,
              sysparm_fields: TICKET_SUMMARY_FIELDS,
            },
          });
          // X-Total-Count reflects all matching records regardless of the page
          // size, so sample_limit=0 still yields an accurate count.
          const count = parseInt(headers["x-total-count"] || "0", 10);
          totalReferences += count;
          references[key] = {
            count,
            returned: data.result.length,
            sample: data.result.map((r) => ({
              ...r,
              self_link: buildRecordUrl(
                ctx.instanceUrl,
                table,
                r.sys_id
              ),
            })),
          };
        }

        return {
          success: true,
          data: {
            ci: {
              ...ciData.result,
              self_link: buildRecordUrl(
                ctx.instanceUrl,
                resolveTable(ciData.result),
                ciData.result.sys_id
              ),
            },
            references,
            metadata: {
              total_references: totalReferences,
            },
          },
        };
      }
    )
  );
}

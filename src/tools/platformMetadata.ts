import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./registry.js";
import { buildRecordUrl } from "./registry.js";
import type {
  ServiceNowListResponse,
  ServiceNowSingleResponse,
} from "../servicenow/types.js";
import { sanitizeValue } from "../servicenow/queryBuilder.js";
import { validateSysId } from "../utils/validators.js";

type WrapHandler = <T>(
  handler: (ctx: ToolContext, args: T) => Promise<unknown>
) => (args: T) => Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
}>;

// Business rules live on sys_script. `collection` is the table the rule runs on,
// `when` is the execution phase (before/after/async/display), and the logic is in
// the script / condition / filter_condition fields. The boolean action_* flags
// say which DB operations the rule fires on.
const BUSINESS_RULE_TABLE = "sys_script";
const BUSINESS_RULE_SUMMARY_FIELDS = [
  "sys_id",
  "name",
  "collection",
  "when",
  "order",
  "active",
  "action_insert",
  "action_update",
  "action_delete",
  "action_query",
  "advanced",
  "sys_updated_on",
].join(",");

// A list view's column layout (sys_ui_list) and its ordered columns
// (sys_ui_list_element, joined via list_id). The row *filter* for a list is NOT
// stored here — it lives on the navigator module (sys_app_module.filter); see
// search_navigator_modules.
const LIST_TABLE = "sys_ui_list";
const LIST_ELEMENT_TABLE = "sys_ui_list_element";
const LIST_SUMMARY_FIELDS = [
  "sys_id",
  "name",
  "view",
  "sys_user",
  "parent",
  "relationship",
  "label",
  "sys_updated_on",
].join(",");
const LIST_ELEMENT_FIELDS = ["sys_id", "element", "position"].join(",");

// Application navigator modules. For a "List of Records" module the target table
// is stored in `name` (a ServiceNow quirk — `title` is the human label) and the
// row filter is the encoded query in `filter`.
const MODULE_TABLE = "sys_app_module";
const MODULE_SUMMARY_FIELDS = [
  "sys_id",
  "title",
  "name",
  "filter",
  "query",
  "view",
  "application",
  "link_type",
  "active",
  "order",
  "roles",
  "sys_updated_on",
].join(",");

// Flow Designer flow definitions (the header record). Trigger and action
// *instances* link back to the flow via their `flow` reference. Flow Engine V2
// (Washington DC and later) stores those instances in *_v2 tables; earlier
// releases use the base tables, so get_flow_definition tries base then v2.
const FLOW_TABLE = "sys_hub_flow";
const FLOW_SUMMARY_FIELDS = [
  "sys_id",
  "name",
  "description",
  "active",
  "type",
  "run_as",
  "status",
  "sys_scope",
  "sys_updated_on",
].join(",");
const TRIGGER_TABLE = "sys_hub_trigger_instance";
const TRIGGER_TABLE_V2 = "sys_hub_trigger_instance_v2";
const ACTION_TABLE = "sys_hub_action_instance";
const ACTION_TABLE_V2 = "sys_hub_action_instance_v2";

interface SysIdRecord {
  sys_id: string;
  [key: string]: unknown;
}

interface FlowComponentResult {
  table: string;
  rows: Array<SysIdRecord & { self_link: string }>;
  total_count: number;
  returned_count: number;
  truncated: boolean;
}

// Fetch a flow's trigger/action instances. Both instance types reference the
// flow through a `flow` field. The base table is queried first; if it has no
// rows (a Flow Engine V2 flow keeps its instances in the *_v2 table) the v2
// table is tried, tolerating its absence on pre-Washington releases.
async function fetchFlowComponents(
  ctx: ToolContext,
  baseTable: string,
  v2Table: string,
  flowSysId: string,
  limit: number
): Promise<FlowComponentResult> {
  const query = `flow=${flowSysId}^ORDERBYorder`;

  const pack = (
    table: string,
    data: ServiceNowListResponse<SysIdRecord>,
    headers: Record<string, string>
  ): FlowComponentResult => {
    const totalCount = parseInt(headers["x-total-count"] || "0", 10);
    return {
      table,
      rows: data.result.map((r) => ({
        ...r,
        self_link: buildRecordUrl(ctx.instanceUrl, table, r.sys_id),
      })),
      total_count: totalCount,
      returned_count: data.result.length,
      truncated: totalCount > data.result.length,
    };
  };

  const base = await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
    `/api/now/table/${baseTable}`,
    { params: { sysparm_query: query, sysparm_limit: limit } }
  );
  if (base.data.result.length > 0) {
    return pack(baseTable, base.data, base.headers);
  }

  // No rows on the base table — try the Flow Engine V2 table. It does not exist
  // on releases before Washington DC, so swallow a lookup failure and fall back
  // to the (empty) base result.
  try {
    const v2 = await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
      `/api/now/table/${v2Table}`,
      { params: { sysparm_query: query, sysparm_limit: limit } }
    );
    if (v2.data.result.length > 0) {
      return pack(v2Table, v2.data, v2.headers);
    }
  } catch {
    // v2 table not present on this release; keep the empty base result below.
  }

  return pack(baseTable, base.data, base.headers);
}

export function registerPlatformMetadataTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  // search_business_rules
  server.tool(
    "search_business_rules",
    "Search business rules (sys_script) by the table they run on (collection), name, execution phase (when), active flag, and an optional script-body substring. Use this to find server-side automation that writes a field — e.g. a rule on 'incident' or 'cmdb_ci_outage' that sets a custom field. Note: script_contains matches the `script` body only; logic placed in the condition or filter_condition fields is returned by get_business_rule, so list a table's rules and drill in if a script match comes up empty. Returns a paginated summary ordered by most recently updated.",
    {
      table: z
        .string()
        .optional()
        .describe(
          "Filter by the table the rule runs on (the `collection` field), e.g. 'incident', 'cmdb_ci_outage'"
        ),
      name: z
        .string()
        .optional()
        .describe("Filter by business rule name (LIKE match)"),
      when: z
        .string()
        .optional()
        .describe(
          "Filter by execution phase: 'before', 'after', 'async', or 'display'"
        ),
      active: z.boolean().optional().describe("Filter by active flag"),
      script_contains: z
        .string()
        .optional()
        .describe(
          "Filter to rules whose `script` body CONTAINS this substring (e.g. a field name like 'u_major_incident'). Matches the script field only."
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
          table?: string;
          name?: string;
          when?: string;
          active?: boolean;
          script_contains?: string;
          limit: number;
          offset: number;
        }
      ) => {
        const queryParts: string[] = [];

        if (args.table) {
          queryParts.push(`collection=${sanitizeValue(args.table)}`);
        }
        if (args.name) {
          queryParts.push(`nameLIKE${sanitizeValue(args.name)}`);
        }
        if (args.when) {
          queryParts.push(`when=${sanitizeValue(args.when)}`);
        }
        if (typeof args.active === "boolean") {
          queryParts.push(`active=${args.active ? "true" : "false"}`);
        }
        if (args.script_contains) {
          queryParts.push(`scriptLIKE${sanitizeValue(args.script_contains)}`);
        }

        queryParts.push("ORDERBYDESCsys_updated_on");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<SysIdRecord>
        >(`/api/now/table/${BUSINESS_RULE_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields: BUSINESS_RULE_SUMMARY_FIELDS,
          },
        });

        return {
          success: true,
          data: data.result.map((r) => ({
            ...r,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              BUSINESS_RULE_TABLE,
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

  // get_business_rule
  server.tool(
    "get_business_rule",
    "Get the full record for one business rule (sys_script) by sys_id, including the complete `script` body and the `condition` and `filter_condition` fields. Use this after search_business_rules to read exactly what a rule does.",
    {
      sys_id: z.string().describe("Business rule sys_id (32 hex chars)"),
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
        ServiceNowSingleResponse<SysIdRecord>
      >(`/api/now/table/${BUSINESS_RULE_TABLE}/${args.sys_id}`);

      return {
        success: true,
        data: {
          ...data.result,
          self_link: buildRecordUrl(
            ctx.instanceUrl,
            BUSINESS_RULE_TABLE,
            data.result.sys_id
          ),
        },
      };
    })
  );

  // get_list_view
  server.tool(
    "get_list_view",
    "Read list view column layouts (sys_ui_list) and their ordered columns (sys_ui_list_element). Provide a `sys_id` for one specific layout, or a `table` to return the base list view(s) for that table (e.g. 'incident'). IMPORTANT: this returns which COLUMNS a list shows, not the row filter — a list's filter lives on the navigator module (sys_app_module.filter), so use search_navigator_modules for questions like 'what filters the Major Incidents list'. Returns each matching layout with its columns in display order.",
    {
      sys_id: z
        .string()
        .optional()
        .describe(
          "A specific sys_ui_list sys_id (32 hex chars). Takes precedence over `table`."
        ),
      table: z
        .string()
        .optional()
        .describe(
          "Return list view layouts defined for this table (the sys_ui_list `name` field), e.g. 'incident'"
        ),
      include_personal: z
        .boolean()
        .default(false)
        .describe(
          "When querying by `table`, also include per-user personal list layouts (sys_user set). Default false returns only the shared/base layouts."
        ),
      include_columns: z
        .boolean()
        .default(true)
        .describe(
          "Fetch the ordered column list (sys_ui_list_element) for each layout"
        ),
      column_limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(200)
        .describe("Maximum columns to return per layout"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum layouts to return when querying by `table`"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          sys_id?: string;
          table?: string;
          include_personal: boolean;
          include_columns: boolean;
          column_limit: number;
          limit: number;
        }
      ) => {
        if (!args.sys_id && !args.table) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Provide either sys_id or table",
            },
          };
        }

        let lists: SysIdRecord[];
        let totalCount: number;

        if (args.sys_id) {
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
            ServiceNowSingleResponse<SysIdRecord>
          >(`/api/now/table/${LIST_TABLE}/${args.sys_id}`);
          lists = [data.result];
          totalCount = 1;
        } else {
          const queryParts = [`name=${sanitizeValue(args.table as string)}`];
          if (!args.include_personal) {
            queryParts.push("sys_userISEMPTY");
          }
          queryParts.push("ORDERBYview");

          const { data, headers } = await ctx.snClient.get<
            ServiceNowListResponse<SysIdRecord>
          >(`/api/now/table/${LIST_TABLE}`, {
            params: {
              sysparm_query: queryParts.join("^"),
              sysparm_limit: args.limit,
              sysparm_fields: LIST_SUMMARY_FIELDS,
            },
          });
          lists = data.result;
          totalCount = parseInt(headers["x-total-count"] || "0", 10);
        }

        const enriched = [];
        for (const list of lists) {
          const entry: Record<string, unknown> = {
            ...list,
            self_link: buildRecordUrl(ctx.instanceUrl, LIST_TABLE, list.sys_id),
          };

          if (args.include_columns) {
            const { data: elementData, headers: elementHeaders } =
              await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
                `/api/now/table/${LIST_ELEMENT_TABLE}`,
                {
                  params: {
                    sysparm_query: `list_id=${list.sys_id}^ORDERBYposition`,
                    sysparm_limit: args.column_limit,
                    sysparm_fields: LIST_ELEMENT_FIELDS,
                  },
                }
              );
            const elementTotal = parseInt(
              elementHeaders["x-total-count"] || "0",
              10
            );
            entry.columns = elementData.result.map((e) => ({
              ...e,
              self_link: buildRecordUrl(
                ctx.instanceUrl,
                LIST_ELEMENT_TABLE,
                e.sys_id
              ),
            }));
            entry.column_metadata = {
              total_count: elementTotal,
              returned_count: elementData.result.length,
              truncated: elementTotal > elementData.result.length,
            };
          }

          enriched.push(entry);
        }

        return {
          success: true,
          data: enriched,
          metadata: {
            total_count: totalCount,
            returned_count: enriched.length,
          },
        };
      }
    )
  );

  // search_navigator_modules
  server.tool(
    "search_navigator_modules",
    "Search application navigator modules (sys_app_module) — the menu items in the left-hand nav. For a 'List of Records' module the `filter` field holds the encoded query that scopes the list (this is where a 'Major Incidents' list filter actually lives), the target table is in `name`, and the human label is in `title`. Use this to discover what filters a named list. Returns a paginated summary including filter and query.",
    {
      title: z
        .string()
        .optional()
        .describe("Filter by the module's display label (LIKE match), e.g. 'Major Incident'"),
      table: z
        .string()
        .optional()
        .describe(
          "Filter by the module's target table (the `name` field on sys_app_module), e.g. 'incident'"
        ),
      active: z.boolean().optional().describe("Filter by active flag"),
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
          title?: string;
          table?: string;
          active?: boolean;
          limit: number;
          offset: number;
        }
      ) => {
        const queryParts: string[] = [];

        if (args.title) {
          queryParts.push(`titleLIKE${sanitizeValue(args.title)}`);
        }
        if (args.table) {
          queryParts.push(`name=${sanitizeValue(args.table)}`);
        }
        if (typeof args.active === "boolean") {
          queryParts.push(`active=${args.active ? "true" : "false"}`);
        }

        queryParts.push("ORDERBYtitle");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<SysIdRecord>
        >(`/api/now/table/${MODULE_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields: MODULE_SUMMARY_FIELDS,
          },
        });

        return {
          success: true,
          data: data.result.map((r) => ({
            ...r,
            self_link: buildRecordUrl(ctx.instanceUrl, MODULE_TABLE, r.sys_id),
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

  // search_flow_definitions
  server.tool(
    "search_flow_definitions",
    "Search Flow Designer flow/subflow definitions (sys_hub_flow) by name, active flag, and type. Use this to find a flow by name (e.g. 'Outage created from MIM'), then read what it does with get_flow_definition. This is the flow *design*; for execution history use search_flow_executions instead. Returns a paginated summary ordered by most recently updated.",
    {
      name: z
        .string()
        .optional()
        .describe("Filter by flow/subflow name (LIKE match)"),
      active: z.boolean().optional().describe("Filter by active flag"),
      type: z
        .string()
        .optional()
        .describe("Filter by type, e.g. 'flow' or 'subflow'"),
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
          active?: boolean;
          type?: string;
          limit: number;
          offset: number;
        }
      ) => {
        const queryParts: string[] = [];

        if (args.name) {
          queryParts.push(`nameLIKE${sanitizeValue(args.name)}`);
        }
        if (typeof args.active === "boolean") {
          queryParts.push(`active=${args.active ? "true" : "false"}`);
        }
        if (args.type) {
          queryParts.push(`type=${sanitizeValue(args.type)}`);
        }

        queryParts.push("ORDERBYDESCsys_updated_on");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<SysIdRecord>
        >(`/api/now/table/${FLOW_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields: FLOW_SUMMARY_FIELDS,
          },
        });

        return {
          success: true,
          data: data.result.map((r) => ({
            ...r,
            self_link: buildRecordUrl(ctx.instanceUrl, FLOW_TABLE, r.sys_id),
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

  // get_flow_definition
  server.tool(
    "get_flow_definition",
    "Get a Flow Designer flow definition (sys_hub_flow) by sys_id, with its trigger instance(s) and ordered action steps. The flow header gives name/active/type/scope; the triggers reveal what fires the flow (e.g. their table and condition columns); the action instances list the ordered steps with their action type and label. NOTE: the per-step input VALUES (the actual field assignments, e.g. setting a field to true) are stored separately (sys_variable_value) and are NOT expanded here — open the flow in Flow Designer or inspect those records to see literal field writes. Components are read from the base instance tables, falling back to the Flow Engine V2 (*_v2) tables on Washington DC and later releases.",
    {
      sys_id: z.string().describe("Flow definition sys_id (sys_hub_flow, 32 hex chars)"),
      include_components: z
        .boolean()
        .default(true)
        .describe(
          "Include the flow's trigger instances and ordered action steps (set false for the header only)"
        ),
      component_limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(200)
        .describe("Maximum trigger/action instance rows to return per type"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          sys_id: string;
          include_components: boolean;
          component_limit: number;
        }
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

        const { data } = await ctx.snClient.get<
          ServiceNowSingleResponse<SysIdRecord>
        >(`/api/now/table/${FLOW_TABLE}/${args.sys_id}`);

        const result: Record<string, unknown> = {
          ...data.result,
          self_link: buildRecordUrl(
            ctx.instanceUrl,
            FLOW_TABLE,
            data.result.sys_id
          ),
        };

        if (args.include_components) {
          const triggers = await fetchFlowComponents(
            ctx,
            TRIGGER_TABLE,
            TRIGGER_TABLE_V2,
            args.sys_id,
            args.component_limit
          );
          const actions = await fetchFlowComponents(
            ctx,
            ACTION_TABLE,
            ACTION_TABLE_V2,
            args.sys_id,
            args.component_limit
          );

          result.triggers = triggers.rows;
          result.actions = actions.rows;
          result.component_metadata = {
            triggers: {
              table: triggers.table,
              total_count: triggers.total_count,
              returned_count: triggers.returned_count,
              truncated: triggers.truncated,
            },
            actions: {
              table: actions.table,
              total_count: actions.total_count,
              returned_count: actions.returned_count,
              truncated: actions.truncated,
            },
          };
        }

        return {
          success: true,
          data: result,
        };
      }
    )
  );
}

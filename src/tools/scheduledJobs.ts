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

// Parent `sysauto` table backs the "Scheduled Jobs" list and is extended by
// every subclass: sysauto_script, sysauto_template (record generators),
// sysauto_report, sysauto_import, etc. Querying the parent surfaces all of
// them in one call.
const PARENT_TABLE = "sysauto";

const SUMMARY_FIELDS = [
  "sys_id",
  "name",
  "active",
  "run_type",
  "run_period",
  "run_dayofmonth",
  "run_dayofweek",
  "run_time",
  "run_start",
  "run_as",
  "conditional",
  "sys_class_name",
  "sys_updated_on",
].join(",");

interface ScheduledJobRecord {
  sys_id: string;
  name?: string;
  sys_class_name?: string;
  [key: string]: unknown;
}

function resolveTable(record: { sys_class_name?: string }): string {
  return record.sys_class_name && record.sys_class_name.length > 0
    ? record.sys_class_name
    : PARENT_TABLE;
}

export function registerScheduledJobTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  // search_scheduled_jobs
  server.tool(
    "search_scheduled_jobs",
    "Search Scheduled Jobs (sysauto and all subclasses: sysauto_script, sysauto_template, sysauto_report, sysauto_import, etc.). Useful for finding background automations that create or update records on a schedule (e.g. monthly incident generators built as Scheduled Record Generators or Scheduled Script Executions). Returns a paginated summary list.",
    {
      name: z
        .string()
        .optional()
        .describe("Filter by job name (LIKE match)"),
      script_contains: z
        .string()
        .optional()
        .describe(
          "Filter to sysauto_script jobs whose script body CONTAINS this substring (only matches Scheduled Script Executions)"
        ),
      run_as: z
        .string()
        .optional()
        .describe("Filter by run-as user sys_id (32 hex chars)"),
      active: z
        .boolean()
        .optional()
        .describe("Filter by active flag"),
      run_type: z
        .string()
        .optional()
        .describe(
          "Filter by run_type (e.g. 'periodically', 'monthly', 'weekly', 'daily', 'on_demand')"
        ),
      sys_class_name: z
        .string()
        .optional()
        .describe(
          "Filter by subclass table (e.g. 'sysauto_script', 'sysauto_template', 'sysauto_report', 'sysauto_import')"
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
          script_contains?: string;
          run_as?: string;
          active?: boolean;
          run_type?: string;
          sys_class_name?: string;
          limit: number;
          offset: number;
        }
      ) => {
        const queryParts: string[] = [];

        if (args.name) {
          queryParts.push(`nameLIKE${sanitizeValue(args.name)}`);
        }
        if (args.script_contains) {
          queryParts.push(
            `scriptLIKE${sanitizeValue(args.script_contains)}`
          );
        }
        if (args.run_as) {
          if (!validateSysId(args.run_as)) {
            return {
              success: false,
              error: {
                code: "VALIDATION_ERROR",
                message: "run_as must be a 32-character sys_id",
              },
            };
          }
          queryParts.push(`run_as=${args.run_as}`);
        }
        if (typeof args.active === "boolean") {
          queryParts.push(`active=${args.active ? "true" : "false"}`);
        }
        if (args.run_type) {
          queryParts.push(`run_type=${sanitizeValue(args.run_type)}`);
        }
        if (args.sys_class_name) {
          queryParts.push(
            `sys_class_name=${sanitizeValue(args.sys_class_name)}`
          );
        }

        queryParts.push("ORDERBYDESCsys_updated_on");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<ScheduledJobRecord>
        >(`/api/now/table/${PARENT_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields: SUMMARY_FIELDS,
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

  // get_scheduled_job
  server.tool(
    "get_scheduled_job",
    "Get full details of a Scheduled Job (sysauto and all subclasses) by sys_id. Returns all fields for the record's class — including script/condition for sysauto_script and template/table for sysauto_template (Scheduled Record Generators).",
    {
      sys_id: z
        .string()
        .describe("Scheduled job sys_id (32 hex chars)"),
    },
    wrapHandler(
      async (ctx: ToolContext, args: { sys_id: string }) => {
        if (!validateSysId(args.sys_id)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "sys_id must be a 32-character sys_id",
            },
          };
        }

        // Fetch from the parent table without sysparm_fields so the API
        // returns every column defined on the record's actual subclass.
        const { data } = await ctx.snClient.get<
          ServiceNowSingleResponse<ScheduledJobRecord>
        >(`/api/now/table/${PARENT_TABLE}/${args.sys_id}`);

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
      }
    )
  );
}

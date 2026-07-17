import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext, WrapHandler } from "./registry.js";
import { buildRecordUrl } from "./registry.js";
import type {
  ServiceNowListResponse,
  ServiceNowSingleResponse,
} from "../servicenow/types.js";
import { sanitizeValue } from "../servicenow/queryBuilder.js";
import { validateSysId, normalizeDateBoundary } from "../utils/validators.js";

// Flow Designer execution history. Each `sys_flow_context` row is one run of a
// flow, subflow, or action; the step-by-step engine output for that run lives
// in `sys_flow_log`, joined back via sys_flow_log.context = sys_flow_context.sys_id.
const CONTEXT_TABLE = "sys_flow_context";
const LOG_TABLE = "sys_flow_log";

const CONTEXT_SUMMARY_FIELDS = [
  "sys_id",
  "name",
  "state",
  "started",
  "completed",
  "flow",
  "source_table",
  "source_record",
  "started_by",
  "type",
  "sys_created_on",
  "sys_updated_on",
].join(",");

const LOG_SUMMARY_FIELDS = [
  "sys_id",
  "level",
  "message",
  "source",
  "sys_created_on",
].join(",");

interface FlowContextRecord {
  sys_id: string;
  name?: string;
  state?: string;
  [key: string]: unknown;
}

interface FlowLogRecord {
  sys_id: string;
  level?: string;
  message?: string;
  [key: string]: unknown;
}

export function registerFlowLogTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  // search_flow_executions
  server.tool(
    "search_flow_executions",
    "Search Flow Designer execution history (sys_flow_context) — one record per flow, subflow, or action run. Use this to find recent or failed flow runs (e.g. a flow that errored when an incident was created), then drill into a run with get_flow_execution to read its step-by-step log. Returns a paginated summary list ordered by most recently started.",
    {
      flow_name: z
        .string()
        .optional()
        .describe("Filter by flow/subflow/action name (LIKE match)"),
      state: z
        .string()
        .optional()
        .describe(
          "Filter by execution state token, e.g. 'COMPLETE', 'ERROR', 'IN_PROGRESS', 'WAITING', 'CANCELLED'"
        ),
      errors_only: z
        .boolean()
        .optional()
        .describe(
          "Convenience filter for failed runs (state=ERROR). Cannot be combined with an explicit state."
        ),
      flow: z
        .string()
        .optional()
        .describe(
          "Filter by flow definition sys_id (sys_hub_flow, 32 hex chars)"
        ),
      source_table: z
        .string()
        .optional()
        .describe("Filter by the table of the triggering record"),
      source_record: z
        .string()
        .optional()
        .describe(
          "Filter by the sys_id of the triggering record (32 hex chars)"
        ),
      started_by: z
        .string()
        .optional()
        .describe(
          "Filter by the sys_id of the user who triggered the run (32 hex chars)"
        ),
      started_after: z
        .string()
        .optional()
        .describe(
          "Only runs started on/after this date. YYYY-MM-DD or ISO 8601 (with timezone)."
        ),
      started_before: z
        .string()
        .optional()
        .describe(
          "Only runs started on/before this date. YYYY-MM-DD or ISO 8601 (with timezone)."
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
    wrapHandler("search_flow_executions", 
      async (
        ctx: ToolContext,
        args: {
          flow_name?: string;
          state?: string;
          errors_only?: boolean;
          flow?: string;
          source_table?: string;
          source_record?: string;
          started_by?: string;
          started_after?: string;
          started_before?: string;
          limit: number;
          offset: number;
        }
      ) => {
        // errors_only is shorthand for state=ERROR; allowing both would make
        // the resulting query ambiguous, so reject the combination outright
        // (mirrors the conflicting-filter guard in search_scheduled_jobs).
        if (args.errors_only && args.state) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "errors_only cannot be combined with an explicit state (errors_only is shorthand for state=ERROR)",
            },
          };
        }

        const queryParts: string[] = [];

        if (args.flow_name) {
          queryParts.push(`nameLIKE${sanitizeValue(args.flow_name)}`);
        }
        if (args.state) {
          queryParts.push(`state=${sanitizeValue(args.state)}`);
        }
        if (args.errors_only) {
          queryParts.push("state=ERROR");
        }

        for (const [field, value] of [
          ["flow", args.flow],
          ["source_record", args.source_record],
          ["started_by", args.started_by],
        ] as const) {
          if (!value) continue;
          if (!validateSysId(value)) {
            return {
              success: false,
              error: {
                code: "VALIDATION_ERROR",
                message: `${field} must be a 32-character sys_id`,
              },
            };
          }
          queryParts.push(`${field}=${value}`);
        }

        if (args.source_table) {
          queryParts.push(
            `source_table=${sanitizeValue(args.source_table)}`
          );
        }

        const dateFilters: Array<
          [string | undefined, "from" | "to", string]
        > = [
          [args.started_after, "from", ">="],
          [args.started_before, "to", "<="],
        ];
        for (const [raw, boundary, op] of dateFilters) {
          if (!raw) continue;
          const normalized = normalizeDateBoundary(raw, boundary);
          if (!normalized) {
            return {
              success: false,
              error: {
                code: "VALIDATION_ERROR",
                message: `Invalid date for started_${boundary}: ${raw}. Use YYYY-MM-DD or ISO 8601.`,
              },
            };
          }
          queryParts.push(`started${op}${sanitizeValue(normalized)}`);
        }

        queryParts.push("ORDERBYDESCstarted");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<FlowContextRecord>
        >(`/api/now/table/${CONTEXT_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields: CONTEXT_SUMMARY_FIELDS,
          },
        });

        return {
          success: true,
          data: data.result.map((r) => ({
            ...r,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              CONTEXT_TABLE,
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

  // get_flow_execution
  server.tool(
    "get_flow_execution",
    "Get full details of a single Flow Designer execution (sys_flow_context) by sys_id, including its step-by-step engine log entries from sys_flow_log (oldest first). Use this to diagnose why a specific flow run errored or stalled.",
    {
      sys_id: z
        .string()
        .describe("Flow execution context sys_id (32 hex chars)"),
      include_logs: z
        .boolean()
        .default(true)
        .describe(
          "Include sys_flow_log step entries for this run (set false to fetch only the context record)"
        ),
      log_limit: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .default(200)
        .describe("Maximum log entries to return (oldest first)"),
    },
    wrapHandler("get_flow_execution", 
      async (
        ctx: ToolContext,
        args: {
          sys_id: string;
          include_logs: boolean;
          log_limit: number;
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
          ServiceNowSingleResponse<FlowContextRecord>
        >(`/api/now/table/${CONTEXT_TABLE}/${args.sys_id}`);

        const result: Record<string, unknown> = {
          ...data.result,
          self_link: buildRecordUrl(
            ctx.instanceUrl,
            CONTEXT_TABLE,
            data.result.sys_id
          ),
        };

        if (args.include_logs) {
          const { data: logData, headers: logHeaders } =
            await ctx.snClient.get<ServiceNowListResponse<FlowLogRecord>>(
              `/api/now/table/${LOG_TABLE}`,
              {
                params: {
                  sysparm_query: `context=${args.sys_id}^ORDERBYsys_created_on`,
                  sysparm_limit: args.log_limit,
                  sysparm_fields: LOG_SUMMARY_FIELDS,
                },
              }
            );

          const totalLogCount = parseInt(
            logHeaders["x-total-count"] || "0",
            10
          );
          result.logs = logData.result.map((r) => ({
            ...r,
            self_link: buildRecordUrl(ctx.instanceUrl, LOG_TABLE, r.sys_id),
          }));
          result.log_metadata = {
            total_count: totalLogCount,
            returned_count: logData.result.length,
            truncated: totalLogCount > logData.result.length,
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

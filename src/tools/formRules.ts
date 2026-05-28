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

// UI policies (sys_ui_policy) apply client-side field rules (mandatory / visible
// / read-only / clear) when their `conditions` match. The per-field actions live
// in sys_ui_policy_action (joined via `ui_policy`); value-setting logic, if any,
// is in the policy's script_true / script_false fields.
const UI_POLICY_TABLE = "sys_ui_policy";
const UI_POLICY_ACTION_TABLE = "sys_ui_policy_action";
const UI_POLICY_SUMMARY_FIELDS = [
  "sys_id",
  "short_description",
  "table",
  "active",
  "on_load",
  "reverse_if_false",
  "global",
  "ui_type",
  "order",
  "sys_updated_on",
].join(",");

// Client scripts (sys_script_client) run in the browser on a form: onLoad,
// onChange (for `field`), onSubmit, or onCellEdit. The logic is in `script`.
const CLIENT_SCRIPT_TABLE = "sys_script_client";
const CLIENT_SCRIPT_SUMMARY_FIELDS = [
  "sys_id",
  "name",
  "table",
  "type",
  "field",
  "active",
  "ui_type",
  "global",
  "applies_extended",
  "order",
  "sys_updated_on",
].join(",");

// Data policies (sys_data_policy2 — the "2" is the real table) enforce
// mandatory / read-only at the data layer (and optionally the UI). The target
// table is `table`; the per-field rules live in sys_data_policy_rule (joined via
// `policy`).
const DATA_POLICY_TABLE = "sys_data_policy2";
const DATA_POLICY_RULE_TABLE = "sys_data_policy_rule";
const DATA_POLICY_SUMMARY_FIELDS = [
  "sys_id",
  "short_description",
  "table",
  "active",
  "enforce_ui",
  "reverse_if_false",
  "apply_import_set",
  "sys_updated_on",
].join(",");

interface SysIdRecord {
  sys_id: string;
  [key: string]: unknown;
}

export function registerFormRulesTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  // search_ui_policies
  server.tool(
    "search_ui_policies",
    "Search UI policies (sys_ui_policy) — client-side rules that make form fields mandatory / visible / read-only / cleared when their conditions match. Filter by the table they apply to, description, and active flag. Use get_ui_policy to see the per-field actions and any client scripts. Returns a paginated summary ordered by most recently updated.",
    {
      table: z
        .string()
        .optional()
        .describe("Filter by the table the policy applies to, e.g. 'incident'"),
      short_description: z
        .string()
        .optional()
        .describe("Filter by the policy's description (LIKE match)"),
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
          table?: string;
          short_description?: string;
          active?: boolean;
          limit: number;
          offset: number;
        }
      ) => {
        const queryParts: string[] = [];
        if (args.table) {
          queryParts.push(`table=${sanitizeValue(args.table)}`);
        }
        if (args.short_description) {
          queryParts.push(
            `short_descriptionLIKE${sanitizeValue(args.short_description)}`
          );
        }
        if (typeof args.active === "boolean") {
          queryParts.push(`active=${args.active ? "true" : "false"}`);
        }
        queryParts.push("ORDERBYDESCsys_updated_on");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<SysIdRecord>
        >(`/api/now/table/${UI_POLICY_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields: UI_POLICY_SUMMARY_FIELDS,
          },
        });

        return {
          success: true,
          data: data.result.map((r) => ({
            ...r,
            self_link: buildRecordUrl(ctx.instanceUrl, UI_POLICY_TABLE, r.sys_id),
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

  // get_ui_policy
  server.tool(
    "get_ui_policy",
    "Get one UI policy (sys_ui_policy) by sys_id with its full record (including the conditions and the script_true / script_false bodies) and its per-field actions from sys_ui_policy_action (each row's field plus its mandatory / visible / disabled (read-only) / cleared settings). This shows exactly what client-side field behavior the policy enforces.",
    {
      sys_id: z.string().describe("UI policy sys_id (32 hex chars)"),
      action_limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(200)
        .describe("Maximum sys_ui_policy_action rows to return"),
    },
    wrapHandler(
      async (ctx: ToolContext, args: { sys_id: string; action_limit: number }) => {
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
        >(`/api/now/table/${UI_POLICY_TABLE}/${args.sys_id}`);

        // All columns (no field restriction) so field / mandatory / visible /
        // disabled / cleared all surface regardless of release-specific columns.
        const { data: actionData, headers: actionHeaders } =
          await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
            `/api/now/table/${UI_POLICY_ACTION_TABLE}`,
            {
              params: {
                sysparm_query: `ui_policy=${args.sys_id}`,
                sysparm_limit: args.action_limit,
              },
            }
          );
        const actionTotal = parseInt(actionHeaders["x-total-count"] || "0", 10);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              UI_POLICY_TABLE,
              data.result.sys_id
            ),
            actions: actionData.result.map((r) => ({
              ...r,
              self_link: buildRecordUrl(
                ctx.instanceUrl,
                UI_POLICY_ACTION_TABLE,
                r.sys_id
              ),
            })),
            action_metadata: {
              total_count: actionTotal,
              returned_count: actionData.result.length,
              truncated: actionTotal > actionData.result.length,
            },
          },
        };
      }
    )
  );

  // search_client_scripts
  server.tool(
    "search_client_scripts",
    "Search client scripts (sys_script_client) — browser-side form logic that runs onLoad, onChange, onSubmit, or onCellEdit and can read/write field values. Filter by table, name, type, active, and a script-body substring. Use get_client_script to read the full script. Returns a paginated summary ordered by most recently updated.",
    {
      table: z
        .string()
        .optional()
        .describe("Filter by the table the script runs on, e.g. 'incident'"),
      name: z.string().optional().describe("Filter by name (LIKE match)"),
      type: z
        .string()
        .optional()
        .describe(
          "Filter by type: 'onLoad', 'onChange', 'onSubmit', or 'onCellEdit'"
        ),
      active: z.boolean().optional().describe("Filter by active flag"),
      script_contains: z
        .string()
        .optional()
        .describe(
          "Filter to scripts whose `script` body CONTAINS this substring (e.g. a field name)"
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
          type?: string;
          active?: boolean;
          script_contains?: string;
          limit: number;
          offset: number;
        }
      ) => {
        const queryParts: string[] = [];
        if (args.table) {
          queryParts.push(`table=${sanitizeValue(args.table)}`);
        }
        if (args.name) {
          queryParts.push(`nameLIKE${sanitizeValue(args.name)}`);
        }
        if (args.type) {
          queryParts.push(`type=${sanitizeValue(args.type)}`);
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
        >(`/api/now/table/${CLIENT_SCRIPT_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields: CLIENT_SCRIPT_SUMMARY_FIELDS,
          },
        });

        return {
          success: true,
          data: data.result.map((r) => ({
            ...r,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              CLIENT_SCRIPT_TABLE,
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

  // get_client_script
  server.tool(
    "get_client_script",
    "Get one client script (sys_script_client) by sys_id, including the full `script` body and its table / type / field. Use after search_client_scripts to read exactly what the script does.",
    {
      sys_id: z.string().describe("Client script sys_id (32 hex chars)"),
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
      >(`/api/now/table/${CLIENT_SCRIPT_TABLE}/${args.sys_id}`);

      return {
        success: true,
        data: {
          ...data.result,
          self_link: buildRecordUrl(
            ctx.instanceUrl,
            CLIENT_SCRIPT_TABLE,
            data.result.sys_id
          ),
        },
      };
    })
  );

  // search_data_policies
  server.tool(
    "search_data_policies",
    "Search data policies (sys_data_policy2 — the '2' is the real table name) — server-side rules that make fields mandatory or read-only at the data layer (and optionally the UI, when enforce_ui is set). Filter by the table they apply to, description, and active flag. Use get_data_policy to see the per-field rules. Returns a paginated summary ordered by most recently updated.",
    {
      table: z
        .string()
        .optional()
        .describe("Filter by the table the policy applies to, e.g. 'incident'"),
      short_description: z
        .string()
        .optional()
        .describe("Filter by the policy's description (LIKE match)"),
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
          table?: string;
          short_description?: string;
          active?: boolean;
          limit: number;
          offset: number;
        }
      ) => {
        const queryParts: string[] = [];
        if (args.table) {
          queryParts.push(`table=${sanitizeValue(args.table)}`);
        }
        if (args.short_description) {
          queryParts.push(
            `short_descriptionLIKE${sanitizeValue(args.short_description)}`
          );
        }
        if (typeof args.active === "boolean") {
          queryParts.push(`active=${args.active ? "true" : "false"}`);
        }
        queryParts.push("ORDERBYDESCsys_updated_on");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<SysIdRecord>
        >(`/api/now/table/${DATA_POLICY_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields: DATA_POLICY_SUMMARY_FIELDS,
          },
        });

        return {
          success: true,
          data: data.result.map((r) => ({
            ...r,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              DATA_POLICY_TABLE,
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

  // get_data_policy
  server.tool(
    "get_data_policy",
    "Get one data policy (sys_data_policy2) by sys_id with its full record (including conditions) and its per-field rules from sys_data_policy_rule (each row's field plus its mandatory / disabled (read-only) settings). This shows exactly which fields the policy makes mandatory or read-only.",
    {
      sys_id: z.string().describe("Data policy sys_id (32 hex chars)"),
      rule_limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(200)
        .describe("Maximum sys_data_policy_rule rows to return"),
    },
    wrapHandler(
      async (ctx: ToolContext, args: { sys_id: string; rule_limit: number }) => {
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
        >(`/api/now/table/${DATA_POLICY_TABLE}/${args.sys_id}`);

        // sys_data_policy_rule links back via `policy`. All columns (no field
        // restriction) so field / mandatory / disabled all surface.
        const { data: ruleData, headers: ruleHeaders } =
          await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
            `/api/now/table/${DATA_POLICY_RULE_TABLE}`,
            {
              params: {
                sysparm_query: `policy=${args.sys_id}`,
                sysparm_limit: args.rule_limit,
              },
            }
          );
        const ruleTotal = parseInt(ruleHeaders["x-total-count"] || "0", 10);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              DATA_POLICY_TABLE,
              data.result.sys_id
            ),
            rules: ruleData.result.map((r) => ({
              ...r,
              self_link: buildRecordUrl(
                ctx.instanceUrl,
                DATA_POLICY_RULE_TABLE,
                r.sys_id
              ),
            })),
            rule_metadata: {
              total_count: ruleTotal,
              returned_count: ruleData.result.length,
              truncated: ruleTotal > ruleData.result.length,
            },
          },
        };
      }
    )
  );
}

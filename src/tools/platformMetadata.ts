import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext, WrapHandler } from "./registry.js";
import { buildRecordUrl, refSysId } from "./registry.js";
import type {
  ServiceNowListResponse,
  ServiceNowSingleResponse,
} from "../servicenow/types.js";
import { sanitizeValue } from "../servicenow/queryBuilder.js";
import { validateSysId } from "../utils/validators.js";

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

// A flow action/trigger instance's configured input VALUES — the field
// assignments a "Create/Update Record" step actually makes. On pre-Washington
// flows these are sys_variable_value rows keyed by document_key = the instance
// sys_id; on Flow Engine V2 they move onto the instance's own `values` field
// (which can be an encoded blob). get_flow_action_inputs reads both.
const VARIABLE_VALUE_TABLE = "sys_variable_value";
const VARIABLE_VALUE_FIELDS = [
  "sys_id",
  "document",
  "document_key",
  "variable",
  "value",
].join(",");

// Email/notification definitions (sysevent_email_action) — the "Notifications"
// a System Notification admin sees. `event_name` ties a notification to the
// sysevent that fires it (e.g. rota.on_call.reminder), `collection` is the
// table whose records it notifies about, and the recipient/condition/message
// configuration lives in the full record.
const NOTIFICATION_TABLE = "sysevent_email_action";
const NOTIFICATION_SUMMARY_FIELDS = [
  "sys_id",
  "name",
  "event_name",
  "collection",
  "active",
  "type",
  "subject",
  "weight",
  "sys_updated_on",
].join(",");

// Classic Workflow (pre-Flow Designer). wf_workflow is the header; the actual
// design lives on wf_workflow_version rows (one is published=true), whose
// graph nodes are wf_activity records (joined via workflow_version) connected
// by wf_transition edges (joined via the transition's `from` activity).
const WORKFLOW_TABLE = "wf_workflow";
const WORKFLOW_VERSION_TABLE = "wf_workflow_version";
const WORKFLOW_ACTIVITY_TABLE = "wf_activity";
const WORKFLOW_TRANSITION_TABLE = "wf_transition";
const WORKFLOW_SUMMARY_FIELDS = [
  "sys_id",
  "name",
  "table",
  "description",
  "access",
  "template",
  "sys_updated_on",
].join(",");
const WORKFLOW_VERSION_FIELDS = [
  "sys_id",
  "name",
  "workflow",
  "published",
  "active",
  "table",
  "condition",
  "timezone",
  "start",
  "sys_updated_on",
].join(",");
const WORKFLOW_ACTIVITY_FIELDS = [
  "sys_id",
  "name",
  "activity_definition",
  "stage",
  "parent",
  "timeout",
  "notes",
].join(",");
const WORKFLOW_TRANSITION_FIELDS = ["sys_id", "from", "to", "condition"].join(
  ","
);

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

// The *_v2 instance tables are absent before Washington DC. The only request
// made against them here is a well-formed query (a validated sys_id, no field
// restriction) — and the Table API ignores unknown query/order fields rather
// than erroring — so the single client-side reason this call can fail is that
// the table itself is not present, which ServiceNow reports as a 400/404.
// Operational failures (auth 401, ACL 403, rate-limit 429, and server/transient
// errors or network timeouts, which the client maps to 500) carry other
// statuses and must NOT be masked as "no components", so only a 400/404 is
// treated as a missing table; everything else is rethrown.
function isMissingTableError(err: unknown): boolean {
  const status = (err as { statusCode?: number })?.statusCode;
  return status === 400 || status === 404;
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
  // on releases before Washington DC; tolerate only that (a 400/404 missing
  // table) and fall back to the empty base result, but let any real error
  // (ACL, rate limit, server/transient) propagate through normal handling.
  try {
    const v2 = await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
      `/api/now/table/${v2Table}`,
      { params: { sysparm_query: query, sysparm_limit: limit } }
    );
    if (v2.data.result.length > 0) {
      return pack(v2Table, v2.data, v2.headers);
    }
  } catch (err) {
    if (!isMissingTableError(err)) {
      throw err;
    }
    // v2 table not present on this release; keep the empty base result below.
  }

  return pack(baseTable, base.data, base.headers);
}

// Fetch one action instance record by sys_id, trying the base table then the
// Flow Engine V2 table. A GET by sys_id answers 404 when the record is not in
// that table (it may live in the other) and 400 when the *_v2 table is absent
// on older releases; both mean "not here, try the next", while auth, ACL,
// rate-limit, and server errors must propagate. Returns null if neither has it.
async function fetchActionInstanceRecord(
  ctx: ToolContext,
  sysId: string
): Promise<{ table: string; record: SysIdRecord } | null> {
  for (const table of [ACTION_TABLE, ACTION_TABLE_V2]) {
    try {
      const { data } = await ctx.snClient.get<
        ServiceNowSingleResponse<SysIdRecord>
      >(`/api/now/table/${table}/${sysId}`);
      return { table, record: data.result };
    } catch (err) {
      if (!isMissingTableError(err)) {
        throw err;
      }
      // Not found in this table (404) or table absent (400) — try the next.
    }
  }
  return null;
}

export function registerPlatformMetadataTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  // search_business_rules
  server.tool(
    "search_business_rules",
    "Search business rules (sys_script) by the table they run on (collection), name, execution phase (when), active flag, and substrings of the script body or the condition/filter_condition. Use this to find server-side automation that writes or gates on a field — e.g. a rule on 'incident' or 'cmdb_ci_outage' referencing a custom field. `script_contains` matches the `script` body; `condition_contains` matches the `condition` OR `filter_condition` (the fields that gate when a rule runs). Returns a paginated summary ordered by most recently updated.",
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
      condition_contains: z
        .string()
        .optional()
        .describe(
          "Filter to rules whose `condition` OR `filter_condition` CONTAINS this substring — the fields that gate when a rule runs. Use to find rules that branch on a field, e.g. 'u_major_incident'."
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
    wrapHandler("search_business_rules", 
      async (
        ctx: ToolContext,
        args: {
          table?: string;
          name?: string;
          when?: string;
          active?: boolean;
          script_contains?: string;
          condition_contains?: string;
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
        // condition + filter_condition are separate columns; OR them so one
        // search spans both gating fields. This is pushed LAST (just before
        // ORDERBY) so the OR run is contiguous and the preceding filters stay
        // ANDed: ServiceNow groups a contiguous `^OR` run and treats the
        // surrounding `^` as the AND boundary, i.e.
        //   collection=x ^ ... ^ (conditionLIKEv OR filter_conditionLIKEv).
        if (args.condition_contains) {
          const v = sanitizeValue(args.condition_contains);
          queryParts.push(`conditionLIKE${v}^ORfilter_conditionLIKE${v}`);
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
    wrapHandler("get_business_rule", async (ctx: ToolContext, args: { sys_id: string }) => {
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
    wrapHandler("get_list_view", 
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
    wrapHandler("search_navigator_modules", 
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
    wrapHandler("search_flow_definitions", 
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
    "Get a Flow Designer flow definition (sys_hub_flow) by sys_id, with its trigger instance(s) and ordered action steps. The flow header gives name/active/type/scope; the triggers reveal what fires the flow (e.g. their table and condition columns); the action instances list the ordered steps with their action type and label. NOTE: the per-step input VALUES (the actual field assignments, e.g. setting a field to true) are stored separately (sys_variable_value, or the `values` field on Flow Engine V2 action instances) and are NOT expanded here — call get_flow_action_inputs on a specific action instance sys_id to read them. Components are read from the base instance tables, falling back to the Flow Engine V2 (*_v2) tables on Washington DC and later releases.",
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
    wrapHandler("get_flow_definition", 
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

  // get_flow_action_inputs
  server.tool(
    "get_flow_action_inputs",
    "Expand the configured INPUT VALUES of one Flow Designer action instance (sys_hub_action_instance) by sys_id — the actual field assignments a 'Create Record' / 'Update Record' step makes, not just that it is a Create Record. Reads the pre-Washington store (sys_variable_value rows keyed by document_key) AND fetches the action instance record itself (base or Flow Engine V2 *_v2 table) so its `values` field is surfaced on V2 flows (where that field can be an encoded blob). Use after get_flow_definition to prove which fields a step writes. Reference values come back as display values.",
    {
      sys_id: z
        .string()
        .describe(
          "Action instance sys_id (sys_hub_action_instance, 32 hex chars)"
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(200)
        .describe("Maximum sys_variable_value input rows to return"),
    },
    wrapHandler("get_flow_action_inputs", 
      async (ctx: ToolContext, args: { sys_id: string; limit: number }) => {
        if (!validateSysId(args.sys_id)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "sys_id must be a 32-character sys_id",
            },
          };
        }

        // V1 store: input values as sys_variable_value rows keyed by the action
        // instance sys_id (document_key). document_key is a unique sys_id, so
        // filtering on it alone is sufficient and avoids guessing the `document`
        // table-name value.
        const { data: vvData, headers: vvHeaders } = await ctx.snClient.get<
          ServiceNowListResponse<SysIdRecord>
        >(`/api/now/table/${VARIABLE_VALUE_TABLE}`, {
          params: {
            sysparm_query: `document_key=${args.sys_id}^ORDERBYsys_created_on`,
            sysparm_limit: args.limit,
            sysparm_fields: VARIABLE_VALUE_FIELDS,
          },
        });
        const vvTotal = parseInt(vvHeaders["x-total-count"] || "0", 10);

        // The action instance record itself (base or V2). On V2 the configured
        // inputs live on the instance's `values` field rather than in
        // sys_variable_value, so surfacing the record covers both engines.
        const instance = await fetchActionInstanceRecord(ctx, args.sys_id);

        return {
          success: true,
          data: {
            action_instance: instance
              ? {
                  ...instance.record,
                  table: instance.table,
                  self_link: buildRecordUrl(
                    ctx.instanceUrl,
                    instance.table,
                    instance.record.sys_id
                  ),
                }
              : null,
            input_values: vvData.result.map((r) => ({
              ...r,
              self_link: buildRecordUrl(
                ctx.instanceUrl,
                VARIABLE_VALUE_TABLE,
                r.sys_id
              ),
            })),
            metadata: {
              input_values: {
                total_count: vvTotal,
                returned_count: vvData.result.length,
                truncated: vvTotal > vvData.result.length,
              },
              action_instance_found: instance !== null,
              action_instance_table: instance?.table ?? null,
            },
          },
        };
      }
    )
  );

  // search_notifications
  server.tool(
    "search_notifications",
    "Search email/notification definitions (sysevent_email_action) — the records under System Notification > Email > Notifications. Filter by name, the event that fires them (event_name, e.g. 'rota.on_call.reminder'), the table they notify about (collection), and active flag. Use this to find what an event actually sends and to whom (e.g. all on-call reminder/escalation notifications), then get_notification for the full recipient, condition, and message configuration. Returns a paginated summary ordered by most recently updated.",
    {
      name: z
        .string()
        .optional()
        .describe("Filter by notification name (LIKE match)"),
      event_name: z
        .string()
        .optional()
        .describe(
          "Filter by firing event name (LIKE match), e.g. 'rota.on_call' matches all on-call rota events"
        ),
      table: z
        .string()
        .optional()
        .describe(
          "Filter by the table the notification is about (the `collection` field), e.g. 'cmn_rota' or 'incident'"
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
    wrapHandler("search_notifications",
      async (
        ctx: ToolContext,
        args: {
          name?: string;
          event_name?: string;
          table?: string;
          active?: boolean;
          limit: number;
          offset: number;
        }
      ) => {
        const queryParts: string[] = [];

        if (args.name) {
          queryParts.push(`nameLIKE${sanitizeValue(args.name)}`);
        }
        if (args.event_name) {
          queryParts.push(`event_nameLIKE${sanitizeValue(args.event_name)}`);
        }
        if (args.table) {
          queryParts.push(`collection=${sanitizeValue(args.table)}`);
        }
        if (typeof args.active === "boolean") {
          queryParts.push(`active=${args.active ? "true" : "false"}`);
        }

        queryParts.push("ORDERBYDESCsys_updated_on");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<SysIdRecord>
        >(`/api/now/table/${NOTIFICATION_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields: NOTIFICATION_SUMMARY_FIELDS,
          },
        });

        return {
          success: true,
          data: data.result.map((r) => ({
            ...r,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              NOTIFICATION_TABLE,
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

  // get_notification
  server.tool(
    "get_notification",
    "Get one email/notification definition (sysevent_email_action) by sys_id with every field: recipient configuration (recipient_users, recipient_groups, recipient_fields, event_parm_1/event_parm_2 usage), gating condition and advanced-condition script, subject/message body or template reference, weight and digest settings. Fields are returned as {value, display_value} pairs so recipient lists carry sys_ids as well as names. Use after search_notifications to read exactly what a notification sends and to whom.",
    {
      sys_id: z
        .string()
        .describe("Notification sys_id (sysevent_email_action, 32 hex chars)"),
    },
    wrapHandler("get_notification",
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

        // display=all: in the client's default `true` mode, glide_list fields
        // (recipient_users/recipient_groups) collapse to display names with no
        // recoverable sys_ids, which defeats the audit use case.
        const { data } = await ctx.snClient.get<
          ServiceNowSingleResponse<SysIdRecord>
        >(`/api/now/table/${NOTIFICATION_TABLE}/${args.sys_id}`, {
          params: { sysparm_display_value: "all" },
        });

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              NOTIFICATION_TABLE,
              refSysId(data.result.sys_id)
            ),
          },
        };
      }
    )
  );

  // search_workflows
  server.tool(
    "search_workflows",
    "Search classic Workflow definitions (wf_workflow — the pre-Flow-Designer engine that still drives things like on-call assign-by-acknowledgement paging). Filter by name or the table the workflow runs on. Classic workflows do NOT appear in search_flow_definitions (that covers sys_hub_flow only); use this for anything visible in Workflow Editor. Follow up with get_workflow to read a workflow's published version, activities, and transitions.",
    {
      name: z
        .string()
        .optional()
        .describe("Filter by workflow name (LIKE match)"),
      table: z
        .string()
        .optional()
        .describe("Filter by the table the workflow runs on, e.g. 'incident'"),
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
    wrapHandler("search_workflows",
      async (
        ctx: ToolContext,
        args: { name?: string; table?: string; limit: number; offset: number }
      ) => {
        const queryParts: string[] = [];

        if (args.name) {
          queryParts.push(`nameLIKE${sanitizeValue(args.name)}`);
        }
        if (args.table) {
          queryParts.push(`table=${sanitizeValue(args.table)}`);
        }

        queryParts.push("ORDERBYDESCsys_updated_on");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<SysIdRecord>
        >(`/api/now/table/${WORKFLOW_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields: WORKFLOW_SUMMARY_FIELDS,
          },
        });

        return {
          success: true,
          data: data.result.map((r) => ({
            ...r,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              WORKFLOW_TABLE,
              refSysId(r.sys_id)
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

  // get_workflow
  server.tool(
    "get_workflow",
    "Get one classic Workflow (wf_workflow) by sys_id with its design expanded: the workflow header, its versions (wf_workflow_version — the published one is the live design), and for the published (or, if none, most recent) version the activity nodes (wf_activity: name, activity definition type, stage, timeout) and the transition edges between them (wf_transition: from → to with condition) so the actual flow graph can be reconstructed. Per-activity input variable VALUES are not expanded (they live in activity `vars`/`input` blobs). Responses use {value, display_value} pairs so references carry sys_ids and names. Use after search_workflows to read what a workflow actually does — e.g. which notification/voice/SMS steps an on-call paging workflow runs.",
    {
      sys_id: z
        .string()
        .describe("Workflow sys_id (wf_workflow, 32 hex chars)"),
      activity_limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(200)
        .describe("Maximum activity and transition rows to return each"),
    },
    wrapHandler("get_workflow",
      async (
        ctx: ToolContext,
        args: { sys_id: string; activity_limit: number }
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

        const { data: headerData } = await ctx.snClient.get<
          ServiceNowSingleResponse<SysIdRecord>
        >(`/api/now/table/${WORKFLOW_TABLE}/${args.sys_id}`, {
          params: { sysparm_display_value: "all" },
        });

        // Published-first so versions[0] is the live design when one exists;
        // otherwise the most recently updated draft leads.
        const { data: versionData, headers: versionHeaders } =
          await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
            `/api/now/table/${WORKFLOW_VERSION_TABLE}`,
            {
              params: {
                sysparm_query: `workflow=${args.sys_id}^ORDERBYDESCpublished^ORDERBYDESCsys_updated_on`,
                sysparm_limit: 10,
                sysparm_fields: WORKFLOW_VERSION_FIELDS,
                sysparm_display_value: "all",
              },
            }
          );
        const versionTotal = parseInt(
          versionHeaders["x-total-count"] || "0",
          10
        );

        const versions = versionData.result.map((v) => ({
          ...v,
          self_link: buildRecordUrl(
            ctx.instanceUrl,
            WORKFLOW_VERSION_TABLE,
            refSysId(v.sys_id)
          ),
        }));

        let activities: Array<SysIdRecord & { self_link: string }> = [];
        let transitions: Array<SysIdRecord & { self_link: string }> = [];
        let activityMetadata = {
          total_count: 0,
          returned_count: 0,
          truncated: false,
        };
        let transitionMetadata = {
          total_count: 0,
          returned_count: 0,
          truncated: false,
        };
        const expandedVersionId =
          versionData.result.length > 0
            ? refSysId(versionData.result[0].sys_id)
            : null;

        if (expandedVersionId) {
          const { data: activityData, headers: activityHeaders } =
            await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
              `/api/now/table/${WORKFLOW_ACTIVITY_TABLE}`,
              {
                params: {
                  sysparm_query: `workflow_version=${expandedVersionId}^ORDERBYname`,
                  sysparm_limit: args.activity_limit,
                  sysparm_fields: WORKFLOW_ACTIVITY_FIELDS,
                  sysparm_display_value: "all",
                },
              }
            );
          activities = activityData.result.map((a) => ({
            ...a,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              WORKFLOW_ACTIVITY_TABLE,
              refSysId(a.sys_id)
            ),
          }));
          const activityTotal = parseInt(
            activityHeaders["x-total-count"] || "0",
            10
          );
          activityMetadata = {
            total_count: activityTotal,
            returned_count: activityData.result.length,
            truncated: activityTotal > activityData.result.length,
          };

          const { data: transitionData, headers: transitionHeaders } =
            await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
              `/api/now/table/${WORKFLOW_TRANSITION_TABLE}`,
              {
                params: {
                  sysparm_query: `from.workflow_version=${expandedVersionId}`,
                  sysparm_limit: args.activity_limit,
                  sysparm_fields: WORKFLOW_TRANSITION_FIELDS,
                  sysparm_display_value: "all",
                },
              }
            );
          transitions = transitionData.result.map((t) => ({
            ...t,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              WORKFLOW_TRANSITION_TABLE,
              refSysId(t.sys_id)
            ),
          }));
          const transitionTotal = parseInt(
            transitionHeaders["x-total-count"] || "0",
            10
          );
          transitionMetadata = {
            total_count: transitionTotal,
            returned_count: transitionData.result.length,
            truncated: transitionTotal > transitionData.result.length,
          };
        }

        return {
          success: true,
          data: {
            workflow: {
              ...headerData.result,
              self_link: buildRecordUrl(
                ctx.instanceUrl,
                WORKFLOW_TABLE,
                refSysId(headerData.result.sys_id)
              ),
            },
            versions,
            activities,
            transitions,
            metadata: {
              versions: {
                total_count: versionTotal,
                returned_count: versionData.result.length,
                truncated: versionTotal > versionData.result.length,
              },
              expanded_version: expandedVersionId,
              activities: activityMetadata,
              transitions: transitionMetadata,
            },
          },
        };
      }
    )
  );
}

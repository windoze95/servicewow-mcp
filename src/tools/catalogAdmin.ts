import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./registry.js";
import { buildRecordUrl } from "./registry.js";
import type {
  ServiceNowSingleResponse,
  ServiceNowListResponse,
  CatalogVariable,
  VariableChoice,
  VariableSet,
  VariableSetItem,
  CatalogClientScript,
  CatalogUIPolicy,
  CatalogUIPolicyAction,
  CatalogItem,
} from "../servicenow/types.js";
import { validateSysId, validateIOVariable, sanitizeUpdatePayload } from "../utils/validators.js";

type WrapHandler = <T>(
  handler: (ctx: ToolContext, args: T) => Promise<unknown>
) => (args: T) => Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
}>;

const VARIABLE_TYPE_MAP: Record<string, number> = {
  yes_no: 1,
  multi_line_text: 2,
  multiple_choice: 3,
  numeric_scale: 4,
  select_box: 5,
  single_line_text: 6,
  checkbox: 7,
  reference: 8,
  date: 9,
  date_time: 10,
  label: 11,
  break: 12,
  macro: 14,
  macro_with_label: 15,
  wide_single_line_text: 16,
  lookup_select_box: 17,
  container_start: 18,
  container_end: 19,
  list_collector: 20,
  lookup_multiple_choice: 21,
  container_split: 22,
  requested_for: 23,
  ip_address: 24,
  duration: 25,
  email: 26,
  url: 27,
  html: 28,
  attachment: 29,
  rich_text_label: 30,
  custom: 31,
  custom_with_label: 32,
};

const VARIABLE_TYPE_ENUM = z.enum(
  Object.keys(VARIABLE_TYPE_MAP) as [string, ...string[]]
);

const VARIABLE_SET_TYPE_MAP: Record<string, string> = {
  one_to_one: "true",
  one_to_many: "false",
};

export function registerCatalogAdminTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  // create_catalog_item
  server.tool(
    "create_catalog_item",
    "Create a new service catalog item (form container) in ServiceNow.",
    {
      name: z.string().min(1).describe("Catalog item name"),
      short_description: z.string().min(1).describe("Brief description"),
      description: z.string().optional().describe("Full HTML description"),
      category: z.string().optional().describe("Category sys_id or name"),
      sc_catalogs: z
        .string()
        .optional()
        .describe("Catalog sys_id(s), comma-separated"),
      group: z
        .string()
        .optional()
        .describe("Fulfillment group sys_id or name"),
      active: z.boolean().optional().describe("Active state (default true)"),
      no_cart: z.boolean().optional().describe("Hide 'Add to Cart'"),
      no_quantity: z.boolean().optional().describe("Hide quantity selector"),
      workflow: z.string().optional().describe("Workflow sys_id"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          name: string;
          short_description: string;
          description?: string;
          category?: string;
          sc_catalogs?: string;
          group?: string;
          active?: boolean;
          no_cart?: boolean;
          no_quantity?: boolean;
          workflow?: string;
        }
      ) => {
        const body: Record<string, unknown> = {
          name: args.name,
          short_description: args.short_description,
        };

        if (args.description !== undefined) body.description = args.description;
        if (args.category !== undefined) body.category = args.category;
        if (args.sc_catalogs !== undefined)
          body.sc_catalogs = args.sc_catalogs;
        if (args.group !== undefined) body.group = args.group;
        if (args.active !== undefined) body.active = args.active;
        if (args.no_cart !== undefined) body.no_cart = args.no_cart;
        if (args.no_quantity !== undefined)
          body.no_quantity = args.no_quantity;
        if (args.workflow !== undefined) body.workflow = args.workflow;

        const { data } = await ctx.snClient.post<
          ServiceNowSingleResponse<CatalogItem>
        >("/api/now/table/sc_cat_item", body);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              "sc_cat_item",
              data.result.sys_id
            ),
          },
        };
      }
    )
  );

  // update_catalog_item
  server.tool(
    "update_catalog_item",
    "Update fields on an existing catalog item.",
    {
      sys_id: z.string().describe("Catalog item sys_id"),
      fields: z
        .record(z.unknown())
        .describe("Fields to update (e.g. { active: false })"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: { sys_id: string; fields: Record<string, unknown> }
      ) => {
        if (!validateSysId(args.sys_id)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Invalid sys_id format. Must be a 32-character hex string.",
            },
          };
        }

        const sanitized = sanitizeUpdatePayload(args.fields);

        const { data } = await ctx.snClient.patch<
          ServiceNowSingleResponse<CatalogItem>
        >(`/api/now/table/sc_cat_item/${args.sys_id}`, sanitized);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              "sc_cat_item",
              data.result.sys_id
            ),
          },
        };
      }
    )
  );

  // create_catalog_variable
  server.tool(
    "create_catalog_variable",
    "Create a form variable (field) on a catalog item.",
    {
      cat_item: z.string().describe("Catalog item sys_id"),
      name: z.string().min(1).describe("Internal variable name"),
      question_text: z.string().min(1).describe("Label shown to user"),
      type: VARIABLE_TYPE_ENUM.describe("Variable type"),
      mandatory: z.boolean().optional().describe("Required field (default false)"),
      order: z.number().int().optional().describe("Display order"),
      default_value: z.string().optional().describe("Default value"),
      reference: z
        .string()
        .optional()
        .describe("Reference table name (for Reference/List Collector types)"),
      reference_qual: z
        .string()
        .optional()
        .describe("Reference qualifier filter"),
      help_text: z.string().optional().describe("Help text"),
      hidden: z.boolean().optional().describe("Hidden (default false)"),
      read_only: z.boolean().optional().describe("Read only (default false)"),
      attributes: z.string().optional().describe("Widget attributes (e.g. max_length=4)"),
      validate_regex: z.string().optional().describe("Regex validation — sys_id or name of a question_regex record (e.g. 'number')"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          cat_item: string;
          name: string;
          question_text: string;
          type: string;
          mandatory?: boolean;
          order?: number;
          default_value?: string;
          reference?: string;
          reference_qual?: string;
          help_text?: string;
          hidden?: boolean;
          read_only?: boolean;
          attributes?: string;
          validate_regex?: string;
        }
      ) => {
        if (!validateSysId(args.cat_item)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Invalid cat_item sys_id format. Must be a 32-character hex string.",
            },
          };
        }

        const body: Record<string, unknown> = {
          cat_item: args.cat_item,
          name: args.name,
          question_text: args.question_text,
          type: VARIABLE_TYPE_MAP[args.type],
        };

        if (args.mandatory !== undefined) body.mandatory = args.mandatory;
        if (args.order !== undefined) body.order = args.order;
        if (args.default_value !== undefined)
          body.default_value = args.default_value;
        if (args.reference !== undefined) body.reference = args.reference;
        if (args.reference_qual !== undefined)
          body.reference_qual = args.reference_qual;
        if (args.help_text !== undefined) body.help_text = args.help_text;
        if (args.hidden !== undefined) body.hidden = args.hidden;
        if (args.read_only !== undefined) body.read_only = args.read_only;
        if (args.attributes !== undefined) body.attributes = args.attributes;
        if (args.validate_regex !== undefined) body.validate_regex = args.validate_regex;

        const { data } = await ctx.snClient.post<
          ServiceNowSingleResponse<CatalogVariable>
        >("/api/now/table/item_option_new", body);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              "item_option_new",
              data.result.sys_id
            ),
          },
        };
      }
    )
  );

  // update_catalog_variable
  server.tool(
    "update_catalog_variable",
    "Update fields on an existing catalog variable.",
    {
      sys_id: z.string().describe("Variable sys_id"),
      fields: z
        .record(z.unknown())
        .describe("Fields to update"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: { sys_id: string; fields: Record<string, unknown> }
      ) => {
        if (!validateSysId(args.sys_id)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Invalid sys_id format. Must be a 32-character hex string.",
            },
          };
        }

        const sanitized = sanitizeUpdatePayload(args.fields);

        const { data } = await ctx.snClient.patch<
          ServiceNowSingleResponse<CatalogVariable>
        >(`/api/now/table/item_option_new/${args.sys_id}`, sanitized);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              "item_option_new",
              data.result.sys_id
            ),
          },
        };
      }
    )
  );

  // list_catalog_variables
  server.tool(
    "list_catalog_variables",
    "List variables (form fields) for a catalog item, ordered by display order.",
    {
      cat_item: z.string().describe("Catalog item sys_id"),
      include_set_variables: z
        .boolean()
        .optional()
        .default(false)
        .describe("Also include variables from attached variable sets"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(50)
        .describe("Maximum results"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          cat_item: string;
          include_set_variables: boolean;
          limit: number;
        }
      ) => {
        if (!validateSysId(args.cat_item)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Invalid cat_item sys_id format. Must be a 32-character hex string.",
            },
          };
        }

        // Get direct variables on the catalog item
        const { data } = await ctx.snClient.get<
          ServiceNowListResponse<CatalogVariable>
        >("/api/now/table/item_option_new", {
          params: {
            sysparm_query: `cat_item=${args.cat_item}^ORDERBYorder`,
            sysparm_limit: args.limit,
            sysparm_fields:
              "sys_id,name,question_text,type,mandatory,order,default_value,reference,help_text,hidden,read_only,cat_item,variable_set",
          },
        });

        const variables = data.result.map((r) => ({
          ...r,
          self_link: buildRecordUrl(
            ctx.instanceUrl,
            "item_option_new",
            r.sys_id
          ),
        }));

        let setVariables: Array<
          CatalogVariable & { self_link: string }
        > = [];

        if (args.include_set_variables) {
          // Find attached variable sets
          const { data: setData } = await ctx.snClient.get<
            ServiceNowListResponse<VariableSetItem>
          >("/api/now/table/io_set_item", {
            params: {
              sysparm_query: `sc_cat_item=${args.cat_item}`,
              sysparm_limit: 100,
              sysparm_fields: "sys_id,variable_set",
            },
          });

          if (setData.result.length > 0) {
            const setIds = setData.result
              .map((s) => {
                const vs = s.variable_set;
                return typeof vs === "object" && vs !== null
                  ? (vs as { value?: string }).value || ""
                  : String(vs);
              })
              .filter(Boolean);

            if (setIds.length > 0) {
              const setQuery = `variable_setIN${setIds.join(",")}`;
              const { data: setVarData } = await ctx.snClient.get<
                ServiceNowListResponse<CatalogVariable>
              >("/api/now/table/item_option_new", {
                params: {
                  sysparm_query: `${setQuery}^ORDERBYorder`,
                  sysparm_limit: args.limit,
                  sysparm_fields:
                    "sys_id,name,question_text,type,mandatory,order,default_value,reference,help_text,hidden,read_only,cat_item,variable_set",
                },
              });

              setVariables = setVarData.result.map((r) => ({
                ...r,
                self_link: buildRecordUrl(
                  ctx.instanceUrl,
                  "item_option_new",
                  r.sys_id
                ),
              }));
            }
          }
        }

        return {
          success: true,
          data: {
            variables,
            ...(args.include_set_variables && {
              set_variables: setVariables,
            }),
          },
          metadata: {
            variable_count: variables.length,
            ...(args.include_set_variables && {
              set_variable_count: setVariables.length,
            }),
          },
        };
      }
    )
  );

  // create_variable_choice
  server.tool(
    "create_variable_choice",
    "Create a choice option for a select box or multiple choice variable.",
    {
      question: z.string().describe("Variable sys_id"),
      text: z.string().min(1).describe("Display text"),
      value: z.string().min(1).describe("Stored value"),
      order: z.number().int().optional().describe("Display order"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          question: string;
          text: string;
          value: string;
          order?: number;
        }
      ) => {
        if (!validateSysId(args.question)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Invalid question sys_id format. Must be a 32-character hex string.",
            },
          };
        }

        const body: Record<string, unknown> = {
          question: args.question,
          text: args.text,
          value: args.value,
        };

        if (args.order !== undefined) body.order = args.order;

        const { data } = await ctx.snClient.post<
          ServiceNowSingleResponse<VariableChoice>
        >("/api/now/table/question_choice", body);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              "question_choice",
              data.result.sys_id
            ),
          },
        };
      }
    )
  );

  // create_variable_set
  server.tool(
    "create_variable_set",
    "Create a reusable variable set that can be attached to multiple catalog items.",
    {
      title: z.string().min(1).describe("Display name"),
      internal_name: z.string().min(1).describe("Internal identifier"),
      type: z
        .enum(["one_to_one", "one_to_many"])
        .optional()
        .describe("Single Row (one_to_one, default) or Multi Row (one_to_many)"),
      description: z.string().optional().describe("Description"),
      order: z.number().int().optional().describe("Display order"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          title: string;
          internal_name: string;
          type?: string;
          description?: string;
          order?: number;
        }
      ) => {
        const body: Record<string, unknown> = {
          title: args.title,
          internal_name: args.internal_name,
        };

        if (args.type !== undefined)
          body.type = VARIABLE_SET_TYPE_MAP[args.type] ?? args.type;
        if (args.description !== undefined)
          body.description = args.description;
        if (args.order !== undefined) body.order = args.order;

        const { data } = await ctx.snClient.post<
          ServiceNowSingleResponse<VariableSet>
        >("/api/now/table/item_option_new_set", body);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              "item_option_new_set",
              data.result.sys_id
            ),
          },
        };
      }
    )
  );

  // attach_variable_set
  server.tool(
    "attach_variable_set",
    "Attach a variable set to a catalog item via the M2M table.",
    {
      sc_cat_item: z.string().describe("Catalog item sys_id"),
      variable_set: z.string().describe("Variable set sys_id"),
      order: z.number().int().optional().describe("Display order"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          sc_cat_item: string;
          variable_set: string;
          order?: number;
        }
      ) => {
        if (!validateSysId(args.sc_cat_item)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Invalid sc_cat_item sys_id format. Must be a 32-character hex string.",
            },
          };
        }
        if (!validateSysId(args.variable_set)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Invalid variable_set sys_id format. Must be a 32-character hex string.",
            },
          };
        }

        const body: Record<string, unknown> = {
          sc_cat_item: args.sc_cat_item,
          variable_set: args.variable_set,
        };

        if (args.order !== undefined) body.order = args.order;

        const { data } = await ctx.snClient.post<
          ServiceNowSingleResponse<VariableSetItem>
        >("/api/now/table/io_set_item", body);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              "io_set_item",
              data.result.sys_id
            ),
          },
        };
      }
    )
  );

  // create_catalog_client_script
  server.tool(
    "create_catalog_client_script",
    "Create a client-side script (onChange/onLoad/onSubmit) for a catalog item or variable set.",
    {
      name: z.string().min(1).describe("Script name"),
      cat_item: z
        .string()
        .optional()
        .describe("Catalog item sys_id (required unless applies_to is 'A Variable Set')"),
      type: z
        .enum(["onChange", "onLoad", "onSubmit"])
        .describe("Script trigger type"),
      script: z.string().min(1).describe("JavaScript function body"),
      cat_variable: z
        .string()
        .optional()
        .describe("Variable name for onChange (IO:{sys_id} format)"),
      applies_to: z
        .enum(["A Catalog Item", "A Variable Set"])
        .optional()
        .describe("Target type (default 'A Catalog Item')"),
      variable_set: z
        .string()
        .optional()
        .describe("Variable set sys_id (when applies_to is 'A Variable Set')"),
      ui_type: z
        .enum(["All", "Desktop", "Mobile"])
        .optional()
        .describe("UI type (default 'All')"),
      active: z.boolean().optional().describe("Active (default true)"),
      applies_catalog: z
        .boolean()
        .optional()
        .describe("Applies on catalog item view (default true)"),
      applies_req_item: z
        .boolean()
        .optional()
        .describe("Applies on requested items (default false)"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          name: string;
          cat_item?: string;
          type: string;
          script: string;
          cat_variable?: string;
          applies_to?: string;
          variable_set?: string;
          ui_type?: string;
          active?: boolean;
          applies_catalog?: boolean;
          applies_req_item?: boolean;
        }
      ) => {
        // Cross-field target validation
        const targetsVariableSet = args.applies_to === "A Variable Set";
        if (targetsVariableSet && !args.variable_set) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "variable_set is required when applies_to is 'A Variable Set'.",
            },
          };
        }
        if (!targetsVariableSet && !args.cat_item) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "cat_item is required when applies_to is 'A Catalog Item' (or omitted).",
            },
          };
        }

        // Require cat_variable for onChange scripts
        if (args.type === "onChange" && !args.cat_variable) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "cat_variable is required for onChange scripts (IO:{variable_sys_id} format).",
            },
          };
        }

        // Validate IO:{sys_id} format for cat_variable when provided
        if (args.cat_variable && !validateIOVariable(args.cat_variable)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Invalid cat_variable format. Must be IO:{32-character hex sys_id} (e.g. IO:abc123def456...).",
            },
          };
        }

        if (args.cat_item && !validateSysId(args.cat_item)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Invalid cat_item sys_id format. Must be a 32-character hex string.",
            },
          };
        }
        if (args.variable_set && !validateSysId(args.variable_set)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Invalid variable_set sys_id format. Must be a 32-character hex string.",
            },
          };
        }

        const body: Record<string, unknown> = {
          name: args.name,
          type: args.type,
          script: args.script,
        };

        if (args.cat_item !== undefined) body.cat_item = args.cat_item;
        if (args.cat_variable !== undefined)
          body.cat_variable = args.cat_variable;
        if (args.applies_to !== undefined)
          body.applies_to = args.applies_to;
        if (args.variable_set !== undefined)
          body.variable_set = args.variable_set;
        if (args.ui_type !== undefined) body.ui_type = args.ui_type;
        if (args.active !== undefined) body.active = args.active;
        if (args.applies_catalog !== undefined)
          body.applies_catalog = args.applies_catalog;
        if (args.applies_req_item !== undefined)
          body.applies_req_item = args.applies_req_item;

        const { data } = await ctx.snClient.post<
          ServiceNowSingleResponse<CatalogClientScript>
        >("/api/now/table/catalog_script_client", body);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              "catalog_script_client",
              data.result.sys_id
            ),
          },
        };
      }
    )
  );

  // update_catalog_client_script
  server.tool(
    "update_catalog_client_script",
    "Update fields on an existing catalog client script.",
    {
      sys_id: z.string().describe("Client script sys_id"),
      fields: z
        .record(z.unknown())
        .describe("Fields to update (e.g. { active: false })"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: { sys_id: string; fields: Record<string, unknown> }
      ) => {
        if (!validateSysId(args.sys_id)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Invalid sys_id format. Must be a 32-character hex string.",
            },
          };
        }

        const sanitized = sanitizeUpdatePayload(args.fields);

        const { data } = await ctx.snClient.patch<
          ServiceNowSingleResponse<CatalogClientScript>
        >(`/api/now/table/catalog_script_client/${args.sys_id}`, sanitized);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              "catalog_script_client",
              data.result.sys_id
            ),
          },
        };
      }
    )
  );

  // create_catalog_ui_policy
  server.tool(
    "create_catalog_ui_policy",
    "Create a UI policy (declarative show/hide/mandatory rules) for a catalog item or variable set.",
    {
      short_description: z.string().min(1).describe("Policy name"),
      catalog_item: z
        .string()
        .optional()
        .describe("Catalog item sys_id (required unless applies_to is 'A Variable Set')"),
      catalog_conditions: z
        .string()
        .min(1)
        .describe("Variable conditions (e.g. 'IO:{var_sys_id}=value^EQ')"),
      on_load: z.boolean().optional().describe("Run on form load (default true)"),
      reverse_if_false: z
        .boolean()
        .optional()
        .describe("Reverse actions when condition false (default true)"),
      order: z.number().int().optional().describe("Evaluation order (default 100)"),
      applies_to: z
        .enum(["A Catalog Item", "A Variable Set"])
        .optional()
        .describe("Target type (default 'A Catalog Item')"),
      variable_set: z
        .string()
        .optional()
        .describe("Variable set sys_id"),
      ui_type: z
        .enum(["Desktop", "Mobile", "Both"])
        .optional()
        .describe("UI type (default 'Desktop')"),
      run_scripts: z
        .boolean()
        .optional()
        .describe("Execute script (default false)"),
      script_true: z
        .string()
        .optional()
        .describe("JavaScript when condition true"),
      script_false: z
        .string()
        .optional()
        .describe("JavaScript when condition false"),
      active: z.boolean().optional().describe("Active (default true)"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          short_description: string;
          catalog_item?: string;
          catalog_conditions: string;
          on_load?: boolean;
          reverse_if_false?: boolean;
          order?: number;
          applies_to?: string;
          variable_set?: string;
          ui_type?: string;
          run_scripts?: boolean;
          script_true?: string;
          script_false?: string;
          active?: boolean;
        }
      ) => {
        // Cross-field target validation
        const policyTargetsVariableSet = args.applies_to === "A Variable Set";
        if (policyTargetsVariableSet && !args.variable_set) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "variable_set is required when applies_to is 'A Variable Set'.",
            },
          };
        }
        if (!policyTargetsVariableSet && !args.catalog_item) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "catalog_item is required when applies_to is 'A Catalog Item' (or omitted).",
            },
          };
        }

        if (args.catalog_item && !validateSysId(args.catalog_item)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Invalid catalog_item sys_id format. Must be a 32-character hex string.",
            },
          };
        }
        if (args.variable_set && !validateSysId(args.variable_set)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Invalid variable_set sys_id format. Must be a 32-character hex string.",
            },
          };
        }

        const body: Record<string, unknown> = {
          short_description: args.short_description,
          catalog_conditions: args.catalog_conditions,
        };

        if (args.catalog_item !== undefined)
          body.catalog_item = args.catalog_item;
        if (args.on_load !== undefined) body.on_load = args.on_load;
        if (args.reverse_if_false !== undefined)
          body.reverse_if_false = args.reverse_if_false;
        if (args.order !== undefined) body.order = args.order;
        if (args.applies_to !== undefined)
          body.applies_to = args.applies_to;
        if (args.variable_set !== undefined)
          body.variable_set = args.variable_set;
        if (args.ui_type !== undefined) body.ui_type = args.ui_type;
        if (args.run_scripts !== undefined)
          body.run_scripts = args.run_scripts;
        if (args.script_true !== undefined)
          body.script_true = args.script_true;
        if (args.script_false !== undefined)
          body.script_false = args.script_false;
        if (args.active !== undefined) body.active = args.active;

        const { data } = await ctx.snClient.post<
          ServiceNowSingleResponse<CatalogUIPolicy>
        >("/api/now/table/catalog_ui_policy", body);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              "catalog_ui_policy",
              data.result.sys_id
            ),
          },
        };
      }
    )
  );

  // create_catalog_ui_policy_action
  server.tool(
    "create_catalog_ui_policy_action",
    "Create a field action within a catalog UI policy (set visible/mandatory/disabled).",
    {
      ui_policy: z.string().describe("UI policy sys_id"),
      catalog_variable: z
        .string()
        .describe("Variable identifier (IO:{sys_id} format)"),
      visible: z
        .enum(["true", "false", "Leave alone"])
        .optional()
        .describe("Field visibility"),
      mandatory: z
        .enum(["true", "false", "Leave alone"])
        .optional()
        .describe("Field mandatory state"),
      disabled: z
        .enum(["true", "false", "Leave alone"])
        .optional()
        .describe("Field disabled state"),
      cleared: z
        .boolean()
        .optional()
        .describe("Clear value when hidden (default false)"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          ui_policy: string;
          catalog_variable: string;
          visible?: string;
          mandatory?: string;
          disabled?: string;
          cleared?: boolean;
        }
      ) => {
        if (!validateSysId(args.ui_policy)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Invalid ui_policy sys_id format. Must be a 32-character hex string.",
            },
          };
        }

        if (!validateIOVariable(args.catalog_variable)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Invalid catalog_variable format. Must be IO:{32-character hex sys_id} (e.g. IO:abc123def456...).",
            },
          };
        }

        const body: Record<string, unknown> = {
          ui_policy: args.ui_policy,
          catalog_variable: args.catalog_variable,
        };

        if (args.visible !== undefined) body.visible = args.visible;
        if (args.mandatory !== undefined) body.mandatory = args.mandatory;
        if (args.disabled !== undefined) body.disabled = args.disabled;
        if (args.cleared !== undefined) body.cleared = args.cleared;

        const { data } = await ctx.snClient.post<
          ServiceNowSingleResponse<CatalogUIPolicyAction>
        >("/api/now/table/catalog_ui_policy_action", body);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              "catalog_ui_policy_action",
              data.result.sys_id
            ),
          },
        };
      }
    )
  );
}

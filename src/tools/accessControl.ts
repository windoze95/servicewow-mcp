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

// Access controls (sys_security_acl). `name` is the table (e.g. 'incident') or
// table.field (e.g. 'incident.state'); `operation` is read/write/create/delete;
// `type` is record/field/etc. The roles that satisfy an ACL are the M2M rows in
// sys_security_acl_role (joined via `sys_security_acl` → `sys_user_role`); the
// `condition` and `script` further gate access.
const ACL_TABLE = "sys_security_acl";
const ACL_ROLE_TABLE = "sys_security_acl_role";
const ACL_SUMMARY_FIELDS = [
  "sys_id",
  "name",
  "operation",
  "type",
  "active",
  "admin_overrides",
  "description",
  "sys_updated_on",
].join(",");
const ACL_ROLE_FIELDS = ["sys_id", "sys_user_role"].join(",");

interface SysIdRecord {
  sys_id: string;
  [key: string]: unknown;
}

export function registerAccessControlTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  // search_acls
  server.tool(
    "search_acls",
    "Search access controls (sys_security_acl) by name, operation, type, and active flag. `name` is the table or table.field the rule protects (e.g. 'incident' or 'incident.state'); `operation` is the action it governs. Use this to find which ACLs gate writing a field — e.g. search name='incident.state', operation='write' — then get_acl to read the roles, condition, and script. Returns a paginated summary ordered by name.",
    {
      name: z
        .string()
        .optional()
        .describe(
          "Filter by the protected table or table.field (LIKE match), e.g. 'incident.state' or 'incident'"
        ),
      operation: z
        .string()
        .optional()
        .describe(
          "Filter by operation: 'read', 'write', 'create', or 'delete'"
        ),
      type: z
        .string()
        .optional()
        .describe("Filter by ACL type, e.g. 'record' or 'field'"),
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
          name?: string;
          operation?: string;
          type?: string;
          active?: boolean;
          limit: number;
          offset: number;
        }
      ) => {
        const queryParts: string[] = [];
        if (args.name) {
          queryParts.push(`nameLIKE${sanitizeValue(args.name)}`);
        }
        if (args.operation) {
          queryParts.push(`operation=${sanitizeValue(args.operation)}`);
        }
        if (args.type) {
          queryParts.push(`type=${sanitizeValue(args.type)}`);
        }
        if (typeof args.active === "boolean") {
          queryParts.push(`active=${args.active ? "true" : "false"}`);
        }
        queryParts.push("ORDERBYname");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<SysIdRecord>
        >(`/api/now/table/${ACL_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields: ACL_SUMMARY_FIELDS,
          },
        });

        return {
          success: true,
          data: data.result.map((r) => ({
            ...r,
            self_link: buildRecordUrl(ctx.instanceUrl, ACL_TABLE, r.sys_id),
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

  // get_acl
  server.tool(
    "get_acl",
    "Get one access control (sys_security_acl) by sys_id with its full record — including the `condition` and `script` that gate access and the `admin_overrides` flag — plus the roles that satisfy it from sys_security_acl_role (joined via sys_security_acl → sys_user_role, returned as role names). Use this to answer 'who can perform this operation on this field/table'.",
    {
      sys_id: z.string().describe("Access control sys_id (32 hex chars)"),
      role_limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(200)
        .describe("Maximum sys_security_acl_role rows to return"),
    },
    wrapHandler(
      async (ctx: ToolContext, args: { sys_id: string; role_limit: number }) => {
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
        >(`/api/now/table/${ACL_TABLE}/${args.sys_id}`);

        // sys_security_acl_role links roles to the ACL via `sys_security_acl`.
        const { data: roleData, headers: roleHeaders } =
          await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
            `/api/now/table/${ACL_ROLE_TABLE}`,
            {
              params: {
                sysparm_query: `sys_security_acl=${args.sys_id}`,
                sysparm_limit: args.role_limit,
                sysparm_fields: ACL_ROLE_FIELDS,
              },
            }
          );
        const roleTotal = parseInt(roleHeaders["x-total-count"] || "0", 10);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(
              ctx.instanceUrl,
              ACL_TABLE,
              data.result.sys_id
            ),
            roles: roleData.result.map((r) => ({
              ...r,
              self_link: buildRecordUrl(
                ctx.instanceUrl,
                ACL_ROLE_TABLE,
                r.sys_id
              ),
            })),
            role_metadata: {
              total_count: roleTotal,
              returned_count: roleData.result.length,
              truncated: roleTotal > roleData.result.length,
            },
          },
        };
      }
    )
  );
}

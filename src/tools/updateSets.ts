import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./registry.js";
import { buildRecordUrl } from "./registry.js";
import type { ServiceNowListResponse, ServiceNowSingleResponse } from "../servicenow/types.js";
import { validateSysId } from "../utils/validators.js";
import { sanitizeValue } from "../servicenow/queryBuilder.js";

type WrapHandler = <T>(
  handler: (ctx: ToolContext, args: T) => Promise<unknown>
) => (args: T) => Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
}>;

interface UpdateSetRecord {
  sys_id: string;
  name?: string;
  state?: string;
  application?: unknown;
  sys_updated_on?: string;
}

interface UserPreferenceRecord {
  sys_id: string;
  name: string;
  user: string;
  value: string;
}

export function registerUpdateSetTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  server.tool(
    "change_update_set",
    "Change the authenticated user's current ServiceNow update set by sys_id or name.",
    {
      identifier: z
        .string()
        .min(1)
        .describe("Update set sys_id or exact update set name"),
    },
    wrapHandler(async (ctx: ToolContext, args: { identifier: string }) => {
      const isSysId = validateSysId(args.identifier);
      const safeIdentifier = sanitizeValue(args.identifier);
      const encodedQuery = isSysId
        ? `sys_id=${safeIdentifier}^state=in progress`
        : `name=${safeIdentifier}^state=in progress^ORDERBYDESCsys_updated_on`;

      const { data: updateSetData } = await ctx.snClient.get<
        ServiceNowListResponse<UpdateSetRecord>
      >("/api/now/table/sys_update_set", {
        params: {
          sysparm_query: encodedQuery,
          sysparm_limit: isSysId ? 1 : 5,
          sysparm_fields: "sys_id,name,state,application,sys_updated_on",
        },
      });

      if (!updateSetData.result.length) {
        return {
          success: false,
          error: {
            code: "NOT_FOUND",
            message:
              "No in-progress update set found for the provided identifier.",
          },
        };
      }

      if (!isSysId && updateSetData.result.length > 1) {
        return {
          success: false,
          error: {
            code: "AMBIGUOUS_MATCH",
            message:
              "Multiple in-progress update sets match this name. Use a sys_id instead.",
            details: {
              matches: updateSetData.result.map((item) => ({
                sys_id: item.sys_id,
                name: item.name,
                state: item.state,
                sys_updated_on: item.sys_updated_on,
              })),
            },
          },
        };
      }

      const targetUpdateSet = updateSetData.result[0];

      const { data: preferenceData } = await ctx.snClient.get<
        ServiceNowListResponse<UserPreferenceRecord>
      >("/api/now/table/sys_user_preference", {
        params: {
          sysparm_query: `name=sys_update_set^user=${ctx.userSysId}`,
          sysparm_limit: 1,
          sysparm_fields: "sys_id,name,user,value",
        },
      });

      if (preferenceData.result.length) {
        await ctx.snClient.patch(
          `/api/now/table/sys_user_preference/${preferenceData.result[0].sys_id}`,
          { value: targetUpdateSet.sys_id }
        );
      } else {
        await ctx.snClient.post("/api/now/table/sys_user_preference", {
          name: "sys_update_set",
          user: ctx.userSysId,
          value: targetUpdateSet.sys_id,
          type: "string",
        });
      }

      return {
        success: true,
        data: {
          current_update_set: {
            sys_id: targetUpdateSet.sys_id,
            name: targetUpdateSet.name,
            state: targetUpdateSet.state,
            application: targetUpdateSet.application,
            self_link: buildRecordUrl(ctx.instanceUrl, "sys_update_set", targetUpdateSet.sys_id),
          },
        },
      };
    })
  );

  // create_update_set
  server.tool(
    "create_update_set",
    "Create a new update set in ServiceNow and optionally set it as the current update set.",
    {
      name: z.string().min(1).describe("Name of the new update set"),
      description: z.string().optional().describe("Description of the update set"),
      set_as_current: z
        .boolean()
        .optional()
        .default(true)
        .describe("Set this as the current update set (default: true)"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: { name: string; description?: string; set_as_current: boolean }
      ) => {
        // Create the update set
        const body: Record<string, unknown> = {
          name: args.name,
          state: "in progress",
        };
        if (args.description) body.description = args.description;

        const { data: createData } = await ctx.snClient.post<
          ServiceNowSingleResponse<UpdateSetRecord>
        >("/api/now/table/sys_update_set", body);

        const newUpdateSet = createData.result;

        // Optionally set as current
        if (args.set_as_current) {
          const { data: preferenceData } = await ctx.snClient.get<
            ServiceNowListResponse<UserPreferenceRecord>
          >("/api/now/table/sys_user_preference", {
            params: {
              sysparm_query: `name=sys_update_set^user=${ctx.userSysId}`,
              sysparm_limit: 1,
              sysparm_fields: "sys_id,name,user,value",
            },
          });

          if (preferenceData.result.length) {
            await ctx.snClient.patch(
              `/api/now/table/sys_user_preference/${preferenceData.result[0].sys_id}`,
              { value: newUpdateSet.sys_id }
            );
          } else {
            await ctx.snClient.post("/api/now/table/sys_user_preference", {
              name: "sys_update_set",
              user: ctx.userSysId,
              value: newUpdateSet.sys_id,
              type: "string",
            });
          }
        }

        return {
          success: true,
          data: {
            update_set: {
              sys_id: newUpdateSet.sys_id,
              name: newUpdateSet.name,
              state: newUpdateSet.state,
              self_link: buildRecordUrl(ctx.instanceUrl, "sys_update_set", newUpdateSet.sys_id),
            },
            set_as_current: args.set_as_current,
          },
        };
      }
    )
  );
}

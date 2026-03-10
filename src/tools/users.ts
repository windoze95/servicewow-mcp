import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./registry.js";
import type { ServiceNowListResponse, ServiceNowSingleResponse, User, Group } from "../servicenow/types.js";
import { buildEncodedQuery, type QueryFilter } from "../servicenow/queryBuilder.js";

type WrapHandler = <T>(
  handler: (ctx: ToolContext, args: T) => Promise<unknown>
) => (args: T) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;

export function registerUserTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  // lookup_user
  server.tool(
    "lookup_user",
    "Search for a ServiceNow user by name, email, or employee ID. Returns user profile information.",
    {
      query: z.string().describe("Search term: name, email, or employee ID"),
      limit: z.number().int().min(1).max(50).default(10).describe("Maximum results to return"),
    },
    wrapHandler(async (ctx: ToolContext, args: { query: string; limit: number }) => {
      const filters: QueryFilter[] = [];
      const q = args.query;

      // Build OR query for name, email, employee_number
      const encodedQuery = `nameLIKE${q}^ORemail=${q}^ORemployee_number=${q}^ORuser_name=${q}`;

      const { data, headers } = await ctx.snClient.get<ServiceNowListResponse<User>>(
        "/api/now/table/sys_user",
        {
          params: {
            sysparm_query: encodedQuery,
            sysparm_limit: args.limit,
            sysparm_fields: "sys_id,user_name,name,first_name,last_name,email,phone,department,title,manager,active,employee_number,location",
          },
        }
      );

      return {
        success: true,
        data: data.result,
        metadata: {
          total_count: parseInt(headers["x-total-count"] || "0", 10),
          returned_count: data.result.length,
        },
      };
    })
  );

  // lookup_group
  server.tool(
    "lookup_group",
    "Search for a ServiceNow assignment group by name. Returns group details.",
    {
      query: z.string().describe("Group name to search for"),
      limit: z.number().int().min(1).max(50).default(10).describe("Maximum results to return"),
    },
    wrapHandler(async (ctx: ToolContext, args: { query: string; limit: number }) => {
      const { data, headers } = await ctx.snClient.get<ServiceNowListResponse<Group>>(
        "/api/now/table/sys_user_group",
        {
          params: {
            sysparm_query: `nameLIKE${args.query}^active=true`,
            sysparm_limit: args.limit,
            sysparm_fields: "sys_id,name,description,manager,email,active,type",
          },
        }
      );

      return {
        success: true,
        data: data.result,
        metadata: {
          total_count: parseInt(headers["x-total-count"] || "0", 10),
          returned_count: data.result.length,
        },
      };
    })
  );

  // get_my_profile
  server.tool(
    "get_my_profile",
    "Get the authenticated user's own ServiceNow profile information.",
    {},
    wrapHandler(async (ctx: ToolContext, _args: Record<string, never>) => {
      const { data } = await ctx.snClient.get<ServiceNowSingleResponse<User>>(
        `/api/now/table/sys_user/${ctx.userSysId}`,
        {
          params: {
            sysparm_fields: "sys_id,user_name,name,first_name,last_name,email,phone,department,title,manager,active,employee_number,location,photo",
          },
        }
      );

      return {
        success: true,
        data: data.result,
      };
    })
  );
}

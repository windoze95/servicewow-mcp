import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./registry.js";
import type {
  ServiceNowListResponse,
  ServiceNowSingleResponse,
  Task,
  Approval,
} from "../servicenow/types.js";
import { validateSysId } from "../utils/validators.js";

type WrapHandler = <T>(
  handler: (ctx: ToolContext, args: T) => Promise<unknown>
) => (args: T) => Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
}>;

export function registerTaskTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  // get_my_tasks
  server.tool(
    "get_my_tasks",
    "Get all open tasks assigned to the authenticated user across all task types (incidents, requests, changes, etc.).",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum results"),
      offset: z.number().int().min(0).default(0).describe("Result offset"),
    },
    wrapHandler(async (ctx: ToolContext, args: { limit: number; offset: number }) => {
      const { data, headers } = await ctx.snClient.get<
        ServiceNowListResponse<Task>
      >("/api/now/table/task", {
        params: {
          sysparm_query: `assigned_to=${ctx.userSysId}^active=true^ORDERBYDESCsys_updated_on`,
          sysparm_limit: args.limit,
          sysparm_offset: args.offset,
          sysparm_fields:
            "sys_id,number,short_description,state,priority,assigned_to,assignment_group,sys_class_name,opened_at,due_date,sys_updated_on",
        },
      });

      return {
        success: true,
        data: data.result,
        metadata: {
          total_count: parseInt(headers["x-total-count"] || "0", 10),
          returned_count: data.result.length,
          offset: args.offset,
        },
      };
    })
  );

  // get_my_approvals
  server.tool(
    "get_my_approvals",
    "Get pending approvals for the authenticated user.",
    {
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum results"),
    },
    wrapHandler(async (ctx: ToolContext, args: { limit: number }) => {
      const { data, headers } = await ctx.snClient.get<
        ServiceNowListResponse<Approval>
      >("/api/now/table/sysapproval_approver", {
        params: {
          sysparm_query: `approver=${ctx.userSysId}^state=requested^ORDERBYDESCsys_created_on`,
          sysparm_limit: args.limit,
          sysparm_fields:
            "sys_id,state,approver,sysapproval,source_table,comments,due_date,sys_created_on",
        },
      });

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

  // approve_or_reject
  server.tool(
    "approve_or_reject",
    "Approve or reject a pending approval with optional comments.",
    {
      sys_id: z.string().describe("Approval record sys_id"),
      action: z.enum(["approved", "rejected"]).describe("Approve or reject"),
      comments: z.string().optional().describe("Comments for the approval decision"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: { sys_id: string; action: "approved" | "rejected"; comments?: string }
      ) => {
        if (!validateSysId(args.sys_id)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid sys_id format",
            },
          };
        }

        // Verify approval belongs to the authenticated user
        const { data: verifyData } = await ctx.snClient.get<
          ServiceNowListResponse<Approval>
        >("/api/now/table/sysapproval_approver", {
          params: {
            sysparm_query: `sys_id=${args.sys_id}^approver=${ctx.userSysId}`,
            sysparm_limit: 1,
            sysparm_fields: "sys_id",
          },
        });

        if (!verifyData.result || verifyData.result.length === 0) {
          return {
            success: false,
            error: {
              code: "FORBIDDEN",
              message: "Approval not found or does not belong to the authenticated user",
            },
          };
        }

        const body: Record<string, string> = { state: args.action };
        if (args.comments) body.comments = args.comments;

        const { data } = await ctx.snClient.patch<
          ServiceNowSingleResponse<Approval>
        >(`/api/now/table/sysapproval_approver/${args.sys_id}`, body);

        return {
          success: true,
          data: data.result,
          message: `Approval ${args.action} successfully`,
        };
      }
    )
  );
}

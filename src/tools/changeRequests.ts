import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./registry.js";
import { buildRecordUrl } from "./registry.js";
import type {
  ServiceNowListResponse,
  ServiceNowSingleResponse,
  ChangeRequest,
  Approval,
} from "../servicenow/types.js";
import {
  validateSysId,
  validateChangeNumber,
  sanitizeUpdatePayload,
} from "../utils/validators.js";
import { sanitizeValue } from "../servicenow/queryBuilder.js";
import { paginateAll } from "../servicenow/paginator.js";

type WrapHandler = <T>(
  handler: (ctx: ToolContext, args: T) => Promise<unknown>
) => (args: T) => Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
}>;

async function resolveChangeRequestSysId(
  ctx: ToolContext,
  identifier: string
): Promise<
  | { sysId: string }
  | { error: { success: false; error: { code: string; message: string } } }
> {
  if (validateChangeNumber(identifier)) {
    const { data: lookupData } = await ctx.snClient.get<
      ServiceNowListResponse<ChangeRequest>
    >("/api/now/table/change_request", {
      params: {
        sysparm_query: `number=${identifier}`,
        sysparm_limit: 1,
        sysparm_fields: "sys_id",
      },
    });
    if (!lookupData.result.length) {
      return {
        error: {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `No change request found: ${identifier}`,
          },
        },
      };
    }
    return { sysId: lookupData.result[0].sys_id };
  } else if (validateSysId(identifier)) {
    return { sysId: identifier };
  } else {
    return {
      error: {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message:
            "Invalid identifier. Provide a change number (CHG...) or a 32-character sys_id.",
        },
      },
    };
  }
}

export function registerChangeRequestTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  // search_change_requests
  server.tool(
    "search_change_requests",
    "Search for change requests with various filters. Returns a paginated summary list.",
    {
      query: z
        .string()
        .optional()
        .describe("Free-text search in short description"),
      state: z
        .string()
        .optional()
        .describe("Filter by state (e.g. 'New', 'Assess', 'Implement', 'Review', 'Closed')"),
      type: z
        .string()
        .optional()
        .describe("Filter by type (Normal, Standard, Emergency)"),
      priority: z
        .string()
        .optional()
        .describe("Filter by priority (1-5)"),
      assigned_to_me: z
        .boolean()
        .optional()
        .default(false)
        .describe("Only show change requests assigned to me"),
      assignment_group: z
        .string()
        .optional()
        .describe("Filter by assignment group name"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(10)
        .describe("Maximum results"),
      offset: z.number().int().min(0).default(0).describe("Result offset for pagination"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          query?: string;
          state?: string;
          type?: string;
          priority?: string;
          assigned_to_me?: boolean;
          assignment_group?: string;
          limit: number;
          offset: number;
        }
      ) => {
        const queryParts: string[] = [];

        if (args.query) {
          queryParts.push(`short_descriptionLIKE${sanitizeValue(args.query)}`);
        }
        if (args.state) {
          queryParts.push(`state=${sanitizeValue(args.state)}`);
        }
        if (args.type) {
          queryParts.push(`type=${sanitizeValue(args.type)}`);
        }
        if (args.priority) {
          queryParts.push(`priority=${sanitizeValue(args.priority)}`);
        }
        if (args.assigned_to_me) {
          queryParts.push(`assigned_to=${ctx.userSysId}`);
        }
        if (args.assignment_group) {
          queryParts.push(`assignment_groupLIKE${sanitizeValue(args.assignment_group)}`);
        }

        queryParts.push("ORDERBYDESCsys_updated_on");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<ChangeRequest>
        >("/api/now/table/change_request", {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields:
              "sys_id,number,short_description,state,type,priority,impact,urgency,risk,assigned_to,assignment_group,requested_by,category,start_date,end_date,sys_updated_on",
          },
        });

        return {
          success: true,
          data: data.result.map((r) => ({
            ...r,
            self_link: buildRecordUrl(ctx.instanceUrl, "change_request", r.sys_id),
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

  // get_change_request
  server.tool(
    "get_change_request",
    "Get full details of a specific change request by change number (CHG...) or sys_id.",
    {
      identifier: z
        .string()
        .describe("Change number (e.g. CHG0012345) or sys_id"),
    },
    wrapHandler(async (ctx: ToolContext, args: { identifier: string }) => {
      let path: string;
      let params: Record<string, string | number | boolean> = {};

      if (validateChangeNumber(args.identifier)) {
        path = "/api/now/table/change_request";
        params = {
          sysparm_query: `number=${args.identifier}`,
          sysparm_limit: 1,
        };
      } else if (validateSysId(args.identifier)) {
        path = `/api/now/table/change_request/${args.identifier}`;
      } else {
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message:
              "Invalid identifier. Provide a change number (CHG...) or a 32-character sys_id.",
          },
        };
      }

      const { data } = await ctx.snClient.get<
        ServiceNowSingleResponse<ChangeRequest> | ServiceNowListResponse<ChangeRequest>
      >(path, { params });

      const result = "result" in data
        ? Array.isArray(data.result)
          ? data.result[0]
          : data.result
        : null;

      if (!result) {
        return {
          success: false,
          error: {
            code: "NOT_FOUND",
            message: `No change request found with identifier: ${args.identifier}`,
          },
        };
      }

      return {
        success: true,
        data: {
          ...result,
          self_link: buildRecordUrl(ctx.instanceUrl, "change_request", result.sys_id),
        },
      };
    })
  );

  // create_change_request
  server.tool(
    "create_change_request",
    "Create a new change request in ServiceNow. Requires at least a short description.",
    {
      short_description: z.string().min(1).describe("Brief summary of the change"),
      description: z.string().optional().describe("Detailed description"),
      type: z.string().optional().describe("Change type (Normal, Standard, Emergency)"),
      impact: z.number().int().min(1).max(3).optional().describe("Impact (1=High, 2=Medium, 3=Low)"),
      urgency: z.number().int().min(1).max(3).optional().describe("Urgency (1=High, 2=Medium, 3=Low)"),
      category: z.string().optional().describe("Change category"),
      assignment_group: z.string().optional().describe("Assignment group name or sys_id"),
      cmdb_ci: z.string().optional().describe("Configuration item name or sys_id"),
      start_date: z.string().optional().describe("Planned start date (ISO 8601)"),
      end_date: z.string().optional().describe("Planned end date (ISO 8601)"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          short_description: string;
          description?: string;
          type?: string;
          impact?: number;
          urgency?: number;
          category?: string;
          assignment_group?: string;
          cmdb_ci?: string;
          start_date?: string;
          end_date?: string;
        }
      ) => {
        const body: Record<string, unknown> = {
          short_description: args.short_description,
          requested_by: ctx.userSysId,
        };

        if (args.description) body.description = args.description;
        if (args.type) body.type = args.type;
        if (args.impact) body.impact = args.impact;
        if (args.urgency) body.urgency = args.urgency;
        if (args.category) body.category = args.category;
        if (args.assignment_group) body.assignment_group = args.assignment_group;
        if (args.cmdb_ci) body.cmdb_ci = args.cmdb_ci;
        if (args.start_date) body.start_date = args.start_date;
        if (args.end_date) body.end_date = args.end_date;

        const { data } = await ctx.snClient.post<
          ServiceNowSingleResponse<ChangeRequest>
        >("/api/now/table/change_request", body);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(ctx.instanceUrl, "change_request", data.result.sys_id),
          },
        };
      }
    )
  );

  // update_change_request
  server.tool(
    "update_change_request",
    "Update fields on an existing change request. Provide the change number or sys_id and the fields to update.",
    {
      identifier: z
        .string()
        .describe("Change number (CHG...) or sys_id"),
      fields: z
        .record(z.unknown())
        .describe(
          "Fields to update (e.g. { state: 'Implement', assignment_group: 'CAB' })"
        ),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: { identifier: string; fields: Record<string, unknown> }
      ) => {
        const resolved = await resolveChangeRequestSysId(ctx, args.identifier);
        if ("error" in resolved) return resolved.error;

        const sanitized = sanitizeUpdatePayload(args.fields);

        const { data } = await ctx.snClient.patch<
          ServiceNowSingleResponse<ChangeRequest>
        >(`/api/now/table/change_request/${resolved.sysId}`, sanitized);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(ctx.instanceUrl, "change_request", data.result.sys_id),
          },
        };
      }
    )
  );

  // get_change_request_approvals
  server.tool(
    "get_change_request_approvals",
    "Get approval records linked to a change request.",
    {
      identifier: z.string().describe("Change number (CHG...) or sys_id"),
      offset: z.number().int().min(0).default(0).describe("Starting offset for continuation when previous response was truncated"),
    },
    wrapHandler(
      async (ctx: ToolContext, args: { identifier: string; offset: number }) => {
        const resolved = await resolveChangeRequestSysId(ctx, args.identifier);
        if ("error" in resolved) return resolved.error;

        const { results, totalCount, truncated } = await paginateAll<Approval>(
          async (limit, offset) => {
            const { data, headers } = await ctx.snClient.get<ServiceNowListResponse<Approval>>(
              "/api/now/table/sysapproval_approver",
              {
                params: {
                  sysparm_query: `sysapproval=${resolved.sysId}^ORDERBYDESCsys_created_on`,
                  sysparm_limit: limit,
                  sysparm_offset: offset,
                  sysparm_fields:
                    "sys_id,state,approver,sysapproval,source_table,comments,due_date,sys_created_on,sys_updated_on",
                },
              }
            );
            return {
              results: data.result,
              totalCount: parseInt(headers["x-total-count"] || "0", 10),
            };
          },
          { limit: 100, maxPages: 5, startOffset: args.offset }
        );

        return {
          success: true,
          data: results,
          metadata: {
            change_request_sys_id: resolved.sysId,
            total_count: totalCount,
            returned_count: results.length,
            offset: args.offset,
            truncated,
          },
        };
      }
    )
  );

  // add_change_request_work_note
  server.tool(
    "add_change_request_work_note",
    "Add a work note (internal) or comment (customer-visible) to a change request.",
    {
      identifier: z
        .string()
        .describe("Change number (CHG...) or sys_id"),
      note: z.string().min(1).describe("The note text to add"),
      type: z
        .enum(["work_note", "comment"])
        .default("work_note")
        .describe("work_note = internal, comment = customer-visible"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: { identifier: string; note: string; type: "work_note" | "comment" }
      ) => {
        const resolved = await resolveChangeRequestSysId(ctx, args.identifier);
        if ("error" in resolved) return resolved.error;

        const field =
          args.type === "work_note" ? "work_notes" : "comments";

        const { data } = await ctx.snClient.patch<
          ServiceNowSingleResponse<ChangeRequest>
        >(`/api/now/table/change_request/${resolved.sysId}`, { [field]: args.note });

        return {
          success: true,
          data: {
            sys_id: resolved.sysId,
            self_link: buildRecordUrl(ctx.instanceUrl, "change_request", resolved.sysId),
            message: `${args.type === "work_note" ? "Work note" : "Comment"} added successfully`,
          },
        };
      }
    )
  );
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./registry.js";
import { buildRecordUrl } from "./registry.js";
import type {
  ServiceNowListResponse,
  ServiceNowSingleResponse,
  Incident,
} from "../servicenow/types.js";
import {
  validateSysId,
  validateIncidentNumber,
  sanitizeUpdatePayload,
} from "../utils/validators.js";

type WrapHandler = <T>(
  handler: (ctx: ToolContext, args: T) => Promise<unknown>
) => (args: T) => Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
}>;

export function registerIncidentTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  // search_incidents
  server.tool(
    "search_incidents",
    "Search for incidents with various filters. Returns a paginated summary list.",
    {
      query: z
        .string()
        .optional()
        .describe("Free-text search in short description"),
      state: z
        .string()
        .optional()
        .describe("Filter by state (e.g. 'New', 'In Progress', 'Resolved')"),
      priority: z
        .string()
        .optional()
        .describe("Filter by priority (1-5)"),
      assigned_to_me: z
        .boolean()
        .optional()
        .default(false)
        .describe("Only show incidents assigned to me"),
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
          priority?: string;
          assigned_to_me?: boolean;
          assignment_group?: string;
          limit: number;
          offset: number;
        }
      ) => {
        const queryParts: string[] = [];

        if (args.query) {
          queryParts.push(`short_descriptionLIKE${args.query}`);
        }
        if (args.state) {
          queryParts.push(`state=${args.state}`);
        }
        if (args.priority) {
          queryParts.push(`priority=${args.priority}`);
        }
        if (args.assigned_to_me) {
          queryParts.push(`assigned_to=${ctx.userSysId}`);
        }
        if (args.assignment_group) {
          queryParts.push(`assignment_groupLIKE${args.assignment_group}`);
        }

        queryParts.push("ORDERBYDESCsys_updated_on");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<Incident>
        >("/api/now/table/incident", {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields:
              "sys_id,number,short_description,state,priority,impact,urgency,assigned_to,assignment_group,caller_id,category,opened_at,sys_updated_on",
          },
        });

        return {
          success: true,
          data: data.result.map((r) => ({
            ...r,
            self_link: buildRecordUrl(ctx.instanceUrl, "incident", r.sys_id),
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

  // get_incident
  server.tool(
    "get_incident",
    "Get full details of a specific incident by incident number (INC...) or sys_id.",
    {
      identifier: z
        .string()
        .describe("Incident number (e.g. INC0012345) or sys_id"),
    },
    wrapHandler(async (ctx: ToolContext, args: { identifier: string }) => {
      let path: string;
      let params: Record<string, string | number | boolean> = {};

      if (validateIncidentNumber(args.identifier)) {
        path = "/api/now/table/incident";
        params = {
          sysparm_query: `number=${args.identifier}`,
          sysparm_limit: 1,
        };
      } else if (validateSysId(args.identifier)) {
        path = `/api/now/table/incident/${args.identifier}`;
      } else {
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message:
              'Invalid identifier. Provide an incident number (INC...) or a 32-character sys_id.',
          },
        };
      }

      const { data } = await ctx.snClient.get<
        ServiceNowSingleResponse<Incident> | ServiceNowListResponse<Incident>
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
            message: `No incident found with identifier: ${args.identifier}`,
          },
        };
      }

      return {
        success: true,
        data: {
          ...result,
          self_link: buildRecordUrl(ctx.instanceUrl, "incident", result.sys_id),
        },
      };
    })
  );

  // create_incident
  server.tool(
    "create_incident",
    "Create a new incident in ServiceNow. Requires at least a short description.",
    {
      short_description: z.string().min(1).describe("Brief summary of the incident"),
      description: z.string().optional().describe("Detailed description"),
      impact: z.number().int().min(1).max(3).optional().describe("Impact (1=High, 2=Medium, 3=Low)"),
      urgency: z.number().int().min(1).max(3).optional().describe("Urgency (1=High, 2=Medium, 3=Low)"),
      category: z.string().optional().describe("Incident category"),
      subcategory: z.string().optional().describe("Incident subcategory"),
      assignment_group: z.string().optional().describe("Assignment group name or sys_id"),
      cmdb_ci: z.string().optional().describe("Configuration item name or sys_id"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: {
          short_description: string;
          description?: string;
          impact?: number;
          urgency?: number;
          category?: string;
          subcategory?: string;
          assignment_group?: string;
          cmdb_ci?: string;
        }
      ) => {
        const body: Record<string, unknown> = {
          short_description: args.short_description,
          caller_id: ctx.userSysId, // Security safeguard: forcefully set to the authenticated user
        };

        if (args.description) body.description = args.description;
        if (args.impact) body.impact = args.impact;
        if (args.urgency) body.urgency = args.urgency;
        if (args.category) body.category = args.category;
        if (args.subcategory) body.subcategory = args.subcategory;
        if (args.assignment_group) body.assignment_group = args.assignment_group;
        if (args.cmdb_ci) body.cmdb_ci = args.cmdb_ci;

        const { data } = await ctx.snClient.post<
          ServiceNowSingleResponse<Incident>
        >("/api/now/table/incident", body);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(ctx.instanceUrl, "incident", data.result.sys_id),
          },
        };
      }
    )
  );

  // update_incident
  server.tool(
    "update_incident",
    "Update fields on an existing incident. Provide the incident number or sys_id and the fields to update.",
    {
      identifier: z
        .string()
        .describe("Incident number (INC...) or sys_id"),
      fields: z
        .record(z.unknown())
        .describe(
          "Fields to update (e.g. { state: 'In Progress', assignment_group: 'Network' })"
        ),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: { identifier: string; fields: Record<string, unknown> }
      ) => {
        // Resolve sys_id
        let sysId = args.identifier;
        if (validateIncidentNumber(args.identifier)) {
          const { data: lookupData } = await ctx.snClient.get<
            ServiceNowListResponse<Incident>
          >("/api/now/table/incident", {
            params: {
              sysparm_query: `number=${args.identifier}`,
              sysparm_limit: 1,
              sysparm_fields: "sys_id",
            },
          });
          if (!lookupData.result.length) {
            return {
              success: false,
              error: {
                code: "NOT_FOUND",
                message: `No incident found: ${args.identifier}`,
              },
            };
          }
          sysId = lookupData.result[0].sys_id;
        } else if (!validateSysId(args.identifier)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid identifier format",
            },
          };
        }

        const sanitized = sanitizeUpdatePayload(args.fields);

        const { data } = await ctx.snClient.patch<
          ServiceNowSingleResponse<Incident>
        >(`/api/now/table/incident/${sysId}`, sanitized);

        return {
          success: true,
          data: {
            ...data.result,
            self_link: buildRecordUrl(ctx.instanceUrl, "incident", data.result.sys_id),
          },
        };
      }
    )
  );

  // add_work_note
  server.tool(
    "add_work_note",
    "Add a work note (internal) or comment (customer-visible) to an incident.",
    {
      identifier: z
        .string()
        .describe("Incident number (INC...) or sys_id"),
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
        let sysId = args.identifier;
        if (validateIncidentNumber(args.identifier)) {
          const { data: lookupData } = await ctx.snClient.get<
            ServiceNowListResponse<Incident>
          >("/api/now/table/incident", {
            params: {
              sysparm_query: `number=${args.identifier}`,
              sysparm_limit: 1,
              sysparm_fields: "sys_id",
            },
          });
          if (!lookupData.result.length) {
            return {
              success: false,
              error: {
                code: "NOT_FOUND",
                message: `No incident found: ${args.identifier}`,
              },
            };
          }
          sysId = lookupData.result[0].sys_id;
        } else if (!validateSysId(args.identifier)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid identifier format",
            },
          };
        }

        const field =
          args.type === "work_note" ? "work_notes" : "comments";

        const { data } = await ctx.snClient.patch<
          ServiceNowSingleResponse<Incident>
        >(`/api/now/table/incident/${sysId}`, { [field]: args.note });

        return {
          success: true,
          data: {
            sys_id: sysId,
            self_link: buildRecordUrl(ctx.instanceUrl, "incident", sysId),
            message: `${args.type === "work_note" ? "Work note" : "Comment"} added successfully`,
          },
        };
      }
    )
  );
}

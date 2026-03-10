import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./registry.js";
import { validateSysId } from "../utils/validators.js";

type WrapHandler = <T>(
  handler: (ctx: ToolContext, args: T) => Promise<unknown>
) => (args: T) => Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
}>;

export function registerCatalogTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  // search_catalog_items
  server.tool(
    "search_catalog_items",
    "Search the service catalog by keyword. Returns items the user has access to.",
    {
      query: z.string().min(1).describe("Search keywords"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(10)
        .describe("Maximum results"),
    },
    wrapHandler(async (ctx: ToolContext, args: { query: string; limit: number }) => {
      const { data } = await ctx.snClient.get<{
        result: unknown[];
      }>("/api/sn_sc/servicecatalog/items", {
        params: {
          sysparm_text: args.query,
          sysparm_limit: args.limit,
        },
      });

      return {
        success: true,
        data: data.result,
        metadata: {
          returned_count: data.result?.length || 0,
        },
      };
    })
  );

  // get_catalog_item
  server.tool(
    "get_catalog_item",
    "Get full details and form variables for a catalog item.",
    {
      sys_id: z.string().describe("Catalog item sys_id"),
    },
    wrapHandler(async (ctx: ToolContext, args: { sys_id: string }) => {
      if (!validateSysId(args.sys_id)) {
        return {
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid sys_id format. Must be a 32-character hex string.",
          },
        };
      }

      const { data } = await ctx.snClient.get<{ result: unknown }>(
        `/api/sn_sc/servicecatalog/items/${args.sys_id}`
      );

      return { success: true, data: data.result };
    })
  );

  // submit_catalog_request
  server.tool(
    "submit_catalog_request",
    "Submit a request for a catalog item with variable values. Creates the request as the authenticated user.",
    {
      sys_id: z.string().describe("Catalog item sys_id"),
      variables: z
        .record(z.unknown())
        .default({})
        .describe("Form variable values as key-value pairs"),
      quantity: z.number().int().min(1).default(1).describe("Quantity to order"),
    },
    wrapHandler(
      async (
        ctx: ToolContext,
        args: { sys_id: string; variables: Record<string, unknown>; quantity: number }
      ) => {
        if (!validateSysId(args.sys_id)) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid sys_id format. Must be a 32-character hex string.",
            },
          };
        }

        const body = {
          sysparm_quantity: args.quantity,
          variables: args.variables,
        };

        const { data } = await ctx.snClient.post<{ result: unknown }>(
          `/api/sn_sc/servicecatalog/items/${args.sys_id}/order_now`,
          body
        );

        return { success: true, data: data.result };
      }
    )
  );
}

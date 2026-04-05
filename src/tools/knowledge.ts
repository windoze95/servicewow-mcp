import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./registry.js";
import { buildRecordUrl } from "./registry.js";
import { validateSysId } from "../utils/validators.js";

type WrapHandler = <T>(
  handler: (ctx: ToolContext, args: T) => Promise<unknown>
) => (args: T) => Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
}>;

export function registerKnowledgeTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  // search_knowledge
  server.tool(
    "search_knowledge",
    "Search knowledge base articles by keyword. Returns articles the user has access to.",
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
      const { data, headers } = await ctx.snClient.get<{ result: unknown[] }>(
        "/api/sn_km/knowledge/articles",
        {
          params: {
            sysparm_search: args.query,
            sysparm_limit: args.limit,
          },
        }
      );

      return {
        success: true,
        data: (data.result || []).map((r: any) => ({
          ...r,
          ...(r.sys_id && {
            self_link: buildRecordUrl(ctx.instanceUrl, "kb_knowledge", r.sys_id),
          }),
        })),
        metadata: {
          total_count: parseInt(headers["x-total-count"] || "0", 10),
          returned_count: data.result?.length || 0,
        },
      };
    })
  );

  // get_article
  server.tool(
    "get_article",
    "Get full details of a knowledge article by sys_id.",
    {
      sys_id: z.string().describe("Knowledge article sys_id"),
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
        `/api/sn_km/knowledge/articles/${args.sys_id}`
      );

      const article = data.result as Record<string, unknown> | null;
      return {
        success: true,
        data: article?.sys_id
          ? { ...article, self_link: buildRecordUrl(ctx.instanceUrl, "kb_knowledge", article.sys_id as string) }
          : article,
      };
    })
  );
}

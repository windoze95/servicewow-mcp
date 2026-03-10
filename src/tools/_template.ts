/**
 * Tool Template
 *
 * Copy this file and follow the pattern to add new tools.
 *
 * Steps:
 * 1. Copy this file to src/tools/<domain>.ts
 * 2. Define your tool registration function
 * 3. Import and call it from src/tools/registry.ts in registerAllTools()
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "./registry.js";

type WrapHandler = <T>(
  handler: (ctx: ToolContext, args: T) => Promise<unknown>
) => (args: T) => Promise<{
  content: { type: "text"; text: string }[];
  isError?: boolean;
}>;

export function registerMyDomainTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  server.tool(
    "my_tool_name",
    "What this tool does — be specific for LLM discoverability",
    {
      // Define input schema with zod
      param1: z.string().describe("Description of param1"),
      param2: z.number().optional().describe("Optional numeric parameter"),
    },
    wrapHandler(
      async (ctx: ToolContext, args: { param1: string; param2?: number }) => {
        // ctx.snClient is already authenticated as the calling user
        // ctx.userSysId, ctx.userName, ctx.displayName are available

        const { data } = await ctx.snClient.get<{ result: unknown }>(
          "/api/now/table/my_table",
          {
            params: {
              sysparm_query: `field=${args.param1}`,
              sysparm_limit: 10,
            },
          }
        );

        return {
          success: true,
          data: data.result,
        };
      }
    )
  );
}

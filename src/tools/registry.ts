import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Redis } from "ioredis";
import { type Config } from "../config.js";
import { TokenStore } from "../auth/tokenStore.js";
import { TokenRefresher, AuthRequiredError } from "../auth/tokenRefresh.js";
import { RateLimiter } from "../middleware/rateLimiter.js";
import { ServiceNowClient } from "../servicenow/client.js";
import { handleToolError, createToolError } from "../middleware/errorHandler.js";
import { logger } from "../utils/logger.js";
import { registerUserTools } from "./users.js";
import { registerIncidentTools } from "./incidents.js";
import { registerKnowledgeTools } from "./knowledge.js";
import { registerTaskTools } from "./tasks.js";
import { registerCatalogTools } from "./catalog.js";
import { registerUpdateSetTools } from "./updateSets.js";
import { registerChangeRequestTools } from "./changeRequests.js";
import { registerCatalogAdminTools } from "./catalogAdmin.js";
import { registerCatalogPrompts } from "../prompts/catalog.js";
import { registerIncidentPrompts } from "../prompts/incidents.js";
import { registerChangeRequestPrompts } from "../prompts/changeRequests.js";
import { registerKnowledgePrompts } from "../prompts/knowledge.js";
import { registerResources } from "../resources/servicenow.js";

export interface ToolContext {
  snClient: ServiceNowClient;
  instanceUrl: string;
  userSysId: string;
  userName: string;
  displayName: string;
}

export function buildRecordUrl(
  instanceUrl: string,
  table: string,
  sysId: string
): string {
  return `${instanceUrl}/${table}.do?sys_id=${sysId}`;
}

export function registerAllTools(
  server: McpServer,
  config: Config,
  redis: Redis,
  tokenStore: TokenStore
): void {
  const refresher = new TokenRefresher(config, tokenStore, redis);
  const rateLimiter = new RateLimiter(redis, config.RATE_LIMIT_PER_USER);

  const getContext = async (extra?: { authInfo?: AuthInfo }): Promise<ToolContext> => {
    // Resolve user from bearer token (set by requireBearerAuth middleware)
    const authInfo = extra?.authInfo;
    const userSysId = authInfo?.extra?.userSysId as string | undefined;
    if (!userSysId) {
      throw new AuthRequiredError();
    }

    // Check rate limit
    const allowed = await rateLimiter.checkLimit(userSysId);
    if (!allowed) {
      const err = createToolError(
        "RATE_LIMITED",
        "Rate limit exceeded. Please wait before retrying."
      );
      throw err;
    }

    // Ensure fresh token
    const token = await refresher.ensureFreshToken(userSysId);

    const snClient = new ServiceNowClient(
      config.SERVICENOW_INSTANCE_URL,
      token.access_token
    );

    return {
      snClient,
      instanceUrl: config.SERVICENOW_INSTANCE_URL,
      userSysId: token.user_sys_id,
      userName: token.user_name,
      displayName: token.display_name,
    };
  };

  // Wrapper that catches errors and returns consistent error responses
  const wrapHandler = <T>(
    handler: (ctx: ToolContext, args: T) => Promise<unknown>
  ) => {
    return async (args: T, extra?: { authInfo?: AuthInfo }) => {
      try {
        const ctx = await getContext(extra);
        const startTime = Date.now();
        const result = await handler(ctx, args);
        const duration = Date.now() - startTime;
        logger.info(
          { userName: ctx.userName, duration },
          "Tool call completed"
        );
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const toolErr = (err as { toolError?: unknown })?.toolError;
        if (toolErr) {
          return { content: [{ type: "text" as const, text: JSON.stringify(toolErr, null, 2) }], isError: true };
        }
        const errorResponse = handleToolError(err);
        return { content: [{ type: "text" as const, text: JSON.stringify(errorResponse, null, 2) }], isError: true };
      }
    };
  };

  registerUserTools(server, wrapHandler);
  registerIncidentTools(server, wrapHandler);
  registerKnowledgeTools(server, wrapHandler);
  registerTaskTools(server, wrapHandler);
  registerCatalogTools(server, wrapHandler);
  registerUpdateSetTools(server, wrapHandler);
  registerChangeRequestTools(server, wrapHandler);
  registerCatalogAdminTools(server, wrapHandler);

  registerCatalogPrompts(server);
  registerResources(server, getContext);
  registerIncidentPrompts(server);
  registerChangeRequestPrompts(server);
  registerKnowledgePrompts(server);

  logger.info("All tools registered");
}

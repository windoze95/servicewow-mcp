import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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

export interface ToolContext {
  snClient: ServiceNowClient;
  userSysId: string;
  userName: string;
  displayName: string;
}

export function registerAllTools(
  server: McpServer,
  getSessionId: () => string | undefined,
  config: Config,
  redis: Redis,
  tokenStore: TokenStore
): void {
  const refresher = new TokenRefresher(config, tokenStore, redis);
  const rateLimiter = new RateLimiter(redis, config.RATE_LIMIT_PER_USER);

  const getContext = async (): Promise<ToolContext> => {
    const sessionId = getSessionId();
    if (!sessionId) {
      throw new AuthRequiredError();
    }

    const userSysId = await tokenStore.getUserForSession(sessionId);
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
      userSysId: token.user_sys_id,
      userName: token.user_name,
      displayName: token.display_name,
    };
  };

  const getAuthUrl = () => {
    const sessionId = getSessionId();
    const params = new URLSearchParams();
    if (sessionId) params.set("session_id", sessionId);
    return `${config.OAUTH_REDIRECT_URI.replace("/oauth/callback", "/oauth/authorize")}?${params.toString()}`;
  };

  const safeGetContext = async (): Promise<ToolContext> => {
    try {
      return await getContext();
    } catch (err) {
      if (err instanceof AuthRequiredError) {
        const authUrl = getAuthUrl();
        throw Object.assign(new Error("AUTH_REQUIRED"), {
          toolError: createToolError(
            "AUTH_REQUIRED",
            `Please authenticate: ${authUrl}`,
            { auth_url: authUrl }
          ),
        });
      }
      throw err;
    }
  };

  // Wrapper that catches errors and returns consistent error responses
  const wrapHandler = <T>(
    handler: (ctx: ToolContext, args: T) => Promise<unknown>
  ) => {
    return async (args: T) => {
      try {
        const ctx = await safeGetContext();
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

  logger.info("All tools registered");
}

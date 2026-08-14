import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Redis } from "ioredis";
import { type Config } from "../config.js";
import { TokenStore } from "../auth/tokenStore.js";
import { TokenRefresher, AuthRequiredError } from "../auth/tokenRefresh.js";
import { RateLimiter } from "../middleware/rateLimiter.js";
import { ServiceNowClient } from "../servicenow/client.js";
import { handleToolError, createToolError } from "../middleware/errorHandler.js";
import type { UsageMetrics } from "../metrics/usage.js";
import { logger } from "../utils/logger.js";
import { registerUserTools } from "./users.js";
import { registerIncidentTools } from "./incidents.js";
import { registerKnowledgeTools } from "./knowledge.js";
import { registerTaskTools } from "./tasks.js";
import { registerCatalogTools } from "./catalog.js";
import { registerUpdateSetTools } from "./updateSets.js";
import { registerChangeRequestTools } from "./changeRequests.js";
import { registerCatalogAdminTools } from "./catalogAdmin.js";
import { registerScheduledJobTools } from "./scheduledJobs.js";
import { registerFlowLogTools } from "./flowLogs.js";
import { registerCmdbTools } from "./cmdb.js";
import { registerPlatformMetadataTools } from "./platformMetadata.js";
import { registerFormRulesTools } from "./formRules.js";
import { registerAccessControlTools } from "./accessControl.js";
import { registerOnCallTools } from "./onCall.js";
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

export type WrapHandler = <T>(
  toolName: string,
  handler: (ctx: ToolContext, args: T) => Promise<unknown>
) => (
  args: T,
  extra?: { authInfo?: AuthInfo }
) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;

export function buildRecordUrl(
  instanceUrl: string,
  table: string,
  sysId: string
): string {
  return `${instanceUrl}/${table}.do?sys_id=${sysId}`;
}

// Extract a reference field's sys_id across the Table API's display modes:
// sysparm_display_value=all → {value, display_value, link}; =true → the value
// key is ABSENT ({display_value, link} only), so fall back to the link's
// trailing path segment; =false → {value, link}. Plain strings pass through.
// The object handling is load-bearing: without it, grouping keys and
// self_links become "[object Object]" (verified against the live Table API).
export function refSysId(field: unknown): string {
  if (typeof field === "object" && field !== null) {
    const obj = field as { value?: unknown; link?: unknown };
    if (typeof obj.value === "string" && obj.value.length > 0) {
      return obj.value;
    }
    if (typeof obj.link === "string") {
      return obj.link.split("/").pop() ?? "";
    }
    return "";
  }
  return String(field ?? "");
}

export function registerAllTools(
  server: McpServer,
  config: Config,
  redis: Redis,
  tokenStore: TokenStore,
  usageMetrics: UsageMetrics
): void {
  const refresher = new TokenRefresher(config, tokenStore, redis);
  // Exemptions are validated to sys_id shape so a typo'd entry is surfaced at
  // startup instead of silently never matching.
  const exemptUsers = (config.RATE_LIMIT_EXEMPT_USERS ?? "")
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  const invalidExempt = exemptUsers.filter((u) => !/^[0-9a-fA-F]{32}$/.test(u));
  if (invalidExempt.length > 0) {
    logger.warn(
      { invalidExempt },
      "RATE_LIMIT_EXEMPT_USERS entries that are not 32-char sys_ids are ignored"
    );
  }
  const validExempt = exemptUsers.filter((u) => /^[0-9a-fA-F]{32}$/.test(u));
  if (validExempt.length > 0) {
    logger.info(
      { count: validExempt.length },
      "Rate limit exemptions configured"
    );
  }
  const rateLimiter = new RateLimiter(
    redis,
    config.RATE_LIMIT_PER_USER,
    validExempt
  );

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
  const wrapHandler: WrapHandler = <T>(
    toolName: string,
    handler: (ctx: ToolContext, args: T) => Promise<unknown>
  ) => {
    return async (args: T, extra?: { authInfo?: AuthInfo }) => {
      // Duration covers the whole call, including auth/token resolution
      const startTime = Date.now();
      let ctx: ToolContext | undefined;
      try {
        ctx = await getContext(extra);
        const result = await handler(ctx, args);
        const duration = Date.now() - startTime;
        logger.info(
          { toolName, userName: ctx.userName, duration },
          "Tool call completed"
        );
        usageMetrics.record(toolName, ctx.userName, true);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      } catch (err: unknown) {
        const duration = Date.now() - startTime;
        logger.warn(
          { toolName, userName: ctx?.userName, duration },
          "Tool call failed"
        );
        if (ctx) {
          usageMetrics.record(toolName, ctx.userName, false);
        }
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
  registerScheduledJobTools(server, wrapHandler);
  registerFlowLogTools(server, wrapHandler);
  registerCmdbTools(server, wrapHandler);
  registerPlatformMetadataTools(server, wrapHandler);
  registerFormRulesTools(server, wrapHandler);
  registerAccessControlTools(server, wrapHandler);
  registerOnCallTools(server, wrapHandler);

  registerCatalogPrompts(server);
  registerResources(server, getContext);
  registerIncidentPrompts(server);
  registerChangeRequestPrompts(server);
  registerKnowledgePrompts(server);

  logger.info("All tools registered");
}

import express, { type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { Redis } from "ioredis";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { type Config } from "./config.js";
import { TokenStore } from "./auth/tokenStore.js";
import { ServiceNowOAuthProvider } from "./auth/oauthProvider.js";
import { createOAuthRouter } from "./auth/oauth.js";
import { registerAllTools } from "./tools/registry.js";
import { UsageMetrics, MAX_SUMMARY_DAYS } from "./metrics/usage.js";
import { logger } from "./utils/logger.js";

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  createdAt: number;
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  // Hash both sides so inputs of different lengths still compare in constant time
  const digestA = createHash("sha256").update(a).digest();
  const digestB = createHash("sha256").update(b).digest();
  return timingSafeEqual(digestA, digestB);
}

export async function createApp(
  config: Config,
  redis: Redis
): Promise<express.Express> {
  const app = express();
  const tokenStore = new TokenStore(redis, config.TOKEN_ENCRYPTION_KEY);
  const usageMetrics = new UsageMetrics(redis);

  // OAuth provider for MCP SDK auth
  const oauthProvider = new ServiceNowOAuthProvider(config, tokenStore);

  // Middleware
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (config.ALLOWED_ORIGINS.includes("*") || !origin) {
          callback(null, true);
        } else if (config.ALLOWED_ORIGINS.includes(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      credentials: true,
    })
  );

  // Health endpoint (before auth middleware)
  app.get("/health", async (_req: Request, res: Response) => {
    try {
      await redis.ping();
      res.json({
        status: "healthy",
        uptime: process.uptime(),
        redis: "connected",
        timestamp: new Date().toISOString(),
      });
    } catch {
      res.status(503).json({
        status: "unhealthy",
        redis: "disconnected",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Usage metrics endpoint — enabled only when METRICS_TOKEN is configured
  if (config.METRICS_TOKEN) {
    const expectedAuth = `Bearer ${config.METRICS_TOKEN}`;
    app.get("/metrics/usage", async (req: Request, res: Response) => {
      if (!timingSafeEqualStrings(req.headers.authorization ?? "", expectedAuth)) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const daysParam = Number(req.query.days);
      const days = Number.isFinite(daysParam)
        ? Math.min(Math.max(Math.trunc(daysParam), 1), MAX_SUMMARY_DAYS)
        : 30;
      try {
        res.json(await usageMetrics.summary(days));
      } catch (err) {
        logger.error({ err }, "Failed to build usage metrics summary");
        res.status(500).json({ error: "Failed to build usage metrics summary" });
      }
    });
  }

  // MCP SDK OAuth routes (/.well-known/*, /authorize, /token, /register, /revoke)
  app.use(
    mcpAuthRouter({
      provider: oauthProvider,
      issuerUrl: new URL(config.MCP_SERVER_URL),
    })
  );

  // OAuth routes (SN callback for token exchange)
  app.use("/oauth", createOAuthRouter(config, tokenStore));

  // Bearer auth middleware for MCP routes
  const bearerAuth = requireBearerAuth({ verifier: oauthProvider });

  // Per-session MCP server + transport storage
  const sessions = new Map<string, SessionEntry>();

  function createMcpSession(): SessionEntry {
    let resolvedSessionId: string | undefined;

    const server = new McpServer({
      name: "servicenow-mcp",
      version: "1.0.0",
    });

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: async (sessionId: string) => {
        resolvedSessionId = sessionId;
        sessions.set(sessionId, entry);
        logger.info({ sessionId }, "MCP session initialized");
      },
    });

    // Register all tools
    registerAllTools(server, config, redis, tokenStore, usageMetrics);

    // Clean up on transport close
    transport.onclose = () => {
      if (resolvedSessionId) {
        sessions.delete(resolvedSessionId);
        logger.info({ sessionId: resolvedSessionId }, "MCP session closed");
      }
    };

    const entry: SessionEntry = {
      transport,
      server,
      createdAt: Date.now(),
    };

    return entry;
  }

  // POST /mcp — handles initialize + tool calls (bearer auth required)
  app.post("/mcp", bearerAuth, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Existing session — route to its transport
      const entry = sessions.get(sessionId)!;
      await entry.transport.handleRequest(req, res);
      return;
    }

    // No session or unknown session — create new session
    const entry = createMcpSession();

    // Connect server to transport
    await entry.server.connect(entry.transport);

    await entry.transport.handleRequest(req, res);
  });

  // GET /mcp — SSE stream for notifications (Streamable HTTP spec)
  app.get("/mcp", bearerAuth, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }

    const entry = sessions.get(sessionId)!;
    await entry.transport.handleRequest(req, res);
  });

  // DELETE /mcp — close session
  app.delete("/mcp", bearerAuth, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId || !sessions.has(sessionId)) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const entry = sessions.get(sessionId)!;
    await entry.transport.close();
    sessions.delete(sessionId);
    logger.info({ sessionId }, "MCP session terminated by client");
    res.status(200).json({ message: "Session closed" });
  });

  return app;
}

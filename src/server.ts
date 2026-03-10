import express, { type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { type Config } from "./config.js";
import { TokenStore } from "./auth/tokenStore.js";
import { createOAuthRouter } from "./auth/oauth.js";
import { registerAllTools } from "./tools/registry.js";
import { logger } from "./utils/logger.js";

interface SessionEntry {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  createdAt: number;
}

export async function createApp(
  config: Config,
  redis: Redis
): Promise<express.Express> {
  const app = express();
  const tokenStore = new TokenStore(redis, config.TOKEN_ENCRYPTION_KEY);

  // Middleware
  app.use(helmet());
  app.use(
    cors({
      origin: config.ALLOWED_ORIGINS.includes("*")
        ? "*"
        : config.ALLOWED_ORIGINS,
      credentials: true,
    })
  );

  // Health endpoint
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

  // OAuth routes
  app.use("/oauth", createOAuthRouter(config, tokenStore));

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
      onsessioninitialized: (sessionId: string) => {
        resolvedSessionId = sessionId;
        sessions.set(sessionId, entry);
        logger.info({ sessionId }, "MCP session initialized");
      },
    });

    // Register all tools with a session-scoped getSessionId
    registerAllTools(
      server,
      () => resolvedSessionId,
      config,
      redis,
      tokenStore
    );

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

  // POST /mcp — handles initialize + tool calls
  app.post("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      // Existing session — route to its transport
      const entry = sessions.get(sessionId)!;
      await entry.transport.handleRequest(req, res);
      return;
    }

    // No session or unknown session — this should be an initialize request
    const entry = createMcpSession();

    // Connect server to transport
    await entry.server.connect(entry.transport);

    await entry.transport.handleRequest(req, res);
  });

  // GET /mcp — SSE stream for notifications (Streamable HTTP spec)
  app.get("/mcp", async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }

    const entry = sessions.get(sessionId)!;
    await entry.transport.handleRequest(req, res);
  });

  // DELETE /mcp — close session
  app.delete("/mcp", async (req: Request, res: Response) => {
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

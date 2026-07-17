import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/server.js";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  registerAllTools: vi.fn(),
  transportInstances: [] as Array<{
    handleRequest: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onclose?: () => void;
    sessionId?: string;
  }>,
}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    async connect(transport: unknown) {
      return mocks.connect(transport);
    }
  },
}));

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: class {
    public onclose?: () => void;
    public handleRequest: ReturnType<typeof vi.fn>;
    public close: ReturnType<typeof vi.fn>;
    public sessionId?: string;
    private initialized = false;

    constructor(private opts: { sessionIdGenerator: () => string; onsessioninitialized: (sessionId: string) => void }) {
      this.handleRequest = vi.fn(async (_req, res) => {
        if (!this.initialized) {
          this.initialized = true;
          this.sessionId = this.opts.sessionIdGenerator();
          this.opts.onsessioninitialized(this.sessionId);
        }
        res.status(200).json({ ok: true });
      });

      this.close = vi.fn(async () => {
        if (this.onclose) {
          this.onclose();
        }
      });

      mocks.transportInstances.push(this);
    }
  },
}));

// Mock mcpAuthRouter — returns a no-op middleware
vi.mock("@modelcontextprotocol/sdk/server/auth/router.js", () => ({
  mcpAuthRouter: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Mock requireBearerAuth — passthrough middleware that sets req.auth
vi.mock("@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js", () => ({
  requireBearerAuth: () => (req: any, _res: unknown, next: () => void) => {
    req.auth = {
      token: "test-token",
      clientId: "test-client",
      scopes: [],
      extra: { userSysId: "test-user-sys-id" },
    };
    next();
  },
}));

vi.mock("../../src/tools/registry.js", () => ({
  registerAllTools: mocks.registerAllTools,
}));

vi.mock("../../src/auth/tokenStore.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/auth/tokenStore.js")>();
  return {
    ...actual,
    TokenStore: class {},
  };
});

vi.mock("../../src/auth/oauthProvider.js", () => ({
  ServiceNowOAuthProvider: class {},
}));

describe("createApp", () => {
  const baseConfig = {
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    ALLOWED_ORIGINS: ["*"],
    MCP_SERVER_URL: "http://localhost:8080",
    SN_CALLBACK_URI: "http://localhost:8080/oauth/sn-callback",
    SERVICENOW_INSTANCE_URL: "https://example.service-now.com",
    SERVICENOW_CLIENT_ID: "test-client-id",
    SERVICENOW_CLIENT_SECRET: "test-client-secret",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transportInstances.length = 0;
  });

  it("returns healthy status when redis ping succeeds", async () => {
    const redis = {
      ping: vi.fn().mockResolvedValue("PONG"),
    };
    const app = await createApp(baseConfig as any, redis as any);

    const response = await request(app).get("/health").expect(200);

    expect(response.body.status).toBe("healthy");
    expect(response.body.redis).toBe("connected");
  });

  it("returns unhealthy status when redis ping fails", async () => {
    const redis = {
      ping: vi.fn().mockRejectedValue(new Error("redis down")),
    };
    const app = await createApp(baseConfig as any, redis as any);

    const response = await request(app).get("/health").expect(503);

    expect(response.body.status).toBe("unhealthy");
    expect(response.body.redis).toBe("disconnected");
  });

  it("reflects origin when ALLOWED_ORIGINS includes wildcard", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") };
    const app = await createApp(baseConfig as any, redis as any);

    const response = await request(app)
      .get("/health")
      .set("Origin", "https://my-app.example.com")
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).toBe("https://my-app.example.com");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("allows specific origin when ALLOWED_ORIGINS lists it", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") };
    const config = { ...baseConfig, ALLOWED_ORIGINS: ["https://allowed.example.com"] };
    const app = await createApp(config as any, redis as any);

    const response = await request(app)
      .get("/health")
      .set("Origin", "https://allowed.example.com")
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).toBe("https://allowed.example.com");
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("omits CORS headers for disallowed origin", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") };
    const config = { ...baseConfig, ALLOWED_ORIGINS: ["https://allowed.example.com"] };
    const app = await createApp(config as any, redis as any);

    const response = await request(app)
      .get("/health")
      .set("Origin", "https://evil.example.com")
      .expect(200);

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects GET /mcp with missing or unknown session", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") };
    const app = await createApp(baseConfig as any, redis as any);

    await request(app).get("/mcp").expect(400);
    await request(app).get("/mcp").set("mcp-session-id", "missing").expect(400);
  });

  it("rejects DELETE /mcp for missing session", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") };
    const app = await createApp(baseConfig as any, redis as any);

    await request(app).delete("/mcp").expect(404);
    await request(app).delete("/mcp").set("mcp-session-id", "missing").expect(404);
  });

  it("creates session on first POST and reuses it on subsequent POST", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") };
    const app = await createApp(baseConfig as any, redis as any);

    await request(app).post("/mcp").send({}).expect(200);

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.transportInstances).toHaveLength(1);

    const firstTransport = mocks.transportInstances[0];
    const sessionId = firstTransport.sessionId;
    expect(sessionId).toBeTruthy();

    await request(app)
      .post("/mcp")
      .set("mcp-session-id", sessionId!)
      .send({})
      .expect(200);

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(firstTransport.handleRequest).toHaveBeenCalledTimes(2);
  });

  it("creates new session on POST without prior session", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") };
    const app = await createApp(baseConfig as any, redis as any);

    await request(app).post("/mcp").send({}).expect(200);

    expect(mocks.connect).toHaveBeenCalledTimes(1);
    expect(mocks.transportInstances).toHaveLength(1);
  });

  it("closes and removes session on DELETE /mcp", async () => {
    const redis = { ping: vi.fn().mockResolvedValue("PONG") };
    const app = await createApp(baseConfig as any, redis as any);

    await request(app).post("/mcp").send({}).expect(200);
    const transport = mocks.transportInstances[0];
    const sessionId = transport.sessionId!;

    await request(app)
      .delete("/mcp")
      .set("mcp-session-id", sessionId)
      .expect(200);

    expect(transport.close).toHaveBeenCalledTimes(1);
    await request(app).get("/mcp").set("mcp-session-id", sessionId).expect(400);
  });

  describe("GET /metrics/usage", () => {
    const metricsToken = "metrics-secret-token-123";
    const metricsConfig = { ...baseConfig, METRICS_TOKEN: metricsToken };

    function redisWithUsageData() {
      const pipeline = {
        hgetall: vi.fn(),
        exec: vi.fn().mockResolvedValue([
          [null, { "lookup_user|john.doe": "3" }],
          [null, { "lookup_user|john.doe": "1" }],
        ]),
      };
      pipeline.hgetall.mockReturnValue(pipeline);
      return {
        ping: vi.fn().mockResolvedValue("PONG"),
        pipeline: vi.fn(() => pipeline),
      };
    }

    it("is not registered when METRICS_TOKEN is unset", async () => {
      const redis = { ping: vi.fn().mockResolvedValue("PONG") };
      const app = await createApp(baseConfig as any, redis as any);

      await request(app).get("/metrics/usage").expect(404);
    });

    it("rejects requests without a valid bearer token", async () => {
      const app = await createApp(metricsConfig as any, redisWithUsageData() as any);

      await request(app).get("/metrics/usage").expect(401);
      await request(app)
        .get("/metrics/usage")
        .set("Authorization", "Bearer wrong-token")
        .expect(401);
    });

    it("returns the aggregated usage summary for a valid token", async () => {
      const app = await createApp(metricsConfig as any, redisWithUsageData() as any);

      const response = await request(app)
        .get("/metrics/usage?days=1")
        .set("Authorization", `Bearer ${metricsToken}`)
        .expect(200);

      expect(response.body.days).toBe(1);
      expect(response.body.totals).toEqual({ calls: 3, errors: 1 });
      expect(response.body.byTool.lookup_user).toEqual({ calls: 3, errors: 1 });
      expect(response.body.byUser["john.doe"]).toEqual({ calls: 3, errors: 1 });
    });

    it("returns 500 when the summary query fails", async () => {
      const pipeline = {
        hgetall: vi.fn(),
        exec: vi.fn().mockRejectedValue(new Error("redis down")),
      };
      pipeline.hgetall.mockReturnValue(pipeline);
      const redis = {
        ping: vi.fn().mockResolvedValue("PONG"),
        pipeline: vi.fn(() => pipeline),
      };
      const app = await createApp(metricsConfig as any, redis as any);

      await request(app)
        .get("/metrics/usage")
        .set("Authorization", `Bearer ${metricsToken}`)
        .expect(500);
    });
  });
});

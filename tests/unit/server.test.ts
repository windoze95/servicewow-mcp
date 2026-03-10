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
  }> ,
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

vi.mock("../../src/tools/registry.js", () => ({
  registerAllTools: mocks.registerAllTools,
}));

describe("createApp", () => {
  const baseConfig = {
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    ALLOWED_ORIGINS: ["*"],
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
});

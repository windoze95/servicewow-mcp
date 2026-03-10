import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("loadConfig", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    delete process.env.MCP_PORT;
    delete process.env.NODE_ENV;
    delete process.env.LOG_LEVEL;
    delete process.env.RATE_LIMIT_PER_USER;
    delete process.env.ALLOWED_ORIGINS;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("loads config with defaults and transforms", async () => {
    process.env.SERVICENOW_INSTANCE_URL = "https://example.service-now.com///";
    process.env.SERVICENOW_CLIENT_ID = "client-id";
    process.env.SERVICENOW_CLIENT_SECRET = "client-secret";
    process.env.OAUTH_REDIRECT_URI = "http://localhost:3001/oauth/callback";
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
    process.env.ALLOWED_ORIGINS = "https://a.example.com, https://b.example.com";

    const { loadConfig } = await import("../../src/config.js");
    const config = loadConfig();

    expect(config.SERVICENOW_INSTANCE_URL).toBe("https://example.service-now.com");
    expect(config.REDIS_URL).toBe("redis://localhost:6379");
    expect(config.MCP_PORT).toBe(8080);
    expect(config.NODE_ENV).toBe("development");
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.RATE_LIMIT_PER_USER).toBe(60);
    expect(config.ALLOWED_ORIGINS).toEqual([
      "https://a.example.com",
      "https://b.example.com",
    ]);
  });

  it("returns cached config instance on repeated calls", async () => {
    process.env.SERVICENOW_INSTANCE_URL = "https://cached.example.com/";
    process.env.SERVICENOW_CLIENT_ID = "client-id";
    process.env.SERVICENOW_CLIENT_SECRET = "client-secret";
    process.env.OAUTH_REDIRECT_URI = "http://localhost:3001/oauth/callback";
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 2).toString("base64");

    const { loadConfig } = await import("../../src/config.js");
    const first = loadConfig();

    process.env.SERVICENOW_INSTANCE_URL = "https://different.example.com";
    const second = loadConfig();

    expect(second).toBe(first);
    expect(second.SERVICENOW_INSTANCE_URL).toBe("https://cached.example.com");
  });

  it("prints validation errors and exits for invalid configuration", async () => {
    process.env.SERVICENOW_INSTANCE_URL = "not-a-url";
    process.env.SERVICENOW_CLIENT_ID = "";
    process.env.SERVICENOW_CLIENT_SECRET = "";
    process.env.OAUTH_REDIRECT_URI = "bad-uri";
    process.env.TOKEN_ENCRYPTION_KEY = "";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code}`);
      }) as never);

    const { loadConfig } = await import("../../src/config.js");

    expect(() => loadConfig()).toThrow("process.exit:1");
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Configuration validation failed:")
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

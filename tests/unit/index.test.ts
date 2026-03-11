import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("index startup", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts server, registers signal handlers, and performs shutdown sequence", async () => {
    const config = {
      REDIS_URL: "redis://localhost:6379",
      MCP_PORT: 3001,
    };

    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };

    const serverClose = vi.fn();
    const listen = vi.fn((_port: number, callback: () => void) => {
      callback();
      return { close: serverClose };
    });

    const app = { listen };

    const redisOn = vi.fn();
    const redisQuit = vi.fn().mockResolvedValue(undefined);
    const redis = {
      on: redisOn,
      quit: redisQuit,
    };

    const loadConfig = vi.fn().mockReturnValue(config);
    const createRedisClient = vi.fn().mockReturnValue(redis);
    const createApp = vi.fn().mockResolvedValue(app);

    const processOnSpy = vi.spyOn(process, "on");
    const processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit:${code}`);
      }) as never);

    vi.doMock("../../src/config.js", () => ({ loadConfig }));
    vi.doMock("../../src/utils/logger.js", () => ({ logger }));
    vi.doMock("../../src/server.js", () => ({ createApp }));
    vi.doMock("../../src/auth/tokenStore.js", () => ({ createRedisClient }));

    await import("../../src/index.js");
    await Promise.resolve();

    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(createRedisClient).toHaveBeenCalledWith("redis://localhost:6379");
    expect(createApp).toHaveBeenCalledWith(config, redis);
    expect(listen).toHaveBeenCalledWith(3001, expect.any(Function));
    expect(redisOn).toHaveBeenCalledWith("error", expect.any(Function));
    expect(redisOn).toHaveBeenCalledWith("connect", expect.any(Function));

    const sigtermCall = processOnSpy.mock.calls.find(
      ([signal]) => signal === "SIGTERM"
    );
    const sigintCall = processOnSpy.mock.calls.find(
      ([signal]) => signal === "SIGINT"
    );

    expect(sigtermCall).toBeTruthy();
    expect(sigintCall).toBeTruthy();

    const shutdownHandler = sigtermCall?.[1] as () => Promise<void>;
    await expect(shutdownHandler()).rejects.toThrow("process.exit:0");

    expect(serverClose).toHaveBeenCalledTimes(1);
    expect(redisQuit).toHaveBeenCalledTimes(1);
    expect(processExitSpy).toHaveBeenCalledWith(0);
    expect(logger.fatal).not.toHaveBeenCalled();
  });

  it("creates HTTPS server when TLS paths are configured", async () => {
    const config = {
      REDIS_URL: "redis://localhost:6379",
      MCP_PORT: 3001,
      TLS_CERT_PATH: "/certs/server.crt",
      TLS_KEY_PATH: "/certs/server.key",
    };

    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };

    const httpsServerClose = vi.fn();
    const httpsServerListen = vi.fn((_port: number, callback: () => void) => {
      callback();
      return { close: httpsServerClose };
    });
    const httpsServer = { listen: httpsServerListen, close: httpsServerClose };

    const mockCreateHttpsServer = vi.fn().mockReturnValue(httpsServer);
    const mockReadFileSync = vi.fn((path: string) => `contents-of-${path}`);

    const app = {};
    const redisOn = vi.fn();
    const redisQuit = vi.fn().mockResolvedValue(undefined);
    const redis = { on: redisOn, quit: redisQuit };

    const loadConfig = vi.fn().mockReturnValue(config);
    const createRedisClient = vi.fn().mockReturnValue(redis);
    const createApp = vi.fn().mockResolvedValue(app);

    vi.spyOn(process, "on");
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code}`);
    }) as never);

    vi.doMock("node:fs", () => ({ readFileSync: mockReadFileSync }));
    vi.doMock("node:https", () => ({ createServer: mockCreateHttpsServer }));
    vi.doMock("../../src/config.js", () => ({ loadConfig }));
    vi.doMock("../../src/utils/logger.js", () => ({ logger }));
    vi.doMock("../../src/server.js", () => ({ createApp }));
    vi.doMock("../../src/auth/tokenStore.js", () => ({ createRedisClient }));

    await import("../../src/index.js");
    await Promise.resolve();

    expect(mockReadFileSync).toHaveBeenCalledWith("/certs/server.crt");
    expect(mockReadFileSync).toHaveBeenCalledWith("/certs/server.key");
    expect(mockCreateHttpsServer).toHaveBeenCalledWith(
      { cert: "contents-of-/certs/server.crt", key: "contents-of-/certs/server.key" },
      app
    );
    expect(httpsServerListen).toHaveBeenCalledWith(3001, expect.any(Function));
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("https")
    );
  });

  it("logs fatal and exits with code 1 when startup fails", async () => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };

    const startupError = new Error("createApp failed");
    const loadConfig = vi.fn().mockReturnValue({
      REDIS_URL: "redis://localhost:6379",
      MCP_PORT: 3001,
    });
    const createRedisClient = vi.fn().mockReturnValue({ on: vi.fn(), quit: vi.fn() });
    const createApp = vi.fn().mockRejectedValue(startupError);

    const processExitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => {
        return undefined as never;
      }) as never);

    vi.doMock("../../src/config.js", () => ({ loadConfig }));
    vi.doMock("../../src/utils/logger.js", () => ({ logger }));
    vi.doMock("../../src/server.js", () => ({ createApp }));
    vi.doMock("../../src/auth/tokenStore.js", () => ({ createRedisClient }));

    await import("../../src/index.js");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(logger.fatal).toHaveBeenCalledWith(
      { err: startupError },
      "Failed to start server"
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });
});

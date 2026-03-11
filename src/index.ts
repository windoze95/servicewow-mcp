import "dotenv/config";
import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { loadConfig } from "./config.js";
import { logger } from "./utils/logger.js";
import { createApp } from "./server.js";
import { createRedisClient } from "./auth/tokenStore.js";

async function main() {
  const config = loadConfig();
  logger.info("Configuration loaded successfully");

  const redis = createRedisClient(config.REDIS_URL);
  redis.on("error", (err: Error) => logger.error({ err }, "Redis connection error"));
  redis.on("connect", () => logger.info("Connected to Redis"));

  const app = await createApp(config, redis);

  const useTls = !!(config.TLS_CERT_PATH && config.TLS_KEY_PATH);
  const protocol = useTls ? "https" : "http";

  const server = useTls
    ? createHttpsServer(
        { cert: readFileSync(config.TLS_CERT_PATH!), key: readFileSync(config.TLS_KEY_PATH!) },
        app
      )
    : app;

  const listener = useTls
    ? (server as import("node:https").Server).listen(config.MCP_PORT, () => logStartup())
    : (server as ReturnType<typeof app.listen>).listen(config.MCP_PORT, () => logStartup());

  function logStartup() {
    logger.info(`ServiceNow MCP Server listening on port ${config.MCP_PORT} (${protocol})`);
    logger.info(`Health check: ${protocol}://localhost:${config.MCP_PORT}/health`);
    logger.info(`MCP endpoint: ${protocol}://localhost:${config.MCP_PORT}/mcp`);
    logger.info(
      `OAuth authorize: ${protocol}://localhost:${config.MCP_PORT}/oauth/authorize`
    );
  }

  const shutdown = async () => {
    logger.info("Shutting down...");
    listener.close();
    await redis.quit();
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start server");
  process.exit(1);
});

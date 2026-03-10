import "dotenv/config";
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

  const server = app.listen(config.MCP_PORT, () => {
    logger.info(`ServiceNow MCP Server listening on port ${config.MCP_PORT}`);
    logger.info(`Health check: http://localhost:${config.MCP_PORT}/health`);
    logger.info(`MCP endpoint: http://localhost:${config.MCP_PORT}/mcp`);
    logger.info(
      `OAuth authorize: http://localhost:${config.MCP_PORT}/oauth/authorize`
    );
  });

  const shutdown = async () => {
    logger.info("Shutting down...");
    server.close();
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

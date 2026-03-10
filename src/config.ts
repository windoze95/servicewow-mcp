import { z } from "zod";

const configSchema = z.object({
  SERVICENOW_INSTANCE_URL: z
    .string()
    .url()
    .transform((url) => url.replace(/\/+$/, "")),
  SERVICENOW_CLIENT_ID: z.string().min(1),
  SERVICENOW_CLIENT_SECRET: z.string().min(1),
  OAUTH_REDIRECT_URI: z.string().url(),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .describe("Base64-encoded 32-byte AES-256 key"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  MCP_PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  RATE_LIMIT_PER_USER: z.coerce.number().int().positive().default(60),
  RECONNECT_TOKEN_TTL: z.coerce.number().int().positive().default(8640000),
  TLS_CERT_PATH: z.string().optional(),
  TLS_KEY_PATH: z.string().optional(),
  ALLOWED_ORIGINS: z
    .string()
    .default("*")
    .transform((s) => s.split(",").map((o) => o.trim())),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.error(`Configuration validation failed:\n${errors}`);
    process.exit(1);
  }

  _config = result.data;
  return _config;
}

import { z } from "zod";

const configSchema = z.object({
  SERVICENOW_INSTANCE_URL: z
    .string()
    .url()
    .transform((url) => url.replace(/\/+$/, "")),
  SERVICENOW_CLIENT_ID: z.string().min(1),
  SERVICENOW_CLIENT_SECRET: z.string().min(1),
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
  TLS_CERT_PATH: z.string().optional(),
  TLS_KEY_PATH: z.string().optional(),
  ALLOWED_ORIGINS: z
    .string()
    .min(1, "ALLOWED_ORIGINS is required — set to a comma-separated list of allowed origins (e.g. https://claude.ai)")
    .transform((s) => s.split(",").map((o) => o.trim())),
  MCP_SERVER_URL: z
    .string()
    .url()
    .transform((url) => url.replace(/\/+$/, ""))
    .optional(),
  SN_CALLBACK_URI: z.string().url().optional(),
}).refine(
  (data) => (!data.TLS_CERT_PATH && !data.TLS_KEY_PATH) || (!!data.TLS_CERT_PATH && !!data.TLS_KEY_PATH),
  { message: "TLS_CERT_PATH and TLS_KEY_PATH must both be set or both omitted", path: ["TLS_CERT_PATH"] }
).transform((data) => ({
  ...data,
  MCP_SERVER_URL: data.MCP_SERVER_URL ?? `http://localhost:${data.MCP_PORT}`,
  SN_CALLBACK_URI: data.SN_CALLBACK_URI ?? `${data.MCP_SERVER_URL ?? `http://localhost:${data.MCP_PORT}`}/oauth/sn-callback`,
}));

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

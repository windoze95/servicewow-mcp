[docs](../README.md) / [deployment](./README.md) / environment-variables

# Environment Variables

Full configuration reference. All variables are validated at startup by Zod (`src/config.ts`). Invalid configuration causes the server to exit with descriptive error messages.

## Required Variables

| Variable | Description |
|---|---|
| `SERVICENOW_INSTANCE_URL` | ServiceNow base URL (e.g., `https://myorg.service-now.com`). Trailing slashes are stripped automatically. |
| `SERVICENOW_CLIENT_ID` | OAuth client ID from ServiceNow Application Registry |
| `SERVICENOW_CLIENT_SECRET` | OAuth client secret |
| `OAUTH_REDIRECT_URI` | OAuth callback URL (e.g., `https://host:8080/oauth/callback`). Must exactly match the ServiceNow OAuth app's Redirect URL. |
| `TOKEN_ENCRYPTION_KEY` | Base64-encoded 32-byte AES-256 key. Generate with `npm run generate-key` or `openssl rand -base64 32`. |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins (e.g., `https://claude.ai`). Use `*` to allow all origins. |

## Optional Variables

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL. For Docker, use `redis://:<password>@redis:6379`. |
| `MCP_PORT` | `8080` | Server listen port |
| `NODE_ENV` | `development` | `development`, `production`, or `test` |
| `LOG_LEVEL` | `info` | Pino log level: `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| `RATE_LIMIT_PER_USER` | `60` | Maximum requests per minute per user. See [Rate Limiting](../security/rate-limiting.md). |
| `RECONNECT_TOKEN_TTL` | `8640000` | Reconnect token TTL in seconds (default 100 days). Deprecated — use SDK OAuth refresh tokens. |
| `MCP_SERVER_URL` | `http://localhost:{MCP_PORT}` | Externally-reachable server URL. Used as the OAuth issuer URL. Must be HTTPS in production (localhost exempt). |
| `SN_CALLBACK_URI` | `{MCP_SERVER_URL}/oauth/sn-callback` | Redirect URI for the ServiceNow leg of the OAuth flow. Must match ServiceNow OAuth app configuration. |
| `TLS_CERT_PATH` | — | Path to TLS certificate. Must pair with `TLS_KEY_PATH`. See [Native TLS](./native-tls.md). |
| `TLS_KEY_PATH` | — | Path to TLS private key. Must pair with `TLS_CERT_PATH`. |
| `CADDY_DOMAIN` | — | Domain for Caddy auto-TLS (used with `docker-compose.caddy.yml`). See [Docker (Caddy)](./docker-caddy.md). |

## Validation Rules

- `SERVICENOW_INSTANCE_URL` must be a valid URL
- `OAUTH_REDIRECT_URI` must be a valid URL
- `TOKEN_ENCRYPTION_KEY` must decode to exactly 32 bytes
- `ALLOWED_ORIGINS` must not be empty
- `TLS_CERT_PATH` and `TLS_KEY_PATH` must both be set or both omitted
- `MCP_PORT`, `RATE_LIMIT_PER_USER`, `RECONNECT_TOKEN_TTL` must be positive integers
- `MCP_SERVER_URL` must be a valid URL if set
- `SN_CALLBACK_URI` must be a valid URL if set

## Example `.env`

```bash
# ServiceNow
SERVICENOW_INSTANCE_URL=https://myorg.service-now.com
SERVICENOW_CLIENT_ID=abc123
SERVICENOW_CLIENT_SECRET=secret456

# OAuth (legacy — still needed for backward compat)
OAUTH_REDIRECT_URI=https://mcp.example.com/oauth/callback

# MCP OAuth (SDK flow)
MCP_SERVER_URL=https://mcp.example.com
SN_CALLBACK_URI=https://mcp.example.com/oauth/sn-callback

# Security
TOKEN_ENCRYPTION_KEY=<base64 key from npm run generate-key>

# Redis
REDIS_URL=redis://localhost:6379

# Server
MCP_PORT=8080
NODE_ENV=production
LOG_LEVEL=info

# Rate Limiting
RATE_LIMIT_PER_USER=60

# CORS
ALLOWED_ORIGINS=https://claude.ai

# Reconnect Tokens
RECONNECT_TOKEN_TTL=8640000
```

---

**See also**: [Local Development](../getting-started/local-development.md) · [Setup Script](./setup-script.md) · [Docker (Local)](./docker-local.md)

# ServiceNow MCP Server

![Node 22+](https://img.shields.io/badge/Node-22%2B-43853d?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-6f42c1)
![OAuth 2.0](https://img.shields.io/badge/Auth-OAuth%202.0-0a66c2)
![CI](https://img.shields.io/badge/CI-Build%20%2B%20Coverage-success)

Secure, enterprise-ready MCP server for ServiceNow where every action runs as the authenticated user.

No shared service accounts. No ACL bypass. Full audit-trail fidelity.

---

## ⚡ Why This Exists

Instead of funneling every request through a shared service account, this server executes actions as the actual human user.

Because it uses **per-user OAuth tokens**, ServiceNow still enforces:

- each user’s ACLs and roles,
- their approval authority,
- and native user-level audit logging.

Result: safer automation, cleaner compliance, fewer permission hacks.

---

## 🔥 Core Capabilities

- Per-user OAuth 2.0 Authorization Code flow + refresh
- AES-256-GCM encrypted token storage in Redis
- Streamable HTTP MCP transport with per-session lifecycle
- Tool-level identity protections for sensitive operations
- Optional reconnect tokens for session persistence across server restarts
- Per-user rate limiting via Redis token bucket
- Input validation + normalized error responses
- CI-enforced build + test + coverage gate

---

## 🧠 Architecture

```mermaid
flowchart LR
    Client[MCP Client] --> MCP[ServiceNow MCP Server\nExpress + MCP SDK]
    MCP --> Redis[(Redis\nEncrypted tokens + sessions)]
    MCP --> SN[(ServiceNow REST APIs)]

    MCP --> OAuth[OAuth 2.0\nPer-user delegation]
    SN --> ACL[ACL + Role Enforcement]
    SN --> Audit[Native Audit Trail]
```

Key modules:

- `src/index.ts` — startup/shutdown wiring
- `src/server.ts` — HTTP app + MCP routes/session lifecycle
- `src/auth/*` — OAuth callback, encryption, token store, token refresh, reconnect tokens
- `src/tools/*` — tool implementations by domain
- `src/middleware/*` — rate limiting, error normalization
- `src/servicenow/*` — API client + query helpers

---

## 🚀 Quick Start

### Prerequisites

- Node.js 22+
- Redis
- ServiceNow instance with OAuth app configured

### Local Setup

```bash
npm install
cp .env.example .env
npm run generate-key
# paste generated key into TOKEN_ENCRYPTION_KEY in .env
npm run dev
```

Health check:

```bash
curl -s http://localhost:8080/health
```

### Docker (Local / VPN)

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

### Public Deployment (Caddy + Automatic TLS)

For internet-facing deployments, use the Caddy overlay for automatic HTTPS:

```bash
# Set your public domain
echo "CADDY_DOMAIN=mcp.example.com" >> .env

# Launch with Caddy reverse proxy
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
```

Caddy auto-provisions Let's Encrypt certificates. Ensure ports 80 and 443 are open and DNS points to your server.

### Native TLS (Non-Docker)

For running without Docker or Caddy, set `TLS_CERT_PATH` and `TLS_KEY_PATH` in `.env` to enable built-in HTTPS:

```bash
TLS_CERT_PATH=/path/to/server.crt
TLS_KEY_PATH=/path/to/server.key
```

### Automated Setup

One-shot Linux VM setup is available via `setup.sh` (supports both local and public modes).

---

## 🛠 ServiceNow Setup

1. Go to **System OAuth > Application Registry**
2. Create **OAuth API endpoint for external clients**
3. Set redirect URI (example): `https://<host>:8080/oauth/callback`
4. Copy client ID/secret into `.env`

### Required Role

Users should have `snc_platform_rest_api_access` for REST API access. Record-level ACLs still apply.

---

## 🧰 Tools (35)

### Incidents

- `search_incidents`
- `get_incident`
- `create_incident`
- `update_incident`
- `add_work_note`

### Change Requests

- `search_change_requests`
- `get_change_request`
- `create_change_request`
- `update_change_request`
- `get_change_request_approvals`
- `add_change_request_work_note`

### Users and Groups

- `lookup_user`
- `lookup_group`
- `get_my_profile`

### Knowledge

- `search_knowledge`
- `get_article`

### Tasks and Approvals

- `get_my_tasks`
- `get_my_approvals`
- `approve_or_reject`

### Update Sets

- `change_update_set`
- `create_update_set`

### Service Catalog

- `search_catalog_items`
- `get_catalog_item`
- `submit_catalog_request`

### Catalog Administration

- `create_catalog_item`
- `update_catalog_item`
- `create_catalog_variable`
- `update_catalog_variable`
- `list_catalog_variables`
- `create_variable_choice`
- `create_variable_set`
- `attach_variable_set`
- `create_catalog_client_script`
- `create_catalog_ui_policy`
- `create_catalog_ui_policy_action`

---

## 💬 Prompts (4)

### Catalog Administration Guides

- `build_catalog_form` — End-to-end guide for creating a catalog item with variables, choices, and layout
- `configure_catalog_ui_policy` — Guide for setting up UI policies and field-level actions
- `configure_catalog_client_script` — Guide for onChange/onLoad/onSubmit client scripts
- `build_catalog_variable_set` — Guide for creating and attaching reusable variable sets

See [`src/prompts/`](./src/prompts/) for the full reference content.

---

## 🔒 Security Guarantees

Server-side protections include:

- `create_incident`: caller identity is server-controlled
- `update_incident`: protected audit/system fields are stripped
- `create_change_request`: requester identity is server-controlled
- `update_change_request`: protected audit/system fields are stripped
- `submit_catalog_request`: requester identity is server-controlled
- `approve_or_reject`: approval ownership is verified

Also enforced:

- `sys_id` and enum validation
- payload sanitization
- normalized error responses

---

## 🔄 Reconnect Tokens

After a server restart, in-memory MCP sessions are lost. Normally this requires re-doing the full OAuth flow. **Reconnect tokens** let clients skip re-auth by auto-mapping a new session to existing Redis-stored OAuth credentials.

### How It Works

1. Complete OAuth as normal
2. Generate a reconnect token:
   ```bash
   curl -X POST https://host:8080/oauth/reconnect-token \
     -H "Content-Type: application/json" \
     -d '{"user_sys_id": "..."}'
   ```
3. Update your MCP client URL to include the token:
   ```json
   { "url": "https://host:8080/mcp?token=<hex>" }
   ```
4. On server restart, the client reconnects and is automatically authenticated

### Token Management

- Tokens default to 100-day TTL (configurable via `RECONNECT_TOKEN_TTL`), refreshed on each successful use
- Revoke a specific token: `DELETE /oauth/reconnect-token` with `{"user_sys_id": "...", "reconnect_token": "..."}`
- Revoke all tokens for a user: `DELETE /oauth/reconnect-token` with `{"user_sys_id": "...", "revoke_all": true}`
- If a token is invalid or expired, the session silently falls through to normal (unauthenticated) behavior

---

## ⚙️ Configuration

| Variable | Required | Description |
|---|---|---|
| `SERVICENOW_INSTANCE_URL` | Yes | ServiceNow base URL |
| `SERVICENOW_CLIENT_ID` | Yes | OAuth client ID |
| `SERVICENOW_CLIENT_SECRET` | Yes | OAuth client secret |
| `OAUTH_REDIRECT_URI` | Yes | OAuth callback URL |
| `TOKEN_ENCRYPTION_KEY` | Yes | Base64 32-byte AES key |
| `ALLOWED_ORIGINS` | Yes | Comma-separated CORS origins (e.g. `https://claude.ai`) |
| `REDIS_URL` | No | Redis URL (default `redis://localhost:6379`) |
| `MCP_PORT` | No | Server port (default `8080`) |
| `RATE_LIMIT_PER_USER` | No | Requests/minute/user (default `60`) |
| `RECONNECT_TOKEN_TTL` | No | Reconnect token TTL in seconds (default `8640000` / 100 days) |
| `TLS_CERT_PATH` | No | Path to TLS certificate (must pair with `TLS_KEY_PATH`) |
| `TLS_KEY_PATH` | No | Path to TLS private key (must pair with `TLS_CERT_PATH`) |
| `CADDY_DOMAIN` | No | Domain for Caddy auto-TLS (used with `docker-compose.caddy.yml`) |

---

## ✅ Testing and Quality

```bash
npm run build
npm test
npm run test:coverage
```

- Coverage thresholds are configured in `vitest.config.ts`
- CI runs build + tests + coverage gate on PRs and `main`

---

## 🧯 Troubleshooting

### 1) OAuth callback fails (`TOKEN_EXCHANGE_FAILED`)

**Symptoms**

- `/oauth/callback` returns 500
- logs show token exchange failure or `invalid_grant`

**Checks**

- `OAUTH_REDIRECT_URI` exactly matches the ServiceNow OAuth app redirect URI
- client ID and secret are correct
- system clock is sane

**Fix**

- correct redirect/client credentials and restart server
- re-run auth flow from `/oauth/authorize`

### 2) Auth works, but API calls return 403

**Symptoms**

- tool calls fail with insufficient permissions

**Checks**

- user has `snc_platform_rest_api_access`
- user has the needed table/record ACL permissions

**Fix**

- grant missing role or ACL permissions in ServiceNow

### 3) Redis connectivity issues

**Symptoms**

- `/health` returns unhealthy
- startup logs show Redis connection errors

**Checks**

- Redis is running and reachable
- `REDIS_URL` is correct

**Fix**

- start Redis
- correct `REDIS_URL`, then restart app

### 4) CI fails on coverage threshold

**Symptoms**

- GitHub Actions fails during `npm run test:coverage`

**Checks**

- inspect uncovered lines in coverage output
- ensure changed logic has matching tests

**Fix**

- add targeted tests
- re-run locally with `npm run test:coverage`

### 5) Reconnect token not working after restart

**Symptoms**

- Client connects with `?token=...` but session is unauthenticated

**Checks**

- Token may be expired (default 100-day TTL)
- User's OAuth credentials may have been revoked or expired in Redis
- Token may have been explicitly revoked

**Fix**

- Generate a new reconnect token via `POST /oauth/reconnect-token`
- Re-authenticate via `/oauth/authorize` if OAuth credentials are gone

### 6) Tool says `AUTH_REQUIRED` after prior login

**Symptoms**

- tool requests re-auth unexpectedly

**Checks**

- refresh token may be expired/revoked
- session mapping may be missing/expired

**Fix**

- re-authenticate via `/oauth/authorize`
- confirm Redis persistence and restart behavior

### Debug Command Cheat Sheet

```bash
# install + run
npm install
npm run dev

# quality gates
npm run build
npm test
npm run test:coverage

# health check
curl -s http://localhost:8080/health

# local redis quick check (when redis-cli is available)
redis-cli -u "$REDIS_URL" ping

# docker compose stack quick status
docker compose ps
docker compose logs -f
```

---

## 🤖 Agent Instruction Files

- `AGENTS.md`
- `CLAUDE.md`
- `.github/copilot-instructions.md`

Alignment workflow validates expected consistency.

---

## 🌐 Endpoints

| Path | Method | Purpose |
|---|---|---|
| `/health` | GET | Health status |
| `/oauth/authorize` | GET | Start OAuth flow |
| `/oauth/callback` | GET | OAuth callback/token exchange |
| `/oauth/reconnect-token` | POST | Generate a reconnect token |
| `/oauth/reconnect-token` | DELETE | Revoke reconnect token(s) |
| `/mcp` | POST | MCP initialize + tool calls |
| `/mcp?token=<hex>` | POST | MCP initialize with reconnect token |
| `/mcp` | GET | MCP notifications stream |
| `/mcp` | DELETE | Close MCP session |

---

## Client Config Example (Claude Desktop)

```json
{
  "mcpServers": {
    "servicenow": {
      "type": "streamablehttp",
      "url": "https://your-host:8080/mcp"
    }
  }
}
```

With a reconnect token for session persistence across restarts:

```json
{
  "mcpServers": {
    "servicenow": {
      "type": "streamablehttp",
      "url": "https://your-host:8080/mcp?token=<your-reconnect-token>"
    }
  }
}
```

---

Built for secure, user-scoped AI operations in ServiceNow.

# ServiceNow MCP Server — Project Specification

**Version:** 1.0
**Author:** Juliano DiCesare
**Status:** Draft
**Last Updated:** 2026-03-09

---

## 1. Executive Summary

This project delivers an organization-facing MCP (Model Context Protocol) server that proxies authenticated ServiceNow REST API access through per-user OAuth 2.0 tokens. Every action performed through the server is executed as the authenticated user — inheriting their ACLs, roles, approval authority, and audit trail — as if they logged into ServiceNow directly.

The server runs as a Docker container on an internal Linux VM, exposes tools via Streamable HTTP transport, and is consumed by any MCP-compatible client (Claude Desktop, custom integrations, internal chatbots, etc.).

---

## 2. Goals and Non-Goals

### Goals

- Provide MCP tool access to ServiceNow for any authenticated user in the organization
- Enforce per-user identity via OAuth 2.0 Authorization Code Grant — no service accounts for user-facing operations
- Inherit all ServiceNow ACLs, row-level security, and role-based access natively
- Maintain full audit trail fidelity — every action logged under the real user in ServiceNow
- Run as a stateless-ish Docker container (token state externalized to Redis)
- Provide a single setup script that clones, configures, builds, and runs the entire stack on a fresh Linux VM
- Start with a focused, high-value tool set and expand iteratively

### Non-Goals

- Replacing the ServiceNow UI or portal
- Admin-level bulk operations or data migrations
- Supporting non-ServiceNow backends (this server is purpose-built)
- Public internet exposure — this is internal network only
- Mobile or native client development

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Linux VM (Docker Host)                   │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              Docker Compose Stack                         │  │
│  │                                                           │  │
│  │  ┌─────────────────────┐    ┌──────────────────────────┐  │  │
│  │  │  servicenow-mcp     │    │       Redis              │  │  │
│  │  │  (Node.js)          │◄──►│  (Token Store)           │  │  │
│  │  │                     │    │                          │  │  │
│  │  │  - MCP Server       │    │  - Per-user access       │  │  │
│  │  │  - OAuth Handler    │    │    tokens (encrypted)    │  │  │
│  │  │  - SN REST Client   │    │  - Refresh tokens        │  │  │
│  │  │  - Tool Registry    │    │  - Session mappings      │  │  │
│  │  │                     │    │                          │  │  │
│  │  │  :3000 (MCP HTTP)   │    │  :6379 (internal only)   │  │  │
│  │  └──────────┬──────────┘    └──────────────────────────┘  │  │
│  │             │                                              │  │
│  └─────────────┼──────────────────────────────────────────────┘  │
│                │                                                 │
└────────────────┼─────────────────────────────────────────────────┘
                 │
    ┌────────────┼────────────────────────────────┐
    │            ▼                                │
    │  ServiceNow Instance                        │
    │  (OAuth Provider + REST API)                │
    │                                             │
    │  - /oauth_auth.do (authorize)               │
    │  - /oauth_token.do (token exchange/refresh) │
    │  - /api/now/* (Table, Import, Attachment)    │
    │  - /api/sn_sc/* (Service Catalog)           │
    │  - /api/sn_km/* (Knowledge Management)      │
    │                                             │
    └─────────────────────────────────────────────┘
```

### Component Responsibilities

**servicenow-mcp (Node.js container)**
The core application. Hosts the MCP server over Streamable HTTP, manages the OAuth lifecycle, maps MCP sessions to per-user tokens, and translates MCP tool calls into ServiceNow REST API requests using the caller's bearer token.

**Redis (sidecar container)**
Stores encrypted OAuth tokens (access + refresh) and session-to-user mappings. Chosen for speed, simplicity, and built-in TTL support for token expiry. Not exposed outside the Docker network.

**ServiceNow Instance**
The existing organizational ServiceNow instance. Requires an OAuth Application Registry entry (created during setup) but no other platform modifications. All security enforcement happens here natively.

---

## 4. Authentication and Authorization

### 4.1 OAuth 2.0 Flow

The server uses the **Authorization Code Grant** flow. This is the only flow that produces tokens scoped to a specific user's identity.

```
User (MCP Client)          MCP Server              ServiceNow
      │                        │                        │
      │── Connect to MCP ─────►│                        │
      │                        │── Check token store ──►│
      │                        │   (no token found)     │
      │◄─ Return auth URL ─────│                        │
      │                        │                        │
      │── Browser: /oauth_auth.do ─────────────────────►│
      │                        │                        │── SSO/Login
      │◄───────────── Redirect with auth code ──────────│
      │                        │                        │
      │── Follow redirect ────►│                        │
      │                        │── POST /oauth_token.do ►│
      │                        │   (code → tokens)      │
      │                        │◄─ access + refresh ────│
      │                        │── Store encrypted ─────►│ (Redis)
      │◄─ Auth complete ───────│                        │
      │                        │                        │
      │── Tool call ──────────►│                        │
      │                        │── GET /api/now/table/* ►│
      │                        │   Authorization:       │
      │                        │   Bearer <user_token>  │
      │                        │◄─ Response (ACL'd) ────│
      │◄─ Tool result ────────│                        │
```

### 4.2 ServiceNow OAuth Application Setup

An OAuth Application Registry record must be created in ServiceNow:

- **Type:** "Create an OAuth API endpoint for external clients"
- **Grant Type:** Authorization Code
- **Client ID:** Auto-generated (stored in server config)
- **Client Secret:** Auto-generated (stored in server config, encrypted)
- **Redirect URL:** `https://<mcp-server-host>:<port>/oauth/callback`
- **Token Lifespan:** Default 1800s (30 min) — the server handles refresh transparently
- **Refresh Token Lifespan:** Default 8640000s (100 days)

If the organization uses SSO/SAML for ServiceNow authentication (likely), the OAuth authorize endpoint will redirect through the IdP automatically. No additional configuration is needed on the MCP server side.

### 4.3 Token Management

**Storage:** Redis, with keys structured as `token:<user_sys_id>`. Values are AES-256-GCM encrypted JSON containing the access token, refresh token, expiry timestamp, and user metadata.

**Refresh Logic:** Before every ServiceNow API call, the server checks whether the access token expires within the next 60 seconds. If so, it performs a refresh grant transparently. If the refresh token itself is expired (user hasn't connected in 100+ days), the next tool call returns an error prompting re-authentication.

**Encryption Key:** Stored as an environment variable (`TOKEN_ENCRYPTION_KEY`), generated during initial setup. This key never leaves the VM.

### 4.4 Session-to-User Mapping

When a user connects via MCP, their session must be tied to a ServiceNow identity. The mapping strategy depends on the client:

- **Behind an auth proxy (preferred):** If the MCP server sits behind an org reverse proxy that injects identity headers (e.g., `X-Forwarded-User`, `X-Auth-Email`), the server reads these to identify the user and look up their stored token. No additional login needed if a valid token exists.
- **Direct connection:** The server initiates the OAuth flow on first connection. After the user authenticates, the server extracts their `sys_id` and `user_name` from the ServiceNow `/api/now/table/sys_user?sysparm_query=user_name=<oauth_user>` endpoint and creates the session mapping.

---

## 5. MCP Server Configuration

### 5.1 Transport

**Streamable HTTP** (the current MCP standard for remote servers). This replaces the older SSE transport and is what the MCP SDK natively supports for multi-client scenarios.

- **Endpoint:** `https://<host>:3000/mcp`
- **Protocol:** HTTPS (TLS terminated at the server or at an upstream reverse proxy)
- **Authentication:** Per-session, backed by OAuth tokens as described above

### 5.2 Server Metadata

```json
{
  "name": "servicenow-mcp",
  "version": "1.0.0",
  "description": "ServiceNow MCP Server — per-user delegated access",
  "capabilities": {
    "tools": {}
  }
}
```

### 5.3 Rate Limiting

The server enforces per-user rate limits to prevent accidental API abuse:

- **Default:** 60 requests/minute per user
- **Configurable** via environment variable `RATE_LIMIT_PER_USER`
- **Implementation:** Token bucket algorithm using Redis, keyed by user `sys_id`

---

## 6. Tool Definitions

Tools are organized by ServiceNow domain. Each tool is a thin wrapper: it validates input, injects the user's bearer token, calls the appropriate ServiceNow REST endpoint, and formats the response.

### 6.1 Phase 1 — Core Tools (MVP)

#### Incident Management

| Tool | Description | SN Endpoint |
|------|-------------|-------------|
| `search_incidents` | Query incidents with filters (assigned to me, by priority, by state, full-text search). Returns summary list. | `GET /api/now/table/incident` |
| `get_incident` | Retrieve full incident details by number or sys_id. | `GET /api/now/table/incident/{sys_id}` |
| `create_incident` | Create a new incident. Requires short description; accepts category, priority, assignment group, CI, description. Enforces priority matrix (impact + urgency − 1). | `POST /api/now/table/incident` |
| `update_incident` | Update fields on an existing incident. Accepts state transitions, work notes, comments, reassignment. | `PATCH /api/now/table/incident/{sys_id}` |
| `add_work_note` | Add a work note (internal) or comment (customer-visible) to an incident. | `PATCH /api/now/table/incident/{sys_id}` |

#### Service Catalog

| Tool | Description | SN Endpoint |
|------|-------------|-------------|
| `search_catalog_items` | Search the service catalog by keyword. Returns items the user can see (ACL-filtered by SN). | `GET /api/sn_sc/servicecatalog/items` |
| `get_catalog_item` | Get full details and variables for a catalog item. | `GET /api/sn_sc/servicecatalog/items/{sys_id}` |
| `submit_catalog_request` | Submit a request for a catalog item with variable values. Creates the request as the authenticated user. | `POST /api/sn_sc/servicecatalog/items/{sys_id}/order_now` |

#### Knowledge Base

| Tool | Description | SN Endpoint |
|------|-------------|-------------|
| `search_knowledge` | Full-text search across knowledge bases the user has access to. | `GET /api/sn_km/knowledge/articles` |
| `get_article` | Retrieve a full knowledge article by number or sys_id. | `GET /api/sn_km/knowledge/articles/{sys_id}` |

#### User and Group Lookup

| Tool | Description | SN Endpoint |
|------|-------------|-------------|
| `lookup_user` | Find a user by name, email, or employee ID. Returns sys_id, name, email, department, manager. | `GET /api/now/table/sys_user` |
| `lookup_group` | Find an assignment group by name. Returns sys_id, name, manager, member count. | `GET /api/now/table/sys_user_group` |
| `get_my_profile` | Return the authenticated user's own profile information. | `GET /api/now/table/sys_user/{caller_sys_id}` |

#### Task Management

| Tool | Description | SN Endpoint |
|------|-------------|-------------|
| `get_my_tasks` | Retrieve all open tasks assigned to the authenticated user across task types (incidents, requests, changes, etc.). | `GET /api/now/table/task` |
| `get_my_approvals` | Retrieve pending approvals for the authenticated user. | `GET /api/now/table/sysapproval_approver` |
| `approve_or_reject` | Approve or reject a pending approval with comments. | `PATCH /api/now/table/sysapproval_approver/{sys_id}` |

### 6.2 Phase 2 — Extended Tools (Post-MVP)

| Tool | Domain | Description |
|------|--------|-------------|
| `search_cmdb_cis` | CMDB | Query configuration items by name, class, or attributes |
| `get_ci_details` | CMDB | Full CI record with relationships |
| `create_change_request` | Change Management | Create a standard/normal/emergency change |
| `get_change_request` | Change Management | Retrieve change details and workflow state |
| `search_problems` | Problem Management | Search problem records |
| `run_report` | Reporting | Execute a saved report and return results |
| `add_attachment` | Attachments | Attach a file to any record |
| `get_attachments` | Attachments | List/download attachments on a record |

### 6.3 Tool Input Validation

Every tool enforces input validation before making API calls:

- **Required fields** are checked and return clear error messages if missing
- **sys_id format** is validated (32-char hex string) when provided
- **Enumerated values** (state, priority, impact, urgency) are validated against known ServiceNow values
- **Query strings** are sanitized to prevent injection into `sysparm_query` encoded query strings
- **Field restrictions** prevent updates to read-only or system fields (sys_created_on, sys_id, etc.)

### 6.4 Tool Response Formatting

All tool responses follow a consistent structure:

```json
{
  "success": true,
  "data": {
    "number": "INC0012345",
    "short_description": "...",
    "state": "In Progress",
    "...": "..."
  },
  "metadata": {
    "total_count": 47,
    "returned_count": 10,
    "query_time_ms": 132
  }
}
```

For list queries, results are paginated with a default limit of 10 records. The response includes `total_count` so the LLM can decide whether to request more.

**Display value resolution:** All reference fields (assignment_group, assigned_to, caller_id, cmdb_ci, etc.) are returned with display values by setting `sysparm_display_value=true` on the ServiceNow API call. This ensures the LLM receives human-readable names rather than raw sys_ids.

---

## 7. Project Structure

```
servicenow-mcp-server/
├── SPEC.md                          # This document
├── README.md                        # Setup instructions and usage guide
├── LICENSE
├── setup.sh                         # One-shot VM setup script (see §10)
├── docker-compose.yml               # Container orchestration
├── Dockerfile                       # Node.js application image
├── .env.example                     # Template for environment variables
├── .env                             # Actual config (gitignored)
│
├── src/
│   ├── index.ts                     # Entrypoint — bootstraps server
│   ├── server.ts                    # MCP server init + Streamable HTTP transport
│   ├── config.ts                    # Environment variable parsing and validation
│   │
│   ├── auth/
│   │   ├── oauth.ts                 # OAuth route handlers (authorize, callback)
│   │   ├── tokenStore.ts            # Redis-backed encrypted token CRUD
│   │   ├── tokenRefresh.ts          # Transparent token refresh middleware
│   │   └── encryption.ts            # AES-256-GCM encrypt/decrypt helpers
│   │
│   ├── middleware/
│   │   ├── session.ts               # Session-to-user mapping resolution
│   │   ├── rateLimiter.ts           # Per-user rate limiting via Redis
│   │   └── errorHandler.ts          # Global error handler with SN error parsing
│   │
│   ├── servicenow/
│   │   ├── client.ts                # Authenticated SN REST client (injects user token)
│   │   ├── types.ts                 # ServiceNow record type definitions
│   │   └── queryBuilder.ts          # Encoded query string builder with sanitization
│   │
│   ├── tools/
│   │   ├── registry.ts              # Tool registration and discovery
│   │   ├── incidents.ts             # Incident tools
│   │   ├── catalog.ts               # Service Catalog tools
│   │   ├── knowledge.ts             # Knowledge Base tools
│   │   ├── users.ts                 # User/Group lookup tools
│   │   ├── tasks.ts                 # Task and approval tools
│   │   └── _template.ts             # Template for adding new tools
│   │
│   └── utils/
│       ├── logger.ts                # Structured logging (pino)
│       └── validators.ts            # Input validation helpers
│
├── tests/
│   ├── unit/
│   │   ├── auth/
│   │   ├── tools/
│   │   └── servicenow/
│   └── integration/
│       ├── oauth.test.ts            # OAuth flow integration tests
│       └── tools.test.ts            # Tool execution with mock SN responses
│
└── scripts/
    └── generate-encryption-key.ts   # Utility to generate TOKEN_ENCRYPTION_KEY
```

---

## 8. Configuration

All configuration is via environment variables, sourced from `.env` in development and Docker secrets/env in production.

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `SERVICENOW_INSTANCE_URL` | Yes | Base URL of the SN instance | `https://loves.service-now.com` |
| `SERVICENOW_CLIENT_ID` | Yes | OAuth Application client ID | `a1b2c3d4...` |
| `SERVICENOW_CLIENT_SECRET` | Yes | OAuth Application client secret | `x9y8z7...` |
| `OAUTH_REDIRECT_URI` | Yes | Must match SN OAuth app config | `https://mcp.internal.loves.com:3000/oauth/callback` |
| `TOKEN_ENCRYPTION_KEY` | Yes | 256-bit key for token encryption (base64) | Auto-generated by setup script |
| `REDIS_URL` | No | Redis connection string | `redis://redis:6379` (default) |
| `MCP_PORT` | No | Server listen port | `3000` (default) |
| `RATE_LIMIT_PER_USER` | No | Max requests per user per minute | `60` (default) |
| `LOG_LEVEL` | No | Logging verbosity | `info` (default) |
| `TLS_CERT_PATH` | No | Path to TLS certificate | `/certs/server.crt` |
| `TLS_KEY_PATH` | No | Path to TLS private key | `/certs/server.key` |
| `ALLOWED_ORIGINS` | No | CORS origins (comma-separated) | `https://claude.ai,https://internal.loves.com` |

---

## 9. Docker Configuration

### 9.1 Dockerfile

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY dist/ ./dist/

RUN addgroup -S mcp && adduser -S mcp -G mcp
USER mcp

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
```

### 9.2 Docker Compose

```yaml
version: "3.8"

services:
  servicenow-mcp:
    build: .
    container_name: servicenow-mcp
    restart: unless-stopped
    ports:
      - "${MCP_PORT:-3000}:3000"
    env_file:
      - .env
    depends_on:
      redis:
        condition: service_healthy
    volumes:
      - ./certs:/certs:ro          # TLS certificates (optional)
    networks:
      - mcp-internal

  redis:
    image: redis:7-alpine
    container_name: servicenow-mcp-redis
    restart: unless-stopped
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD:-changeme}
      --maxmemory 128mb
      --maxmemory-policy allkeys-lru
      --appendonly yes
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-changeme}", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
    networks:
      - mcp-internal
    expose:
      - "6379"                     # Internal only, not published to host

volumes:
  redis-data:

networks:
  mcp-internal:
    driver: bridge
```

---

## 10. Setup Script (`setup.sh`)

A single idempotent script that takes a fresh Ubuntu/RHEL VM from zero to a running MCP server. Designed to be run once or re-run safely.

### What It Does

1. **System dependencies:** Installs Docker Engine and Docker Compose (if not already present)
2. **Repository clone:** Clones the project repo (or pulls latest if already cloned)
3. **Environment configuration:** Walks the operator through required env vars interactively, generating `.env` from `.env.example`. Auto-generates `TOKEN_ENCRYPTION_KEY` and `REDIS_PASSWORD`.
4. **TLS setup:** Prompts for cert paths or generates a self-signed cert for internal use
5. **Build and launch:** Runs `docker compose build` and `docker compose up -d`
6. **Health check:** Waits for the server to report healthy and prints the MCP endpoint URL
7. **ServiceNow reminder:** Prints the OAuth Application Registry configuration that must be created in ServiceNow (client ID, redirect URI, etc.)

### Script Flow

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Detect OS, install Docker + Compose if missing
# 2. Clone/pull repo to /opt/servicenow-mcp-server
# 3. Interactive .env generation
#    - Prompt: ServiceNow instance URL
#    - Prompt: OAuth Client ID
#    - Prompt: OAuth Client Secret
#    - Prompt: Server hostname/IP (for redirect URI)
#    - Prompt: TLS cert paths (or generate self-signed)
#    - Auto-generate: TOKEN_ENCRYPTION_KEY (openssl rand -base64 32)
#    - Auto-generate: REDIS_PASSWORD (openssl rand -base64 24)
# 4. npm ci && npm run build (inside a build container or locally)
# 5. docker compose up -d --build
# 6. Wait for healthcheck, print status
# 7. Print SN OAuth setup instructions
```

### Usage

```bash
# On the target VM:
curl -fsSL https://github.com/<org>/servicenow-mcp-server/raw/main/setup.sh | bash

# Or after cloning:
git clone https://github.com/<org>/servicenow-mcp-server.git
cd servicenow-mcp-server
chmod +x setup.sh
./setup.sh
```

---

## 11. Security Considerations

### 11.1 Token Security

- Access and refresh tokens are **AES-256-GCM encrypted** at rest in Redis
- Encryption key is an environment variable, never committed to source control
- Tokens are scoped per-user and never shared across sessions
- Access tokens have a short lifespan (30 min default) and are refreshed automatically
- If a refresh token is revoked or expired, the user must re-authenticate

### 11.2 Network Security

- The MCP server listens on the internal network only — not exposed to the public internet
- Redis is on an internal Docker network with no published ports
- TLS is enforced for all client-to-server communication
- CORS is restricted to allowed origins (configurable)
- The ServiceNow instance URL is validated at startup to prevent misconfiguration

### 11.3 Input Sanitization

- All tool inputs are validated and sanitized before being used in ServiceNow API calls
- Encoded query strings are built programmatically, never through string concatenation of raw user input
- ServiceNow's own ACLs provide the final enforcement layer — the MCP server does not attempt to replicate them

### 11.4 Audit Trail

- Every tool invocation is logged with: timestamp, user identity, tool name, input parameters (with sensitive fields redacted), SN response status, and execution time
- ServiceNow's native audit log captures all REST API activity under the user's identity
- Failed authentication attempts are logged and rate-limited

### 11.5 Secrets Management

- `.env` is gitignored
- `.env.example` contains only placeholder values
- The setup script generates cryptographically random secrets
- For production hardening, secrets should migrate to a vault (HashiCorp Vault, AWS Secrets Manager, etc.) — this is noted as a Phase 2 concern

---

## 12. Error Handling

### 12.1 Error Categories

| Category | HTTP from SN | MCP Tool Response | User-Facing Message |
|----------|-------------|-------------------|---------------------|
| Auth expired | 401 | Error + re-auth prompt | "Your session has expired. Please re-authenticate." |
| Insufficient permissions | 403 | Error with context | "You don't have access to [resource]. Contact your ServiceNow admin if this is unexpected." |
| Record not found | 404 | Error with context | "No [record type] found with [identifier]." |
| Validation failure | N/A (pre-request) | Error with field details | "Invalid input: [field] must be [constraint]." |
| Rate limited | 429 | Error with retry hint | "Rate limit exceeded. Please wait before retrying." |
| SN unavailable | 5xx | Error with retry hint | "ServiceNow is currently unavailable. Please try again shortly." |
| Unexpected | Any | Error with request ID | "An unexpected error occurred. Reference ID: [uuid]." |

### 12.2 Error Response Format

```json
{
  "success": false,
  "error": {
    "code": "AUTH_EXPIRED",
    "message": "Your session has expired. Please re-authenticate.",
    "details": null,
    "reference_id": "a1b2c3d4-..."
  }
}
```

---

## 13. Logging and Observability

**Logger:** Pino (structured JSON logging)

**Log Levels:**
- `error` — Authentication failures, SN API errors, unhandled exceptions
- `warn` — Token refresh failures (before retry), rate limit hits, deprecated tool usage
- `info` — Tool invocations (tool name, user, duration), OAuth events (login, refresh, logout)
- `debug` — Full request/response bodies (sensitive fields redacted), Redis operations

**Health Endpoint:** `GET /health` returns server status, Redis connectivity, and uptime. Used by Docker healthcheck and external monitoring.

**Metrics (Phase 2):** Prometheus-compatible `/metrics` endpoint exposing request counts, latency histograms, active sessions, and token refresh rates.

---

## 14. Testing Strategy

### Unit Tests

- **Token encryption/decryption** round-trip correctness
- **Query builder** sanitization and encoding
- **Input validators** for each tool
- **Rate limiter** token bucket logic

### Integration Tests

- **OAuth flow** end-to-end with a mock ServiceNow OAuth server
- **Tool execution** with mocked ServiceNow REST API responses
- **Token refresh** lifecycle (valid → expired → refreshed → re-auth required)
- **Error handling** for each error category

### Manual Validation

- Connect from Claude Desktop and execute each tool
- Verify ServiceNow audit log shows the correct user identity
- Verify ACL enforcement by testing with users of different roles
- Test token expiry and re-authentication flow

---

## 15. Rollout Plan

### Phase 1 — MVP (Target: 2–3 weeks)

- OAuth flow (authorize, callback, token refresh)
- Token store (Redis + encryption)
- Core tools: incidents (search, get, create, update, add_work_note), knowledge (search, get), user/group lookup, my_tasks, my_profile
- Docker Compose deployment
- Setup script
- Basic logging and health check

### Phase 2 — Extended Tools (Target: 2 weeks after MVP)

- Service Catalog tools (search, get, submit)
- Approval tools (get_my_approvals, approve_or_reject)
- CMDB tools (search, get details)
- Change Management tools

### Phase 3 — Hardening (Target: 2 weeks after Phase 2)

- Prometheus metrics
- Vault-based secrets management
- Automated integration test suite
- Rate limiting tuning based on real usage patterns
- Documentation for adding custom tools (the `_template.ts` pattern)

---

## 16. Client Configuration Examples

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "servicenow": {
      "type": "streamablehttp",
      "url": "https://mcp.internal.loves.com:3000/mcp"
    }
  }
}
```

### Custom MCP Client (Node.js)

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const transport = new StreamableHTTPClientTransport(
  new URL("https://mcp.internal.loves.com:3000/mcp")
);

const client = new Client({ name: "my-app", version: "1.0.0" });
await client.connect(transport);

const result = await client.callTool("search_incidents", {
  query: "assigned_to=me",
  state: "In Progress",
  limit: 5
});
```

---

## 17. Adding New Tools

New tools follow a consistent pattern. Copy `src/tools/_template.ts` and implement:

```typescript
// src/tools/_template.ts (pattern)

import { z } from "zod";
import { ServiceNowClient } from "../servicenow/client.js";

// 1. Define input schema with zod
export const myToolInputSchema = z.object({
  // ... fields with validation
});

// 2. Define the tool metadata
export const myToolDefinition = {
  name: "my_tool_name",
  description: "What this tool does — be specific for LLM discoverability",
  inputSchema: myToolInputSchema
};

// 3. Implement the handler
export async function handleMyTool(
  input: z.infer<typeof myToolInputSchema>,
  snClient: ServiceNowClient   // already authenticated as the calling user
) {
  // Validate, call SN, format response
}
```

Register the tool in `src/tools/registry.ts`. The server picks it up automatically on next restart.

---

## 18. Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP server framework and Streamable HTTP transport |
| `express` | HTTP server for OAuth routes and health endpoint |
| `ioredis` | Redis client |
| `zod` | Runtime input validation and schema definition |
| `axios` | HTTP client for ServiceNow REST API calls |
| `pino` | Structured JSON logging |
| `helmet` | HTTP security headers |
| `cors` | CORS middleware |
| `dotenv` | Environment variable loading |
| `typescript` | Type safety |

**Dev Dependencies:** `vitest` (testing), `tsx` (development runner), `@types/*` (type definitions)

---

## 19. Open Questions

1. **Auth proxy vs. direct OAuth:** Does the VM sit behind an existing auth proxy (e.g., Nginx + SAML) that injects user identity headers, or will users authenticate directly through the OAuth flow? This affects session management complexity.

2. **TLS termination:** Will TLS terminate at the MCP server container, at an upstream load balancer/reverse proxy, or is the internal network trusted enough for HTTP between proxy and container?

3. **ServiceNow instance scope:** Is this targeting production, a sub-production instance for initial testing, or both? Separate OAuth apps would be needed per instance.

4. **User provisioning:** Should the server restrict access to a specific ServiceNow group/role, or is it open to anyone who can authenticate?

5. **MCP client distribution:** How will users discover and configure the MCP endpoint? (IT portal instructions, pre-configured Claude Desktop configs pushed via MDM, etc.)

---

## 20. Glossary

| Term | Definition |
|------|-----------|
| **MCP** | Model Context Protocol — an open standard for connecting LLM applications to external tools and data sources |
| **Streamable HTTP** | MCP transport protocol for remote servers, replacing the older SSE-based transport |
| **OAuth 2.0 Authorization Code Grant** | An OAuth flow where a user authenticates directly, and the application receives a code that is exchanged for tokens tied to that user's identity |
| **ACL** | Access Control List — ServiceNow's mechanism for controlling who can read/write/create/delete records and fields |
| **sys_id** | ServiceNow's 32-character hexadecimal unique identifier for every record |
| **Bearer Token** | An OAuth access token passed in the HTTP Authorization header to authenticate API requests |
| **FDE** | Forward Deployed Engineer — an embedded engineering role focused on platform implementation at a customer site |

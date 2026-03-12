# ServiceNow MCP Server

![Node 22+](https://img.shields.io/badge/Node-22%2B-43853d?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-6f42c1)
![OAuth 2.0](https://img.shields.io/badge/Auth-OAuth%202.0-0a66c2)
![CI](https://img.shields.io/badge/CI-Build%20%2B%20Coverage-success)

Secure, enterprise-ready MCP server for ServiceNow where every action runs as the authenticated user.

No shared service accounts. No ACL bypass. Full audit-trail fidelity.

---

## Why This Exists

Instead of funneling every request through a shared service account, this server executes actions as the actual human user.

Because it uses **per-user OAuth tokens**, ServiceNow still enforces:

- each user's ACLs and roles,
- their approval authority,
- and native user-level audit logging.

Result: safer automation, cleaner compliance, fewer permission hacks.

---

## Core Capabilities

- Per-user OAuth 2.0 Authorization Code flow + refresh
- AES-256-GCM encrypted token storage in Redis
- Streamable HTTP MCP transport with per-session lifecycle
- Tool-level identity protections for sensitive operations
- Optional reconnect tokens for session persistence across server restarts
- Per-user rate limiting via Redis token bucket
- Input validation + normalized error responses
- CI-enforced build + test + coverage gate

---

## Quick Start

```bash
npm install
cp .env.example .env
npm run generate-key    # paste into TOKEN_ENCRYPTION_KEY
npm run dev
```

Health check: `curl -s http://localhost:8080/health`

For full setup instructions including ServiceNow OAuth configuration, see the [Getting Started guide](./docs/getting-started/README.md).

---

## Documentation

Comprehensive documentation lives in [`docs/`](./docs/README.md):

- **[Getting Started](./docs/getting-started/README.md)** — Prerequisites, local dev, OAuth setup, first tool call
- **[Architecture](./docs/architecture/README.md)** — System design, session lifecycle, request flow, Redis schema
- **[Authentication](./docs/auth/README.md)** — OAuth flow, token storage, refresh, reconnect tokens
- **[Security](./docs/security/README.md)** — Identity enforcement, input validation, rate limiting, error handling
- **[Tools (35)](./docs/tools/README.md)** — All tools: incidents, change requests, users, knowledge, tasks, catalog, catalog admin, update sets
- **[Prompts (4)](./docs/prompts/README.md)** — Guided workflows for catalog administration
- **[HTTP API](./docs/api/README.md)** — Endpoints and client configuration
- **[Deployment](./docs/deployment/README.md)** — Docker, Caddy, native TLS, setup script, environment variables
- **[Development](./docs/development/README.md)** — Adding tools, testing, CI pipeline
- **[Troubleshooting](./docs/troubleshooting/README.md)** — Common issues and debug cheat sheet

---

## Testing and Quality

```bash
npm run build
npm test
npm run test:coverage
```

- Coverage thresholds are configured in `vitest.config.ts`
- CI runs build + tests + coverage gate on PRs and `main`

---

## Client Config (Claude Desktop)

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

See [Client Configuration](./docs/api/client-configuration.md) for reconnect token and deployment-specific examples.

---

## Agent Instruction Files

- `AGENTS.md`
- `CLAUDE.md`
- `.github/copilot-instructions.md`

Alignment workflow validates expected consistency.

---

Built for secure, user-scoped AI operations in ServiceNow.

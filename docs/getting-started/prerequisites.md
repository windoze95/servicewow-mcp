[docs](../README.md) / [getting-started](./README.md) / prerequisites

# Prerequisites

## Required Software

| Software | Version | Purpose |
|---|---|---|
| **Node.js** | 22+ | Runtime (ES2022/NodeNext target) |
| **npm** | Bundled with Node | Package manager |
| **Redis** | 7+ | Token storage, session mapping, rate limiting |

### Node.js

The server targets ES2022 with NodeNext module resolution. Node 22 is the minimum supported version.

```bash
node --version   # v22.x.x
```

### Redis

Redis stores encrypted OAuth tokens, session mappings, reconnect tokens, OAuth state, and rate-limit counters. See [Redis Schema](../architecture/redis-schema.md) for key patterns.

For local development, install Redis natively or run it via Docker:

```bash
# macOS
brew install redis && brew services start redis

# Docker (standalone)
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

## ServiceNow Instance

You need access to a ServiceNow instance where you can:

1. Create an **OAuth Application** (System OAuth > Application Registry)
2. Assign the **`snc_platform_rest_api_access`** role to test users

See [ServiceNow OAuth Setup](./servicenow-oauth-setup.md) for step-by-step instructions.

## Optional

| Software | Purpose |
|---|---|
| **Docker + Docker Compose** | Containerized deployment (see [Deployment](../deployment/README.md)) |
| **openssl** | Generating encryption keys and TLS certificates |

---

**See also**: [Local Development](./local-development.md) · [Environment Variables](../deployment/environment-variables.md) · [Docker (Local)](../deployment/docker-local.md)

# ServiceNow MCP Server

An MCP (Model Context Protocol) server that proxies authenticated ServiceNow REST API access through per-user OAuth 2.0 tokens. Every action runs as the authenticated user, inheriting their ACLs, roles, and audit trail.

## Architecture

```
MCP Client ──► MCP Server (Express + Streamable HTTP) ──► ServiceNow REST API
                        │
                        └──► Redis (encrypted token store)
```

- **Per-user OAuth 2.0**: Authorization Code Grant flow — no shared service accounts
- **Encrypted token storage**: AES-256-GCM encrypted at rest in Redis
- **Per-session MCP instances**: Each MCP session gets its own server + transport pair
- **Rate limiting**: Token bucket algorithm per user via Redis

## Quick Start

### Prerequisites

- Node.js 22+
- Redis (or Docker Compose)
- A ServiceNow instance with an OAuth Application Registry entry

### Development

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your ServiceNow instance details

# Generate encryption key
npm run generate-key
# Add the output to your .env file

# Start in development mode
npm run dev
```

### Docker Deployment

```bash
# One-shot setup (Linux VM)
chmod +x setup.sh
./setup.sh

# Or manually:
docker compose up -d --build
```

## ServiceNow Setup

### OAuth Application

1. Navigate to **System OAuth > Application Registry** in ServiceNow
2. Create: **"Create an OAuth API endpoint for external clients"**
3. Configure:
   - **Redirect URL**: `https://<your-host>:3000/oauth/callback`
   - Note the **Client ID** and **Client Secret**
4. Add these to your `.env` file

### User Role Requirements

Users who will connect through this MCP server need the **`snc_platform_rest_api_access`** role to make REST API calls. Without it, ServiceNow returns a 403 on all API requests (this is enforced when the system property `glide.rest.enable_role_based_access` is `true`, which is the default on newer instances).

To grant access:
- **Per user**: Assign `snc_platform_rest_api_access` directly to the user record
- **Via group**: Create a group (e.g., "MCP Users"), add the role to the group, and manage membership there

This role only grants the ability to call REST APIs — actual record-level access is still governed by each user's existing ACLs and roles.

## Available Tools (16 total)

### Incident Management
| Tool | Description |
|------|-------------|
| `search_incidents` | Query incidents with filters (state, priority, assigned to me) |
| `get_incident` | Get full incident details by number or sys_id |
| `create_incident` | Create a new incident |
| `update_incident` | Update fields on an existing incident |
| `add_work_note` | Add a work note or customer-visible comment |

### User & Group Lookup
| Tool | Description |
|------|-------------|
| `lookup_user` | Search users by name, email, or employee ID |
| `lookup_group` | Search assignment groups by name |
| `get_my_profile` | Get your own ServiceNow profile |

### Knowledge Base
| Tool | Description |
|------|-------------|
| `search_knowledge` | Full-text search across knowledge bases |
| `get_article` | Get a full knowledge article |

### Task Management
| Tool | Description |
|------|-------------|
| `get_my_tasks` | Get all open tasks assigned to you |
| `get_my_approvals` | Get your pending approvals |
| `approve_or_reject` | Approve or reject a pending approval |

### Service Catalog
| Tool | Description |
|------|-------------|
| `search_catalog_items` | Search the service catalog |
| `get_catalog_item` | Get catalog item details and form variables |
| `submit_catalog_request` | Submit a catalog request |

## Client Configuration

### Claude Desktop

```json
{
  "mcpServers": {
    "servicenow": {
      "type": "streamablehttp",
      "url": "https://your-host:3000/mcp"
    }
  }
}
```

## Configuration

All configuration via environment variables. See `.env.example` for the full list.

| Variable | Required | Description |
|----------|----------|-------------|
| `SERVICENOW_INSTANCE_URL` | Yes | ServiceNow instance URL |
| `SERVICENOW_CLIENT_ID` | Yes | OAuth client ID |
| `SERVICENOW_CLIENT_SECRET` | Yes | OAuth client secret |
| `OAUTH_REDIRECT_URI` | Yes | OAuth callback URL |
| `TOKEN_ENCRYPTION_KEY` | Yes | Base64-encoded 32-byte AES key |
| `REDIS_URL` | No | Redis connection string (default: `redis://localhost:6379`) |
| `MCP_PORT` | No | Server port (default: `3000`) |
| `RATE_LIMIT_PER_USER` | No | Requests per user per minute (default: `60`) |

## Adding New Tools

Copy `src/tools/_template.ts` and follow the pattern. Register your new tool in `src/tools/registry.ts`.

## Testing

```bash
npm test          # Run unit tests
npm run test:watch # Watch mode
```

## Endpoints

| Path | Method | Description |
|------|--------|-------------|
| `/health` | GET | Health check |
| `/oauth/authorize` | GET | Start OAuth flow |
| `/oauth/callback` | GET | OAuth callback |
| `/mcp` | POST | MCP initialize + tool calls |
| `/mcp` | GET | MCP SSE notifications |
| `/mcp` | DELETE | Close MCP session |

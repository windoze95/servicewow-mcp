[docs](../README.md) / api

# HTTP API

The server exposes 8 HTTP endpoints: a health check, OAuth routes, and the MCP transport endpoint.

## Section Index

| Guide | Description |
|---|---|
| [Endpoints](./endpoints.md) | All 8 endpoints with request/response details |
| [Client Configuration](./client-configuration.md) | Claude Desktop JSON config examples |

## Overview

The server uses **Streamable HTTP** as its MCP transport. This means:

- `POST /mcp` handles both `initialize` and subsequent tool calls
- `GET /mcp` opens an SSE stream for server-to-client notifications
- `DELETE /mcp` closes a session
- Sessions are identified by the `Mcp-Session-Id` header

All other endpoints (`/health`, `/oauth/*`) are standard REST.

---

**See also**: [Architecture Overview](../architecture/README.md) · [Session Lifecycle](../architecture/session-lifecycle.md) · [Deployment](../deployment/README.md)

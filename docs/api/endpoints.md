[docs](../README.md) / [api](./README.md) / endpoints

# Endpoints

## Health Check

### `GET /health`

Returns server health status including Redis connectivity.

**Response (200)**:
```json
{
  "status": "healthy",
  "uptime": 123.456,
  "redis": "connected",
  "timestamp": "2026-03-11T12:00:00.000Z"
}
```

**Response (503)** — Redis disconnected:
```json
{
  "status": "unhealthy",
  "redis": "disconnected",
  "timestamp": "2026-03-11T12:00:00.000Z"
}
```

---

## MCP-Spec OAuth

The server implements MCP-spec OAuth 2.0 with PKCE. MCP clients discover endpoints automatically via `GET /.well-known/oauth-authorization-server`. The following endpoints are handled by the SDK's built-in middleware:

- `GET /.well-known/oauth-authorization-server` — OAuth metadata discovery
- `POST /register` — Dynamic client registration (RFC 7591)
- `GET /authorize` — Authorization endpoint (PKCE code challenge)
- `POST /token` — Token exchange and refresh

See [OAuth Flow](../auth/oauth-flow.md) for the full step-by-step.

### `GET /oauth/sn-callback`

ServiceNow OAuth callback. After the user authorizes on ServiceNow, this endpoint exchanges the SN authorization code for tokens, stores them, and redirects back to the MCP client.

| Query Parameter | Source | Description |
|---|---|---|
| `code` | ServiceNow | Authorization code |
| `state` | ServiceNow | CSRF state parameter |
| `error` | ServiceNow | Error code (if auth failed) |

**Response**: `302 Redirect` back to the MCP client's `redirect_uri` with an authorization code and state.

**Error responses**: `SN_OAUTH_ERROR` (400), `INVALID_CALLBACK` (400), `INVALID_STATE` (400), `TOKEN_EXCHANGE_FAILED` (500). See [OAuth Flow](../auth/oauth-flow.md).

---

## MCP Transport

### `POST /mcp`

Handles MCP initialize requests and tool calls.

| Header | Required | Description |
|---|---|---|
| `Authorization` | Yes | `Bearer <mcp_access_token>` |
| `Mcp-Session-Id` | For existing sessions | Session ID from previous initialize |
| `Content-Type` | Yes | `application/json` |

**Without session header**: Creates a new MCP session (initialize flow). Returns `Mcp-Session-Id` in response header.

**With valid session header**: Routes to existing session's transport for tool calls.

### `GET /mcp`

Opens an SSE stream for server-to-client notifications (Streamable HTTP spec).

| Header | Required | Description |
|---|---|---|
| `Mcp-Session-Id` | Yes | Valid session ID |

**Response (400)** if session ID is missing or invalid.

### `DELETE /mcp`

Closes an MCP session.

| Header | Required | Description |
|---|---|---|
| `Mcp-Session-Id` | Yes | Session ID to close |

**Response (200)**:
```json
{ "message": "Session closed" }
```

**Response (404)** if session not found.

---

**See also**: [Session Lifecycle](../architecture/session-lifecycle.md) · [Client Configuration](./client-configuration.md) · [Request Flow](../architecture/request-flow.md)

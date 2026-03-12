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

## OAuth

### `GET /oauth/authorize`

Starts the OAuth 2.0 Authorization Code flow. Redirects the user to ServiceNow's login page.

| Query Parameter | Required | Description |
|---|---|---|
| `session_id` | No | MCP session ID to map after successful auth |

**Response**: `302 Redirect` to `{SERVICENOW_INSTANCE_URL}/oauth_auth.do?...`

### `GET /oauth/callback`

OAuth callback endpoint. Exchanges the authorization code for tokens.

| Query Parameter | Source | Description |
|---|---|---|
| `code` | ServiceNow | Authorization code |
| `state` | ServiceNow | CSRF state parameter |
| `error` | ServiceNow | Error code (if auth failed) |

**Response (200)** — Success:
```json
{
  "success": true,
  "message": "Authentication successful for Jane Smith. You can now use MCP tools.",
  "user": {
    "sys_id": "abc123...",
    "user_name": "jane.smith",
    "display_name": "Jane Smith"
  }
}
```

**Error responses**: `OAUTH_ERROR` (400), `INVALID_CALLBACK` (400), `INVALID_STATE` (400), `TOKEN_EXCHANGE_FAILED` (500). See [OAuth Flow](../auth/oauth-flow.md).

### `POST /oauth/reconnect-token`

Generate a reconnect token for session persistence across restarts.

**Request body**:
```json
{ "user_sys_id": "abc123..." }
```

**Response (201)**:
```json
{
  "success": true,
  "reconnect_token": "a1b2c3d4...64hex",
  "ttl_seconds": 8640000
}
```

**Error responses**: `INVALID_REQUEST` (400), `NO_CREDENTIALS` (404).

### `DELETE /oauth/reconnect-token`

Revoke reconnect token(s).

**Revoke specific token**:
```json
{ "user_sys_id": "abc123...", "reconnect_token": "a1b2c3..." }
```

**Revoke all tokens for a user**:
```json
{ "user_sys_id": "abc123...", "revoke_all": true }
```

**Response (200)**:
```json
{ "success": true, "message": "Reconnect token revoked" }
```

See [Reconnect Tokens](../auth/reconnect-tokens.md) for full details.

---

## MCP Transport

### `POST /mcp`

Handles MCP initialize requests and tool calls.

| Header | Required | Description |
|---|---|---|
| `Mcp-Session-Id` | For existing sessions | Session ID from previous initialize |
| `Content-Type` | Yes | `application/json` |

| Query Parameter | Required | Description |
|---|---|---|
| `token` | No | Reconnect token for auto-authentication |

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

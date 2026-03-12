[docs](../README.md) / auth

# Authentication System

The server uses **OAuth 2.0 Authorization Code** flow to obtain per-user tokens from ServiceNow. Every tool call executes as the authenticated user — there are no shared service accounts.

## How It Works

1. User visits `/oauth/authorize` → redirected to ServiceNow login
2. ServiceNow redirects back to `/oauth/callback` with an authorization code
3. Server exchanges the code for access + refresh tokens
4. Tokens are AES-256-GCM encrypted and stored in Redis
5. The MCP session is mapped to the user's `sys_id`
6. Subsequent tool calls use the user's access token
7. Expired tokens are refreshed transparently

## Section Index

| Guide | Description |
|---|---|
| [OAuth Flow](./oauth-flow.md) | Authorization Code flow with CSRF protection |
| [Token Storage](./token-storage.md) | AES-256-GCM encryption, StoredToken shape, Redis keys |
| [Token Refresh](./token-refresh.md) | Transparent refresh with distributed lock |
| [Reconnect Tokens](./reconnect-tokens.md) | Session persistence across server restarts |

## Key Properties

- **Per-user isolation**: Each user's tokens are stored separately. One user cannot access another's credentials.
- **Encryption at rest**: Tokens are encrypted with AES-256-GCM before being written to Redis.
- **Automatic refresh**: Access tokens are refreshed transparently when they expire (with a 60-second buffer).
- **Session affinity**: OAuth credentials are linked to MCP sessions via Redis session mappings.
- **Reconnect support**: Optional reconnect tokens allow clients to skip re-authentication after server restarts.

---

**See also**: [ServiceNow OAuth Setup](../getting-started/servicenow-oauth-setup.md) · [Redis Schema](../architecture/redis-schema.md) · [Security Overview](../security/README.md)

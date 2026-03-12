[docs](../README.md) / auth

# Authentication System

The server uses **MCP-spec OAuth 2.0** with PKCE to authenticate MCP clients, delegating to ServiceNow for user identity. Every tool call executes as the authenticated user — there are no shared service accounts.

## How It Works (SDK OAuth Flow)

1. MCP client discovers OAuth metadata via `/.well-known/oauth-authorization-server`
2. Client registers dynamically via `POST /register` (gets `client_id` + `client_secret`)
3. Client sends user to `GET /authorize` with PKCE `code_challenge`
4. Server redirects user to ServiceNow for login/consent
5. ServiceNow redirects back to `/oauth/sn-callback` with an authorization code
6. Server exchanges the SN code for SN tokens, stores them, and generates our own authorization code
7. Server redirects back to the MCP client's `redirect_uri` with our code
8. Client exchanges our code via `POST /token` (with PKCE `code_verifier`)
9. Server returns an opaque MCP access token + refresh token
10. Client sends `Authorization: Bearer <token>` on every `/mcp` request
11. Tool calls resolve user from the bearer token → ServiceNow API calls use the user's SN access token

## Section Index

| Guide | Description |
|---|---|
| [OAuth Flow](./oauth-flow.md) | Authorization Code flow with CSRF protection |
| [Token Storage](./token-storage.md) | AES-256-GCM encryption, StoredToken shape, Redis keys |
| [Token Refresh](./token-refresh.md) | Transparent refresh with distributed lock |
| [Reconnect Tokens](./reconnect-tokens.md) | Session persistence across server restarts |

## Key Properties

- **MCP-spec OAuth**: Standard discovery, PKCE, dynamic client registration — MCP clients handle auth natively.
- **Per-user isolation**: Each user's tokens are stored separately. One user cannot access another's credentials.
- **Encryption at rest**: ServiceNow tokens are encrypted with AES-256-GCM before being written to Redis.
- **Two-layer tokens**: MCP clients get opaque access/refresh tokens; these map to ServiceNow tokens stored in Redis.
- **Automatic refresh**: ServiceNow access tokens are refreshed transparently when they expire (with a 60-second buffer).
- **Bearer auth**: Every `/mcp` request requires `Authorization: Bearer` — no more session-based auth.

---

**See also**: [ServiceNow OAuth Setup](../getting-started/servicenow-oauth-setup.md) · [Redis Schema](../architecture/redis-schema.md) · [Security Overview](../security/README.md)

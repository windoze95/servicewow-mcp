[docs](../README.md) / [auth](./README.md) / reconnect-tokens

# Reconnect Tokens

After a server restart, in-memory MCP sessions are lost. Normally this requires users to redo the full OAuth flow. **Reconnect tokens** let clients skip re-authentication by auto-mapping a new session to existing Redis-stored OAuth credentials.

## How It Works

### 1. Generate a Token

After completing OAuth, request a reconnect token:

```bash
curl -X POST https://host:8080/oauth/reconnect-token \
  -H "Content-Type: application/json" \
  -d '{"user_sys_id": "abc123..."}'
```

Response:

```json
{
  "success": true,
  "reconnect_token": "a1b2c3d4...64hex",
  "ttl_seconds": 8640000
}
```

The server validates that the user has existing OAuth credentials in Redis before generating the token.

### 2. Configure the Client

Add the token to your MCP client URL:

```json
{
  "mcpServers": {
    "servicenow": {
      "type": "streamablehttp",
      "url": "https://host:8080/mcp?token=a1b2c3d4...64hex"
    }
  }
}
```

### 3. Automatic Reconnection

On server restart (or any new session), the `POST /mcp` handler:

1. Reads the `token` query parameter
2. Looks up `reconnect:<token>` in Redis → `user_sys_id`
3. Verifies the user still has valid OAuth credentials (`token:<user_sys_id>`)
4. Creates the session with a pre-mapped user (7-day session TTL vs normal 24h)
5. Refreshes the reconnect token's TTL

If the token is invalid, expired, or the user's credentials are gone, the session silently falls through to normal (unauthenticated) behavior.

## Token Management

### TTL

Tokens default to 100 days (`RECONNECT_TOKEN_TTL`, default `8640000` seconds). The TTL is refreshed on every successful use, so active tokens effectively never expire.

### Revoke a Specific Token

```bash
curl -X DELETE https://host:8080/oauth/reconnect-token \
  -H "Content-Type: application/json" \
  -d '{"user_sys_id": "abc123...", "reconnect_token": "a1b2c3..."}'
```

### Revoke All Tokens for a User

```bash
curl -X DELETE https://host:8080/oauth/reconnect-token \
  -H "Content-Type: application/json" \
  -d '{"user_sys_id": "abc123...", "revoke_all": true}'
```

This uses the `reconnect_index:<user_sys_id>` set in Redis to find and delete all tokens.

## Redis Keys

| Key | Type | TTL |
|---|---|---|
| `reconnect:<token_hex>` | String → `user_sys_id` | Configurable (default 100 days), refreshed on use |
| `reconnect_index:<user_sys_id>` | Set of token hex strings | Same as token TTL |

See [Redis Schema](../architecture/redis-schema.md) for all key patterns.

## Security Considerations

- Reconnect tokens are 32-byte cryptographically random hex strings (256-bit entropy)
- Tokens are **not** logged (pino redact config provides defense-in-depth)
- A compromised token grants access only for the associated user, limited by that user's ServiceNow ACLs
- Revocation is immediate (Redis DEL)
- If the user's underlying OAuth credentials expire or are revoked in Redis, the reconnect token becomes useless

---

**See also**: [Session Lifecycle](../architecture/session-lifecycle.md) · [Client Configuration](../api/client-configuration.md) · [Environment Variables](../deployment/environment-variables.md)

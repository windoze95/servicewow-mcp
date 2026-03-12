[docs](../README.md) / [architecture](./README.md) / redis-schema

# Redis Schema

All persistent state lives in Redis. This document covers every key pattern, its TTL, and data shape.

## Key Patterns

### 1. `token:<user_sys_id>` — OAuth Credentials

Stores the user's encrypted OAuth tokens.

| Field | Value |
|---|---|
| **Type** | String (AES-256-GCM encrypted JSON) |
| **TTL** | 8,640,000 seconds (100 days) |
| **Set by** | `TokenStore.storeToken()` |
| **Read by** | `TokenStore.getToken()` |

**Decrypted shape** (`StoredToken`):

```typescript
{
  access_token: string;
  refresh_token: string;
  expires_at: number;      // Unix timestamp (seconds)
  user_sys_id: string;
  user_name: string;
  display_name: string;
}
```

See [Token Storage](../auth/token-storage.md) for encryption details.

### 2. `token_refresh_lock:<user_sys_id>` — Refresh Lock

Distributed lock to prevent concurrent token refresh for the same user.

| Field | Value |
|---|---|
| **Type** | String (`"1"`) |
| **TTL** | 10 seconds |
| **Set by** | `TokenRefresher.refreshWithLock()` via `SET NX EX` |
| **Deleted by** | `TokenRefresher.refreshWithLock()` in `finally` block |

### 3. `ratelimit:<user_sys_id>` — Rate Limit Bucket

Token bucket counter for per-user rate limiting.

| Field | Value |
|---|---|
| **Type** | Hash (`{ tokens: number, last_refill: number }`) |
| **TTL** | 120 seconds (2x the 60-second window) |
| **Set by** | Rate limiter Lua script |
| **Read by** | Rate limiter Lua script |

See [Rate Limiting](../security/rate-limiting.md) for the Lua script details.

### 4. `oauth_client:<client_id>` — Registered OAuth Client

Stores dynamic client registration data.

| Field | Value |
|---|---|
| **Type** | String (JSON: `OAuthClientInformationFull`) |
| **TTL** | 7,776,000 seconds (90 days) |
| **Set by** | `RedisClientStore.registerClient()` |
| **Read by** | `RedisClientStore.getClient()` |

### 5. `pending_auth:<id>` — In-Flight Authorization

Links a ServiceNow OAuth callback back to the MCP client's authorization request.

| Field | Value |
|---|---|
| **Type** | String (JSON: `{ clientId, redirectUri, codeChallenge, state, scopes }`) |
| **TTL** | 600 seconds (10 minutes) |
| **Set by** | `ServiceNowOAuthProvider.authorize()` |
| **Read by** | `/oauth/sn-callback` route |

### 6. `sn_state:<state>` — ServiceNow CSRF State

CSRF state for the ServiceNow leg of the SDK OAuth flow. One-time use.

| Field | Value |
|---|---|
| **Type** | String (JSON: `{ pendingAuthId }`) |
| **TTL** | 600 seconds (10 minutes) |
| **Set by** | `ServiceNowOAuthProvider.authorize()` |
| **Read by** | `/oauth/sn-callback` route (deletes on read) |

### 7. `auth_code:<code>` — MCP Authorization Code

Our authorization code issued after successful ServiceNow authentication.

| Field | Value |
|---|---|
| **Type** | String (JSON: `{ userSysId, clientId, codeChallenge, redirectUri, scopes }`) |
| **TTL** | 300 seconds (5 minutes) |
| **Set by** | `/oauth/sn-callback` route |
| **Read by** | `ServiceNowOAuthProvider.exchangeAuthorizationCode()` |

### 8. `mcp_token:<token>` — MCP Access Token

Opaque bearer token issued to MCP clients. Maps to a ServiceNow user.

| Field | Value |
|---|---|
| **Type** | String (JSON: `{ userSysId, clientId, scopes, expiresAt }`) |
| **TTL** | 3,600 seconds (1 hour) |
| **Set by** | `ServiceNowOAuthProvider.exchangeAuthorizationCode()` / `exchangeRefreshToken()` |
| **Read by** | `ServiceNowOAuthProvider.verifyAccessToken()` |

### 9. `mcp_refresh:<token>` — MCP Refresh Token

Long-lived refresh token for obtaining new MCP access tokens.

| Field | Value |
|---|---|
| **Type** | String (JSON: `{ userSysId, clientId, scopes }`) |
| **TTL** | 2,592,000 seconds (30 days) |
| **Set by** | `ServiceNowOAuthProvider.exchangeAuthorizationCode()` |
| **Read by** | `ServiceNowOAuthProvider.exchangeRefreshToken()` |

## Summary Table

| Key Pattern | Type | TTL | Purpose |
|---|---|---|---|
| `token:<user_sys_id>` | String (encrypted) | 100 days | ServiceNow OAuth credentials |
| `token_refresh_lock:<user_sys_id>` | String | 10 sec | Distributed refresh lock |
| `ratelimit:<user_sys_id>` | Hash | 2 min | Token bucket counter |
| `oauth_client:<client_id>` | String (JSON) | 90 days | Registered OAuth clients |
| `pending_auth:<id>` | String (JSON) | 10 min | In-flight authorization |
| `sn_state:<state>` | String (JSON) | 10 min | ServiceNow CSRF state |
| `auth_code:<code>` | String (JSON) | 5 min | MCP authorization codes |
| `mcp_token:<token>` | String (JSON) | 1 hour | MCP access tokens |
| `mcp_refresh:<token>` | String (JSON) | 30 days | MCP refresh tokens |

---

**See also**: [Token Storage](../auth/token-storage.md) · [Token Refresh](../auth/token-refresh.md) · [Rate Limiting](../security/rate-limiting.md)

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

### 2. `session:<session_id>` — Session-to-User Mapping

Maps an MCP session ID to a ServiceNow user.

| Field | Value |
|---|---|
| **Type** | String (`user_sys_id`) |
| **TTL** | 86,400 seconds (24 hours) for normal sessions; 604,800 seconds (7 days) for reconnect sessions |
| **Set by** | `TokenStore.storeSessionMapping()` or `storeSessionMappingWithTTL()` |
| **Read by** | `TokenStore.getUserForSession()` |

### 3. `reconnect:<token_hex>` — Reconnect Token

Maps a reconnect token to a user.

| Field | Value |
|---|---|
| **Type** | String (`user_sys_id`) |
| **TTL** | Configurable via `RECONNECT_TOKEN_TTL` (default 8,640,000 seconds / 100 days), refreshed on each successful use |
| **Set by** | `TokenStore.storeReconnectToken()` |
| **Read by** | `TokenStore.getUserForReconnectToken()` |

### 4. `reconnect_index:<user_sys_id>` — Reconnect Token Index

Set of all reconnect tokens belonging to a user. Used for "revoke all" operations.

| Field | Value |
|---|---|
| **Type** | Set (members are token hex strings) |
| **TTL** | Same as the reconnect token TTL |
| **Set by** | `TokenStore.storeReconnectToken()` |
| **Read by** | `TokenStore.revokeAllReconnectTokens()` |

### 5. `oauth_state:<state_hex>` — OAuth CSRF State

Stores OAuth state parameters for CSRF protection. One-time use.

| Field | Value |
|---|---|
| **Type** | String (JSON: `{ sessionId?: string, redirectUri?: string }`) |
| **TTL** | 600 seconds (10 minutes) |
| **Set by** | `TokenStore.storeOAuthState()` |
| **Read by** | `TokenStore.getOAuthState()` (deletes on read) |

### 6. `token_refresh_lock:<user_sys_id>` — Refresh Lock

Distributed lock to prevent concurrent token refresh for the same user.

| Field | Value |
|---|---|
| **Type** | String (`"1"`) |
| **TTL** | 10 seconds |
| **Set by** | `TokenRefresher.refreshWithLock()` via `SET NX EX` |
| **Deleted by** | `TokenRefresher.refreshWithLock()` in `finally` block |

### 7. `ratelimit:<user_sys_id>` — Rate Limit Bucket

Token bucket counter for per-user rate limiting.

| Field | Value |
|---|---|
| **Type** | Hash (`{ tokens: number, last_refill: number }`) |
| **TTL** | 120 seconds (2x the 60-second window) |
| **Set by** | Rate limiter Lua script |
| **Read by** | Rate limiter Lua script |

See [Rate Limiting](../security/rate-limiting.md) for the Lua script details.

## Summary Table

| Key Pattern | Type | TTL | Purpose |
|---|---|---|---|
| `token:<user_sys_id>` | String (encrypted) | 100 days | OAuth credentials |
| `session:<session_id>` | String | 24h / 7d | Session → user mapping |
| `reconnect:<token>` | String | 100 days (configurable) | Reconnect token → user |
| `reconnect_index:<user_sys_id>` | Set | 100 days (configurable) | User's reconnect tokens |
| `oauth_state:<state>` | String (JSON) | 10 min | CSRF state (one-time) |
| `token_refresh_lock:<user_sys_id>` | String | 10 sec | Distributed refresh lock |
| `ratelimit:<user_sys_id>` | Hash | 2 min | Token bucket counter |

---

**See also**: [Token Storage](../auth/token-storage.md) · [Token Refresh](../auth/token-refresh.md) · [Rate Limiting](../security/rate-limiting.md)

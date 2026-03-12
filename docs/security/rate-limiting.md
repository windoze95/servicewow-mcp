[docs](../README.md) / [security](./README.md) / rate-limiting

# Rate Limiting

Per-user rate limiting uses a token bucket algorithm implemented as a Redis Lua script. This prevents any single user from overwhelming ServiceNow with API requests.

## Configuration

| Variable | Default | Description |
|---|---|---|
| `RATE_LIMIT_PER_USER` | `60` | Maximum requests per minute per user |

## Algorithm: Token Bucket

The token bucket refills continuously. Each request consumes one token. When the bucket is empty, requests are rejected.

- **Capacity**: `RATE_LIMIT_PER_USER` (default 60)
- **Window**: 60 seconds
- **Refill rate**: `capacity / window` tokens per second (1 token/second at default)

## Redis Implementation

The rate limiter uses a Lua script executed atomically via `EVAL`:

```
Key:   ratelimit:<user_sys_id>
Type:  Hash { tokens: number, last_refill: number }
TTL:   120 seconds (2x the window)
```

### Lua Script Logic

1. Read current `tokens` and `last_refill` from the hash
2. If key doesn't exist, initialize with full capacity
3. Calculate elapsed time since last refill
4. Add refilled tokens: `min(capacity, tokens + floor(elapsed * capacity / window))`
5. If `tokens > 0`: consume one token, return `1` (allowed)
6. If `tokens == 0`: return `0` (rejected)
7. Update hash and reset TTL

The Lua script runs atomically in Redis, preventing race conditions between concurrent requests.

## Fail-Open Behavior

If the Redis Lua script throws an error (e.g., Redis connectivity issue), the rate limiter **allows the request**:

```typescript
catch (err) {
  logger.error({ err, userSysId }, "Rate limiter error, allowing request");
  return true; // Fail open
}
```

This design choice prioritizes availability over strict enforcement. A Redis outage shouldn't block legitimate users.

## Integration Point

Rate limiting is checked in `getContext()` (in `src/tools/registry.ts`) after resolving the user but before refreshing the token:

```
session → user_sys_id → rate limit check → token refresh → ServiceNowClient
```

If rate-limited, the tool returns:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Please wait before retrying."
  }
}
```

---

**See also**: [Request Flow](../architecture/request-flow.md) · [Redis Schema](../architecture/redis-schema.md) · [Error Handling](./error-handling.md)

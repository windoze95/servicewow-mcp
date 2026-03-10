# Test Plan (Prioritized)

## Priority 1 (Security / Availability)

1. `src/auth/tokenRefresh.ts`
   - `ensureFreshToken` returns existing token when outside refresh buffer.
   - Missing token throws `AuthRequiredError`.
   - Refresh lock contention waits and re-reads token.
   - Refresh `400/401` deletes token and forces re-auth.

2. `src/tools/registry.ts`
   - Missing session/user returns structured `AUTH_REQUIRED` response with `auth_url`.
   - Tool wrapper preserves known `toolError` responses and normalizes unknown errors.

3. `src/auth/oauth.ts`
   - Callback rejects missing `code/state`, invalid state, and ServiceNow OAuth error.
   - Success path stores token and session mapping.

4. `src/server.ts`
   - `/health` returns `200` when Redis ping succeeds and `503` when it fails.
   - MCP routes enforce valid session behavior for `GET`/`DELETE`.

## Priority 2 (API correctness)

5. `src/servicenow/client.ts`
   - Request helpers merge defaults (`sysparm_display_value`) with caller options.
   - Error mapping for `404`, `429`, `5xx`, and generic client errors.

6. `src/middleware/rateLimiter.ts`
   - Redis Lua allow/deny branches.
   - Fail-open behavior when Redis errors.

7. `src/tools/tasks.ts`
   - `approve_or_reject` enforces approval ownership checks and status transitions.

8. `src/tools/updateSets.ts`
   - `change_update_set` handles exact match, ambiguous name, and not found.

## Implemented in this batch

- `tests/unit/auth/tokenRefresh.test.ts`
- `tests/unit/servicenow/client.test.ts`
- `tests/unit/tools/registry.test.ts`
- `tests/unit/middleware/rateLimiter.test.ts`
- `tests/unit/auth/oauth.test.ts`
- `tests/unit/server.test.ts`
- `tests/unit/tools/tasks.test.ts`
- `tests/unit/tools/updateSets.test.ts`
- `tests/unit/config.test.ts`
- `tests/unit/index.test.ts`

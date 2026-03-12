[docs](../README.md) / troubleshooting

# Troubleshooting

Common issues and their solutions.

## 1. OAuth Callback Fails (`TOKEN_EXCHANGE_FAILED`)

**Symptoms**: `/oauth/callback` returns 500. Logs show token exchange failure or `invalid_grant`.

**Checks**:
- `OAUTH_REDIRECT_URI` in `.env` **exactly** matches the ServiceNow OAuth app's Redirect URL (including protocol, host, port, and path)
- `SERVICENOW_CLIENT_ID` and `SERVICENOW_CLIENT_SECRET` are correct
- System clock is accurate (OAuth codes expire quickly)

**Fix**: Correct the redirect URI or client credentials in `.env`, restart the server, and re-run the auth flow from `/oauth/authorize`.

See [OAuth Flow](../auth/oauth-flow.md) for the full flow details.

## 2. Auth Works, but API Calls Return 403

**Symptoms**: Tool calls fail with `INSUFFICIENT_PERMISSIONS`.

**Checks**:
- User has the `snc_platform_rest_api_access` role
- User has the needed table/record ACL permissions in ServiceNow

**Fix**: Grant the missing role or ACL permissions in ServiceNow. See [ServiceNow OAuth Setup](../getting-started/servicenow-oauth-setup.md).

## 3. Redis Connectivity Issues

**Symptoms**: `/health` returns `"status": "unhealthy"`, `"redis": "disconnected"`. Startup logs show Redis connection errors.

**Checks**:
- Redis is running and reachable
- `REDIS_URL` in `.env` is correct
- For Docker: the `redis` service is healthy (`docker compose ps`)

**Fix**: Start Redis, correct `REDIS_URL`, and restart the app.

See [Redis Schema](../architecture/redis-schema.md) for the data Redis stores.

## 4. CI Fails on Coverage Threshold

**Symptoms**: GitHub Actions fails during `npm run test:coverage`.

**Checks**:
- Inspect uncovered lines in the coverage output
- Ensure changed logic has matching tests

**Fix**: Add targeted tests for uncovered paths. Re-run locally with `npm run test:coverage`.

See [Testing](../development/testing.md) for testing patterns.

## 5. Reconnect Token Not Working After Restart

**Symptoms**: Client connects with `?token=...` but the session is unauthenticated (tools return `AUTH_REQUIRED`).

**Checks**:
- Token may be expired (default 100-day TTL)
- User's OAuth credentials may have been revoked or expired in Redis
- Token may have been explicitly revoked

**Fix**:
1. Re-authenticate via `/oauth/authorize` if OAuth credentials are gone
2. Generate a new reconnect token via `POST /oauth/reconnect-token`
3. Update the client URL with the new token

See [Reconnect Tokens](../auth/reconnect-tokens.md) for full details.

## 6. Tool Says `AUTH_REQUIRED` After Prior Login

**Symptoms**: Tool requests re-authentication unexpectedly.

**Checks**:
- Refresh token may be expired or revoked by ServiceNow
- Session mapping in Redis may have expired (24h TTL for normal sessions, 7d for reconnect sessions)
- Redis data may have been flushed

**Fix**: Re-authenticate via `/oauth/authorize`. Confirm Redis persistence and restart behavior.

See [Token Refresh](../auth/token-refresh.md) and [Session Lifecycle](../architecture/session-lifecycle.md).

## Debug Cheat Sheet

```bash
# Install and run
npm install
npm run dev

# Quality gates
npm run build
npm test
npm run test:coverage

# Health check
curl -s http://localhost:8080/health | jq

# Local Redis check (when redis-cli is available)
redis-cli -u "$REDIS_URL" ping

# Docker stack status
docker compose ps
docker compose logs -f

# Check specific service logs
docker compose logs -f servicenow-mcp
docker compose logs -f redis
```

---

**See also**: [Getting Started](../getting-started/README.md) · [Error Handling](../security/error-handling.md) · [Environment Variables](../deployment/environment-variables.md)

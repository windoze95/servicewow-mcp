[docs](../README.md) / [security](./README.md) / error-handling

# Error Handling

All tool errors are normalized into a consistent `ToolError` shape. This prevents leaking internal details while providing actionable information to clients.

## ToolError Shape

```typescript
interface ToolError {
  success: false;
  error: {
    code: string;           // Machine-readable error code
    message: string;        // Human-readable message
    details?: unknown;      // Optional additional context
    reference_id: string;   // UUID for log correlation
  };
}
```

## ErrorCode Enum

| Code | HTTP Equiv | When |
|---|---|---|
| `AUTH_REQUIRED` | 401 | No valid bearer token, no SN credentials, or refresh token expired |
| `AUTH_EXPIRED` | 401 | ServiceNow returned 401 (token invalidated server-side) |
| `INSUFFICIENT_PERMISSIONS` | 403 | ServiceNow returned 403 (missing ACL/role) |
| `NOT_FOUND` | 404 | Record not found in ServiceNow |
| `VALIDATION_ERROR` | 400 | Invalid sys_id, number format, or other input validation failure |
| `RATE_LIMITED` | 429 | Per-user rate limit exceeded |
| `SN_UNAVAILABLE` | 503 | ServiceNow returned 5xx |
| `UNEXPECTED_ERROR` | 500 | Unhandled exception (reference ID logged for debugging) |

## Error Flow

### ServiceNow API Errors

`ServiceNowClient` throws `ServiceNowApiError` (with `statusCode` and `responseBody`). The `handleToolError()` function maps these to `ToolError`:

```typescript
function mapServiceNowError(statusCode: number, responseBody?: unknown): ToolError {
  switch (statusCode) {
    case 401: return createToolError("AUTH_EXPIRED", "...");
    case 403: return createToolError("INSUFFICIENT_PERMISSIONS", "...");
    case 404: return createToolError("NOT_FOUND", "...");
    case 429: return createToolError("RATE_LIMITED", "...");
    default:
      if (statusCode >= 500) return createToolError("SN_UNAVAILABLE", "...");
      return createToolError("UNEXPECTED_ERROR", "...", responseBody);
  }
}
```

### Auth Errors

`AuthRequiredError` is caught by `wrapHandler` and normalized via `handleToolError()`, returning a structured error to the MCP client. The `requireBearerAuth` middleware rejects unauthenticated requests with 401 before tool handlers run.

### Unexpected Errors

Any unhandled exception gets a UUID `reference_id`. The full error is logged (with the reference ID) but only a generic message is returned to the client:

```json
{
  "success": false,
  "error": {
    "code": "UNEXPECTED_ERROR",
    "message": "An unexpected error occurred. Reference ID: abc-123-...",
    "reference_id": "abc-123-..."
  }
}
```

## wrapHandler Pattern

Every tool handler is wrapped by `wrapHandler` in `src/tools/registry.ts`:

```typescript
const wrapHandler = (handler) => async (args) => {
  try {
    const ctx = await getContext(extra);
    const result = await handler(ctx, args);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  } catch (err) {
    const errorResponse = handleToolError(err);
    return { content: [{ type: "text", text: JSON.stringify(errorResponse) }], isError: true };
  }
};
```

This ensures every tool call returns a well-formed MCP response, even on errors.

---

**See also**: [Request Flow](../architecture/request-flow.md) · [Rate Limiting](./rate-limiting.md) · [Troubleshooting](../troubleshooting/README.md)

[docs](../README.md) / security

# Security Overview

The server enforces multiple layers of security to ensure that every action runs as the authenticated user and that inputs are validated before reaching ServiceNow.

## Defense Layers

```
┌─────────────────────────────────────────┐
│  Per-user OAuth tokens (no shared svc)  │
├─────────────────────────────────────────┤
│  AES-256-GCM encrypted token storage    │
├─────────────────────────────────────────┤
│  Tool-level identity enforcement        │
├─────────────────────────────────────────┤
│  Input validation (sys_id, enums, etc.) │
├─────────────────────────────────────────┤
│  Payload sanitization (readonly fields) │
├─────────────────────────────────────────┤
│  Per-user rate limiting                 │
├─────────────────────────────────────────┤
│  Normalized error responses             │
├─────────────────────────────────────────┤
│  CSRF protection (OAuth state)          │
├─────────────────────────────────────────┤
│  Helmet + CORS middleware               │
└─────────────────────────────────────────┘
```

## Section Index

| Guide | Description |
|---|---|
| [Identity Enforcement](./identity-enforcement.md) | How tools lock `caller_id` and `requester` to the authenticated user |
| [Input Validation](./input-validation.md) | sys_id format, incident/change numbers, state values, payload sanitization |
| [Rate Limiting](./rate-limiting.md) | Token bucket algorithm, Redis Lua script, fail-open behavior |
| [Error Handling](./error-handling.md) | ErrorCode enum, error normalization, reference IDs |

## Key Guarantees

- **No identity spoofing**: Tools that create records forcefully set the caller/requester to the authenticated user's `sys_id`. The client cannot override this.
- **No field injection**: Update operations strip read-only/audit fields (`sys_id`, `sys_created_by`, `number`, `opened_at`, etc.) before sending to ServiceNow.
- **No ACL bypass**: Since every API call uses the user's own OAuth token, ServiceNow enforces that user's ACLs and roles.
- **Audit trail fidelity**: ServiceNow's native audit log correctly attributes actions to the actual user.

---

**See also**: [Auth Overview](../auth/README.md) · [Token Storage](../auth/token-storage.md) · [Architecture Overview](../architecture/README.md)

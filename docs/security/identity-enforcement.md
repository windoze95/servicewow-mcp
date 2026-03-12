[docs](../README.md) / [security](./README.md) / identity-enforcement

# Identity Enforcement

Tools that create or act on records enforce the authenticated user's identity server-side. The client cannot override who is recorded as the caller, requester, or approver.

## Protected Tools

| Tool | Enforced Field | Mechanism |
|---|---|---|
| `create_incident` | `caller_id` | Set to `ctx.userSysId` before POST |
| `create_change_request` | `requested_by` | Set to `ctx.userSysId` before POST |
| `submit_catalog_request` | Requester identity | Request submitted via user's own OAuth token; ServiceNow attributes it to the token owner |
| `approve_or_reject` | Approval ownership | Queries `sysapproval_approver` filtered by both `sys_id` and `approver=ctx.userSysId`; rejects if not owned |

## How It Works

### Create Operations

For `create_incident` and `create_change_request`, the server forcefully sets the identity field regardless of what the client provides:

```typescript
const body = {
  short_description: args.short_description,
  caller_id: ctx.userSysId,  // ← Always the authenticated user
};
```

Even if the client passes a different `caller_id` in their arguments, it's overwritten.

### Approval Verification

For `approve_or_reject`, the server performs a pre-flight check:

```typescript
const { data } = await ctx.snClient.get("/api/now/table/sysapproval_approver", {
  params: {
    sysparm_query: `sys_id=${args.sys_id}^approver=${ctx.userSysId}`,
    sysparm_limit: 1,
  },
});

if (!data.result.length) {
  return { error: "FORBIDDEN", message: "Approval not found or does not belong to the authenticated user" };
}
```

This prevents a user from approving/rejecting someone else's approval record.

### Update Operations

Update tools (`update_incident`, `update_change_request`, `update_catalog_item`, `update_catalog_variable`) don't enforce identity fields, but they do strip read-only and audit fields via `sanitizeUpdatePayload()`. See [Input Validation](./input-validation.md).

## Why This Matters

Without identity enforcement, an AI client could:

- Create incidents attributed to other users
- Submit catalog requests on behalf of others
- Approve changes they're not authorized to approve

The server prevents all of these by resolving identity from the OAuth token, not from client-supplied parameters.

---

**See also**: [Input Validation](./input-validation.md) · [OAuth Flow](../auth/oauth-flow.md) · [Request Flow](../architecture/request-flow.md)

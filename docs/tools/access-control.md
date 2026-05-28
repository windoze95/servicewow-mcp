[docs](../README.md) / [tools](./README.md) / access-control

# Access Control Tools (2)

Read-only tools for inspecting **access controls (ACLs)** — `sys_security_acl` plus the roles attached via `sys_security_acl_role`. Use these to answer "who can read/write this table or field, and under what condition?" — e.g. before restricting who can move an incident to Closed.

All access is per-user, so the caller's own ACLs govern whether the security tables are readable. `self_link` is built for every returned record.

## `search_acls`

Search `sys_security_acl`. Returns a paginated summary ordered by `name`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | The protected table or `table.field` (LIKE match), e.g. `incident.state` or `incident` |
| `operation` | string | No | `read`, `write`, `create`, or `delete` |
| `type` | string | No | ACL type, e.g. `record` or `field` |
| `active` | boolean | No | Active flag |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: ACL summaries (`sys_id`, `name`, `operation`, `type`, `active`, `admin_overrides`, `description`, `sys_updated_on`, `self_link`) plus pagination `metadata`.

## `get_acl`

Get one access control by `sys_id` with its full record — including the `condition` and `script` that gate access and the `admin_overrides` flag — plus the roles that satisfy it.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Access control `sys_id` (32 hex chars) |
| `role_limit` | number | No | Max `sys_security_acl_role` rows. 1-500, default 200 |

**Returns**: The full `sys_security_acl` record plus `self_link`, a `roles` array (each `sys_security_acl_role` row with `sys_user_role` as the role name and `self_link`), and `role_metadata` (`total_count`, `returned_count`, `truncated`).

> A user satisfying the roles still passes only if the ACL's `condition` and `script` also evaluate true (and `admin_overrides` lets the admin role bypass). Read those fields on the record to judge effective access.

---

**See also**: [Form Rules](./form-rules.md) · [Platform Metadata](./platform-metadata.md) · [Identity Enforcement](../security/identity-enforcement.md)

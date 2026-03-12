[docs](../README.md) / [tools](./README.md) / users-and-groups

# Users and Groups Tools (3)

Tools for looking up ServiceNow users and groups, and viewing the authenticated user's profile.

## `lookup_user`

Search for a ServiceNow user by name, email, or employee ID.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Search term: name, email, or employee ID |
| `limit` | number | No | Maximum results (1-50, default 10) |

**Search behavior**: Queries across `name` (LIKE), `email` (exact), `employee_number` (exact), and `user_name` (exact) using OR logic.

**Returns**: User records with `sys_id`, `user_name`, `name`, `first_name`, `last_name`, `email`, `phone`, `department`, `title`, `manager`, `active`, `employee_number`, `location`, and `self_link`.

## `lookup_group`

Search for a ServiceNow assignment group by name.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Group name to search for |
| `limit` | number | No | Maximum results (1-50, default 10) |

**Search behavior**: Name LIKE search, filtered to active groups only.

**Returns**: Group records with `sys_id`, `name`, `description`, `manager`, `email`, `active`, `type`, and `self_link`.

## `get_my_profile`

Get the authenticated user's own ServiceNow profile information. No parameters required.

**Returns**: The authenticated user's full profile including `sys_id`, `user_name`, `name`, `first_name`, `last_name`, `email`, `phone`, `department`, `title`, `manager`, `active`, `employee_number`, `location`, `photo`, and `self_link`.

Uses `ctx.userSysId` to query the user record directly — no search needed.

---

**See also**: [Incidents](./incidents.md) · [Tasks and Approvals](./tasks-and-approvals.md) · [Identity Enforcement](../security/identity-enforcement.md)

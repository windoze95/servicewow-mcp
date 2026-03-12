[docs](../README.md) / [tools](./README.md) / tasks-and-approvals

# Tasks and Approvals Tools (3)

Tools for viewing assigned tasks and managing approvals.

## `get_my_tasks`

Get all open tasks assigned to the authenticated user across all task types (incidents, requests, changes, etc.).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | number | No | Maximum results (1-100, default 20) |
| `offset` | number | No | Result offset for pagination (default 0) |

**Query**: Filters by `assigned_to=<user>` and `active=true`, ordered by most recently updated.

**Returns**: Task records with `sys_id`, `number`, `short_description`, `state`, `priority`, `assigned_to`, `assignment_group`, `sys_class_name`, `opened_at`, `due_date`, `sys_updated_on`, and `self_link`. The `self_link` uses the actual `sys_class_name` (e.g., `incident`, `change_request`) for correct URL routing.

## `get_my_approvals`

Get pending approvals for the authenticated user.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | number | No | Maximum results (1-100, default 20) |

**Query**: Filters by `approver=<user>` and `state=requested`, ordered by creation date.

**Returns**: Approval records with `sys_id`, `state`, `approver`, `sysapproval`, `source_table`, `comments`, `due_date`, `sys_created_on`, and `self_link`.

## `approve_or_reject`

Approve or reject a pending approval with optional comments.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Approval record sys_id |
| `action` | string | Yes | `approved` or `rejected` |
| `comments` | string | No | Comments for the approval decision |

**Identity enforcement**: Before updating the approval, the server verifies the approval record belongs to the authenticated user by querying `sysapproval_approver` with both `sys_id` and `approver=<user>`. If the record isn't found or belongs to another user, returns `FORBIDDEN`. See [Identity Enforcement](../security/identity-enforcement.md).

---

**See also**: [Change Requests](./change-requests.md) · [Incidents](./incidents.md) · [Identity Enforcement](../security/identity-enforcement.md)

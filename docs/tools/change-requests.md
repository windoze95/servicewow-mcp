[docs](../README.md) / [tools](./README.md) / change-requests

# Change Request Tools (6)

Tools for managing change requests in ServiceNow.

## `search_change_requests`

Search for change requests with various filters. Returns a paginated summary list.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | No | Free-text search in short description |
| `state` | string | No | Filter by state (e.g., `New`, `Assess`, `Implement`, `Review`, `Closed`) |
| `type` | string | No | Filter by type (`Normal`, `Standard`, `Emergency`) |
| `priority` | string | No | Filter by priority (`1`-`5`) |
| `risk` | string | No | Filter by risk level (e.g., `High`, `Moderate`, `Low` or numeric) |
| `category` | string | No | Filter by category (e.g., `Hardware`, `Software`, `Network`) |
| `cmdb_ci` | string | No | Filter by configuration item (matches CI name or sys_id) |
| `assigned_to_me` | boolean | No | Only show change requests assigned to the authenticated user |
| `assignment_group` | string | No | Filter by assignment group name |
| `start_date_from` | string | No | Planned start date lower bound (`YYYY-MM-DD` or ISO 8601, inclusive) |
| `start_date_to` | string | No | Planned start date upper bound (date-only is treated as end-of-day UTC) |
| `end_date_from` | string | No | Planned end date lower bound |
| `end_date_to` | string | No | Planned end date upper bound (date-only is treated as end-of-day UTC) |
| `opened_at_from` | string | No | Opened-at lower bound |
| `opened_at_to` | string | No | Opened-at upper bound (date-only is treated as end-of-day UTC) |
| `order_by` | enum | No | One of `sys_updated_on_desc` (default), `sys_updated_on_asc`, `start_date_desc`, `start_date_asc`, `end_date_desc`, `end_date_asc`, `opened_at_desc`, `opened_at_asc`, `priority_asc`, `priority_desc` |
| `limit` | number | No | Maximum results (1-100, default 10) |
| `offset` | number | No | Result offset for pagination (default 0) |

**Date inputs**: Accept `YYYY-MM-DD` (date only) or ISO 8601 with an explicit timezone (`2026-04-01T08:30:00Z` or `2026-04-01T08:30:00+05:00`). ISO 8601 inputs without a timezone are rejected so query bounds are independent of the host timezone. Date-only `_from` values pin to `00:00:00` and `_to` values pin to `23:59:59` so the upper-bound day is fully inclusive. ISO 8601 with an offset is normalized to UTC. Malformed or calendar-overflow input (`2026-04-31`, `2025-02-29`) returns `VALIDATION_ERROR`.

**Returns**: Array of change request summaries with `sys_id`, `number`, `short_description`, `state`, `type`, `priority`, `risk`, `assigned_to`, `assignment_group`, `requested_by`, `category`, `cmdb_ci`, `start_date`, `end_date`, `opened_at`, `sys_updated_on`, and `self_link`.

## `get_change_request`

Get full details of a specific change request.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `identifier` | string | Yes | Change number (`CHG0012345`) or sys_id |

**Validation**: Must be a valid change number (`CHG` + 7+ digits) or 32-char hex sys_id.

## `create_change_request`

Create a new change request. The `requested_by` field is automatically set to the authenticated user.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `short_description` | string | Yes | Brief summary of the change |
| `description` | string | No | Detailed description |
| `type` | string | No | Change type (`Normal`, `Standard`, `Emergency`) |
| `impact` | number | No | 1=High, 2=Medium, 3=Low |
| `urgency` | number | No | 1=High, 2=Medium, 3=Low |
| `category` | string | No | Change category |
| `assignment_group` | string | No | Assignment group name or sys_id |
| `cmdb_ci` | string | No | Configuration item name or sys_id |
| `start_date` | string | No | Planned start date (ISO 8601) |
| `end_date` | string | No | Planned end date (ISO 8601) |

**Identity enforcement**: `requested_by` is always set to `ctx.userSysId`. See [Identity Enforcement](../security/identity-enforcement.md).

## `update_change_request`

Update fields on an existing change request.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `identifier` | string | Yes | Change number or sys_id |
| `fields` | object | Yes | Fields to update (e.g., `{ "state": "Implement" }`) |

**Payload sanitization**: Read-only fields are stripped. See [Input Validation](../security/input-validation.md).

## `get_change_request_approvals`

Get approval records linked to a change request.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `identifier` | string | Yes | Change number or sys_id |
| `offset` | number | No | Starting offset for continuation (default 0) |

Auto-paginates up to 500 records (5 pages x 100). When the response metadata includes `truncated: true`, use `offset + returned_count` as the next `offset` to continue.

**Returns**: Approval records with `sys_id`, `state`, `approver`, `sysapproval`, `source_table`, `comments`, `due_date`.

## `add_change_request_work_note`

Add a work note (internal) or comment (customer-visible) to a change request.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `identifier` | string | Yes | Change number or sys_id |
| `note` | string | Yes | The note text |
| `type` | string | No | `work_note` (default, internal) or `comment` (customer-visible) |

---

**See also**: [Incidents](./incidents.md) · [Tasks and Approvals](./tasks-and-approvals.md) · [Identity Enforcement](../security/identity-enforcement.md)

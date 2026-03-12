[docs](../README.md) / [tools](./README.md) / incidents

# Incident Tools (5)

Tools for searching, viewing, creating, updating, and annotating incidents.

## `search_incidents`

Search for incidents with various filters. Returns a paginated summary list.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | string | No | Free-text search in short description |
| `state` | string | No | Filter by state (e.g., `New`, `In Progress`, `Resolved`) |
| `priority` | string | No | Filter by priority (`1`-`5`) |
| `assigned_to_me` | boolean | No | Only show incidents assigned to the authenticated user |
| `assignment_group` | string | No | Filter by assignment group name |
| `limit` | number | No | Maximum results (1-100, default 10) |
| `offset` | number | No | Result offset for pagination (default 0) |

**Returns**: Array of incident summaries with `sys_id`, `number`, `short_description`, `state`, `priority`, `impact`, `urgency`, `assigned_to`, `assignment_group`, `caller_id`, `category`, `opened_at`, `sys_updated_on`, and `self_link`.

## `get_incident`

Get full details of a specific incident.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `identifier` | string | Yes | Incident number (`INC0012345`) or sys_id |

**Validation**: Must be a valid incident number (`INC` + 7+ digits) or 32-char hex sys_id.

## `create_incident`

Create a new incident. The `caller_id` is automatically set to the authenticated user.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `short_description` | string | Yes | Brief summary |
| `description` | string | No | Detailed description |
| `impact` | number | No | 1=High, 2=Medium, 3=Low |
| `urgency` | number | No | 1=High, 2=Medium, 3=Low |
| `category` | string | No | Incident category |
| `subcategory` | string | No | Incident subcategory |
| `assignment_group` | string | No | Assignment group name or sys_id |
| `cmdb_ci` | string | No | Configuration item name or sys_id |

**Identity enforcement**: `caller_id` is always set to `ctx.userSysId`. See [Identity Enforcement](../security/identity-enforcement.md).

**Priority**: Calculated automatically by ServiceNow from impact and urgency via its native priority lookup rules.

## `update_incident`

Update fields on an existing incident.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `identifier` | string | Yes | Incident number or sys_id |
| `fields` | object | Yes | Fields to update (e.g., `{ "state": "In Progress" }`) |

**Payload sanitization**: Read-only fields (`sys_id`, `number`, `opened_at`, `sys_created_by`, etc.) are stripped before sending to ServiceNow. See [Input Validation](../security/input-validation.md).

## `add_work_note`

Add a work note (internal) or comment (customer-visible) to an incident.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `identifier` | string | Yes | Incident number or sys_id |
| `note` | string | Yes | The note text |
| `type` | string | No | `work_note` (default, internal) or `comment` (customer-visible) |

---

**See also**: [Change Requests](./change-requests.md) · [Tasks and Approvals](./tasks-and-approvals.md) · [Identity Enforcement](../security/identity-enforcement.md)

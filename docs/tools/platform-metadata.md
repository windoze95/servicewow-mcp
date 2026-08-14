[docs](../README.md) / [tools](./README.md) / platform-metadata

# Platform Metadata Tools (11)

Read-only tools for inspecting **platform configuration** — the business rules, list views, navigator modules, flow definitions, and notifications that drive record and UI behaviour. These answer questions like "what sets this field?" and "what filters this list?" without UI access.

- `sys_script` — business rules (server-side automation)
- `sys_ui_list` / `sys_ui_list_element` — list view column layouts and their columns
- `sys_app_module` — application navigator modules (where a list's row **filter** lives)
- `sys_hub_flow` plus `sys_hub_trigger_instance` / `sys_hub_action_instance` — Flow Designer flow definitions and their triggers/steps
- `sysevent_email_action` — email/notification definitions (what an event sends, and to whom)
- `wf_workflow` / `wf_workflow_version` / `wf_activity` / `wf_transition` — classic Workflow definitions and their activity graphs

All access goes through the per-user ServiceNow client, so the caller's ACLs govern whether these configuration tables are readable. `self_link` is built for every returned record.

> **List filters vs. list columns**: `sys_ui_list` only stores which **columns** a list shows. The **row filter** that scopes a named list (e.g. "Major Incidents") is the encoded query in `sys_app_module.filter` — use `search_navigator_modules` for that.

## `search_business_rules`

Search the `sys_script` table. Returns a paginated summary ordered by most recently updated (`ORDERBYDESCsys_updated_on`).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `table` | string | No | Table the rule runs on (the `collection` field), e.g. `incident`, `cmdb_ci_outage` |
| `name` | string | No | Business rule name LIKE filter |
| `when` | string | No | Execution phase: `before`, `after`, `async`, or `display` |
| `active` | boolean | No | Active flag |
| `script_contains` | string | No | Substring LIKE match against the `script` body (e.g. a field name) |
| `condition_contains` | string | No | Substring LIKE match against the `condition` OR `filter_condition` — the fields that gate when a rule runs |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: Rule summaries (`sys_id`, `name`, `collection`, `when`, `order`, `active`, `action_insert/update/delete/query`, `advanced`, `sys_updated_on`, `self_link`) plus pagination `metadata`.

> `script_contains` matches the `script` body; `condition_contains` matches the `condition` OR `filter_condition`. They are independent filters — `condition_contains` is emitted as a trailing `conditionLIKEv^ORfilter_conditionLIKEv` group so the leading filters stay ANDed. Use `get_business_rule` to read the full bodies of any match.

## `get_business_rule`

Get one business rule by `sys_id`, fetched without a `sysparm_fields` restriction so the full `script`, `condition`, and `filter_condition` are returned.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Business rule `sys_id` (32 hex chars) |

**Returns**: The full `sys_script` record plus `self_link`.

## `get_list_view`

Read list view column layouts (`sys_ui_list`) and their ordered columns (`sys_ui_list_element`, joined via `list_id`). Provide a `sys_id` for one layout, or a `table` to return the base layout(s) for that table.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | No | A specific `sys_ui_list` `sys_id` (32 hex chars). Takes precedence over `table` |
| `table` | string | No | Return layouts defined for this table (the `name` field), e.g. `incident` |
| `include_personal` | boolean | No | When querying by `table`, also include per-user personal layouts (`sys_user` set). Default `false` returns only shared/base layouts (`sys_userISEMPTY`) |
| `include_columns` | boolean | No | Fetch the ordered column list per layout (default `true`) |
| `column_limit` | number | No | Max columns per layout. 1-500, default 200 |
| `limit` | number | No | Max layouts when querying by `table`. 1-100, default 20 |

**Returns**: An array of layouts, each with the `sys_ui_list` fields, `self_link`, and (when `include_columns`) a `columns` array (`sys_id`, `element`, `position`, `self_link`) in display order plus `column_metadata` (`total_count`, `returned_count`, `truncated`). Provide either `sys_id` or `table` — omitting both is a validation error.

## `search_navigator_modules`

Search application navigator modules (`sys_app_module`) — the left-nav menu items. For a "List of Records" module the `filter` field holds the encoded query that scopes the list, the target table is in `name`, and the label is in `title`. Returns a paginated summary ordered by `title`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | string | No | Module display label LIKE filter, e.g. `Major Incident` |
| `table` | string | No | Target table (the `name` field on `sys_app_module`), e.g. `incident` |
| `active` | boolean | No | Active flag |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: Module summaries (`sys_id`, `title`, `name`, `filter`, `query`, `view`, `application`, `link_type`, `active`, `order`, `roles`, `sys_updated_on`, `self_link`) plus pagination `metadata`.

## `search_flow_definitions`

Search Flow Designer flow/subflow definitions (`sys_hub_flow`) by name, active flag, and type. This is the flow **design**; for execution history use [`search_flow_executions`](./flow-logs.md). Returns a paginated summary ordered by most recently updated.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | Flow/subflow name LIKE filter, e.g. `Outage created from MIM` |
| `active` | boolean | No | Active flag |
| `type` | string | No | `flow` or `subflow` |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: Flow summaries (`sys_id`, `name`, `description`, `active`, `type`, `run_as`, `status`, `sys_scope`, `sys_updated_on`, `self_link`) plus pagination `metadata`.

## `get_flow_definition`

Get a flow definition (`sys_hub_flow`) by `sys_id`, with its trigger instance(s) and ordered action steps. The header is fetched without a `sysparm_fields` restriction; trigger and action instances are returned with all columns so their table/condition (triggers) and action type/label/order (actions) surface.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Flow definition `sys_id` (`sys_hub_flow`, 32 hex chars) |
| `include_components` | boolean | No | Include trigger instances and ordered action steps (default `true`; set `false` for the header only) |
| `component_limit` | number | No | Max trigger/action rows per type. 1-500, default 200 |

**Returns**: The full flow header plus `self_link`. When `include_components` is true: a `triggers` array, an `actions` array (each row with `self_link`), and `component_metadata` reporting, per type, the source `table`, `total_count`, `returned_count`, and `truncated`.

> **What is and isn't returned**: the trigger's table/condition and the ordered list of steps (with their action type and label) are returned. The per-step input **values** — the literal field assignments, e.g. setting a field to `true` — are stored separately in `sys_variable_value` (keyed by `document` / `document_key`) and are **not** expanded here — use the `get_flow_action_inputs` tool (below) on a specific action instance to read them.
>
> **Flow Engine V2**: components are read from the base `sys_hub_trigger_instance` / `sys_hub_action_instance` tables, falling back to the `*_v2` tables (Washington DC and later). `component_metadata[type].table` reports which table the rows came from. If both are empty for a flow you expect to have steps, check the caller's read access to those tables.

## `get_flow_action_inputs`

Expand the configured **input values** of one Flow Designer action instance (`sys_hub_action_instance`) by `sys_id` — the actual field assignments a "Create Record" / "Update Record" step makes, not just that it is a Create Record. Use after `get_flow_definition` (which lists the action instances) to prove which fields a step writes.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Action instance `sys_id` (`sys_hub_action_instance`, 32 hex chars) |
| `limit` | number | No | Max `sys_variable_value` input rows. 1-500, default 200 |

**Returns**: `data` with:
- `input_values` — `sys_variable_value` rows keyed by `document_key` = the action instance (each with `variable`, `value`, and `self_link`), plus `metadata.input_values` (`total_count`, `returned_count`, `truncated`). This is where pre-Washington flows store the field assignments.
- `action_instance` — the action instance record itself (fetched from the base table, falling back to `sys_hub_action_instance_v2`), so its `values` field is surfaced on **Flow Engine V2** flows where the inputs live there instead. `null` if the sys_id isn't an action instance in either table; `metadata.action_instance_found` / `action_instance_table` report which.

> Reads **both** storage models so it works regardless of release. The V2 `values` field can be an encoded blob; the `sys_variable_value` rows are the human-readable form. Only a genuine missing-table / missing-record (400/404) is tolerated when probing base vs. v2 — ACL, rate-limit, and server errors surface normally.

## `search_notifications`

Search email/notification definitions (`sysevent_email_action`) — the records under **System Notification → Email → Notifications**. Use to find what an event sends (e.g. all `rota.on_call.*` reminders/escalations) or every notification on a table.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | Notification name LIKE filter |
| `event_name` | string | No | Firing event LIKE filter, e.g. `rota.on_call` |
| `table` | string | No | The table the notification is about (`collection`), e.g. `cmn_rota`, `incident` |
| `active` | boolean | No | Filter by active flag |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: Summaries with `sys_id`, `name`, `event_name`, `collection`, `active`, `type`, `subject`, `weight`, `sys_updated_on`, and `self_link`, ordered by most recently updated.

## `get_notification`

Get one notification definition by `sys_id` with every field: recipient configuration, gating condition and advanced-condition script, subject/message body or template reference, weight and digest settings.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Notification `sys_id` (32 hex chars) |

**Returns**: The full `sysevent_email_action` record as `{value, display_value}` pairs (so recipient lists carry sys_ids as well as names), plus `self_link`.

## `search_workflows`

Search classic Workflow definitions (`wf_workflow`) — the pre-Flow-Designer engine. Classic workflows do **not** appear in `search_flow_definitions` (which covers `sys_hub_flow` only); use this for anything visible in Workflow Editor, e.g. on-call assign-by-acknowledgement paging workflows.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | Workflow name LIKE filter |
| `table` | string | No | The table the workflow runs on |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: Summaries with `sys_id`, `name`, `table`, `description`, `access`, `template`, `sys_updated_on`, and `self_link`, ordered by most recently updated.

## `get_workflow`

Get one classic Workflow by `sys_id` with its design expanded: header, versions (published first), and — for the published (or most recent) version — the activity nodes (`wf_activity`) and transition edges (`wf_transition`, `from` → `to` with condition) so the flow graph can be reconstructed. Per-activity input variable values are not expanded (they live in `vars`/`input` blobs). Responses use `{value, display_value}` pairs.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Workflow `sys_id` (`wf_workflow`, 32 hex chars) |
| `activity_limit` | number | No | 1-500, default 200 — max activity and transition rows each |

**Returns**: `{ workflow, versions, activities, transitions, metadata }` — `metadata.expanded_version` names the version whose graph was expanded.

---

**See also**: [Flow Logs](./flow-logs.md) · [Form Rules](./form-rules.md) · [Access Control](./access-control.md) · [On-Call](./on-call.md) · [Input Validation](../security/input-validation.md)

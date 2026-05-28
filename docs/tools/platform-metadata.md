[docs](../README.md) / [tools](./README.md) / platform-metadata

# Platform Metadata Tools (6)

Read-only tools for inspecting **platform configuration** — the business rules, list views, navigator modules, and flow definitions that drive record and UI behaviour. These answer questions like "what sets this field?" and "what filters this list?" without UI access.

- `sys_script` — business rules (server-side automation)
- `sys_ui_list` / `sys_ui_list_element` — list view column layouts and their columns
- `sys_app_module` — application navigator modules (where a list's row **filter** lives)
- `sys_hub_flow` plus `sys_hub_trigger_instance` / `sys_hub_action_instance` — Flow Designer flow definitions and their triggers/steps

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
| `script_contains` | string | No | Substring LIKE match against the `script` body (e.g. a field name). Matches the `script` field only — see note below |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: Rule summaries (`sys_id`, `name`, `collection`, `when`, `order`, `active`, `action_insert/update/delete/query`, `advanced`, `sys_updated_on`, `self_link`) plus pagination `metadata`.

> `script_contains` matches the `script` body only. Logic placed in the `condition` or `filter_condition` fields is **not** searched (the encoded-query escaping rules out a safe multi-field OR). If a script match comes up empty, list a table's rules (`table=...`) and read candidates with `get_business_rule`.

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

> **What is and isn't returned**: the trigger's table/condition and the ordered list of steps (with their action type and label) are returned. The per-step input **values** — the literal field assignments, e.g. setting a field to `true` — are stored separately in `sys_variable_value` (keyed by `document` / `document_key`) and are **not** expanded here; open the flow in Flow Designer or inspect those records for literal field writes.
>
> **Flow Engine V2**: components are read from the base `sys_hub_trigger_instance` / `sys_hub_action_instance` tables, falling back to the `*_v2` tables (Washington DC and later). `component_metadata[type].table` reports which table the rows came from. If both are empty for a flow you expect to have steps, check the caller's read access to those tables.

---

**See also**: [Flow Logs](./flow-logs.md) · [Scheduled Jobs](./scheduled-jobs.md) · [Input Validation](../security/input-validation.md)

[docs](../README.md) / [tools](./README.md) / form-rules

# Form Rules Tools (6)

Read-only tools for inspecting the **field-behavior rules** that govern a form — what makes a field mandatory, read-only, hidden, or sets its value. Together with [business rules](./platform-metadata.md) and [flow definitions](./platform-metadata.md) these answer "what writes or gates this field?".

- `sys_ui_policy` / `sys_ui_policy_action` — client-side mandatory / visible / read-only / clear rules
- `sys_script_client` — onLoad / onChange / onSubmit / onCellEdit browser logic
- `sys_data_policy2` / `sys_data_policy_rule` — server-side (and optional UI) mandatory / read-only enforcement

All access is per-user, so the caller's ACLs govern visibility. `self_link` is built for every returned record.

> These cover **form/data field behavior**. The encoded *row filter* of a list lives on the navigator module — see [`search_navigator_modules`](./platform-metadata.md). Server-side write logic lives in business rules and flows — see [Platform Metadata](./platform-metadata.md).

## `search_ui_policies`

Search `sys_ui_policy`. Returns a paginated summary ordered by most recently updated.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `table` | string | No | Table the policy applies to, e.g. `incident` |
| `short_description` | string | No | Policy description LIKE filter |
| `active` | boolean | No | Active flag |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: Policy summaries (`sys_id`, `short_description`, `table`, `active`, `on_load`, `reverse_if_false`, `global`, `ui_type`, `order`, `sys_updated_on`, `self_link`) plus pagination `metadata`.

## `get_ui_policy`

Get one UI policy by `sys_id` with its full record (including `conditions` and the `script_true` / `script_false` bodies) and its per-field actions from `sys_ui_policy_action`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | UI policy `sys_id` (32 hex chars) |
| `action_limit` | number | No | Max `sys_ui_policy_action` rows. 1-500, default 200 |

**Returns**: The full policy record plus `self_link`, an `actions` array (each `sys_ui_policy_action` row with all columns — `field`, `mandatory`, `visible`, `disabled` (read-only), `cleared` — plus `self_link`), and `action_metadata` (`total_count`, `returned_count`, `truncated`).

## `search_client_scripts`

Search `sys_script_client`. Returns a paginated summary ordered by most recently updated.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `table` | string | No | Table the script runs on, e.g. `incident` |
| `name` | string | No | Script name LIKE filter |
| `type` | string | No | `onLoad`, `onChange`, `onSubmit`, or `onCellEdit` |
| `active` | boolean | No | Active flag |
| `script_contains` | string | No | Substring LIKE match against the `script` body |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: Script summaries (`sys_id`, `name`, `table`, `type`, `field`, `active`, `ui_type`, `global`, `applies_extended`, `order`, `sys_updated_on`, `self_link`) plus pagination `metadata`.

## `get_client_script`

Get one client script by `sys_id`, including the full `script` body and its `table` / `type` / `field`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Client script `sys_id` (32 hex chars) |

**Returns**: The full `sys_script_client` record plus `self_link`.

## `search_data_policies`

Search `sys_data_policy2` (the `2` is the real table name). Returns a paginated summary ordered by most recently updated.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `table` | string | No | Table the policy applies to — matched against the `model_table` column, e.g. `incident` |
| `short_description` | string | No | Policy description LIKE filter |
| `active` | boolean | No | Active flag |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: Policy summaries (`sys_id`, `short_description`, `model_table`, `active`, `enforce_ui`, `reverse_if_false`, `apply_import_set`, `sys_updated_on`, `self_link`) plus pagination `metadata`.

## `get_data_policy`

Get one data policy by `sys_id` with its full record (including `conditions`) and its per-field rules from `sys_data_policy_rule` (joined via the `sys_data_policy` reference).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Data policy `sys_id` (32 hex chars) |
| `rule_limit` | number | No | Max `sys_data_policy_rule` rows. 1-500, default 200 |

**Returns**: The full policy record plus `self_link`, a `rules` array (each `sys_data_policy_rule` row with all columns — `field`, `mandatory`, `disabled` (read-only) — plus `self_link`), and `rule_metadata` (`total_count`, `returned_count`, `truncated`).

---

**See also**: [Platform Metadata](./platform-metadata.md) · [Access Control](./access-control.md) · [Input Validation](../security/input-validation.md)

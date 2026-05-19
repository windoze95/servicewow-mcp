[docs](../README.md) / [tools](./README.md) / cmdb

# CMDB Tools (6)

Read-only tools for assessing the **Configuration Management Database** — its shape, data quality, dependency coverage, and which CIs are actually in use. Aimed at CMDB health checks and migration triage.

- `cmdb_ci` — the parent CI table; every class (`cmdb_ci_server`, `cmdb_ci_db_instance`, `cmdb_ci_appl`, …) extends it, so querying the parent surfaces every CI in one call. `sys_class_name` identifies the concrete subclass.
- `cmdb_rel_ci` — directed `parent` → `child` relationships used by dependency mapping.

Reference fields (`owned_by`, `managed_by`, `location`, `support_group`, `assignment_group`) are returned as readable display values. `self_link` points at the CI's concrete subclass form when `sys_class_name` is known, falling back to `cmdb_ci` (which also resolves to the record's real class form).

## `search_cis`

The workhorse. Search `cmdb_ci` and every subclass with filters, ordered by most recently updated (`ORDERBYDESCsys_updated_on`).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | CI name LIKE filter |
| `sys_class_name` | string | No | Exact CI class/table, e.g. `cmdb_ci_server`, `cmdb_ci_db_instance`, `cmdb_ci_appl` |
| `discovery_source` | string | No | `discovery_source` value, e.g. `ServiceNow`, `SCCM`, `JDBC` |
| `install_status` | string | No | `install_status` value (numeric value, not label), e.g. `1` (Installed), `7` (Retired) |
| `last_discovered_after` | string | No | Only CIs last discovered on/after this date. `YYYY-MM-DD` or ISO 8601 (with timezone) |
| `last_discovered_before` | string | No | Only CIs last discovered on/before this date. `YYYY-MM-DD` or ISO 8601 (with timezone) |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: CI summaries (`sys_id`, `name`, `sys_class_name`, `install_status`, `operational_status`, `discovery_source`, `last_discovered`, `ip_address`, `fqdn`, `serial_number`, `asset_tag`, `owned_by`, `managed_by`, `support_group`, `assignment_group`, `location`, `company`, `sys_updated_on`) with `self_link`, plus pagination `metadata`.

## `get_ci`

Get the full record for one CI by `sys_id`. Fetched from the `cmdb_ci` parent without a `sysparm_fields` restriction so all columns on the CI's concrete subclass are returned.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Configuration item `sys_id` (32 hex chars) |

**Validation**: invalid `sys_id` returns `VALIDATION_ERROR` without an API call. An unknown but well-formed `sys_id` surfaces the ServiceNow 404 through the standard error envelope.

**Returns**: the full CI record plus `self_link`.

## `get_ci_relationships`

Read `cmdb_rel_ci` for a CI in both directions. `parent_of` holds rows where the CI is the parent (it is the parent **of** each row's child); `child_of` holds rows where the CI is the child (it is a child **of** each row's parent). Critical for judging whether dependency mapping has any data.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Configuration item `sys_id` (32 hex chars) |
| `limit` | number | No | Max relationship rows per direction. 1-1000, default 200 |

**Returns**: `ci_sys_id`, `parent_of` and `child_of` arrays (`sys_id`, `parent`, `child`, `type`, `sys_updated_on`, `self_link` per row), and per-direction `metadata` (`total_count`, `returned_count`, `truncated`) so the caller can tell when a direction was capped by `limit`.

## `count_cis_by_class`

Aggregate the entire CMDB by class via the ServiceNow Aggregate API (`/api/now/stats/cmdb_ci` grouped by `sys_class_name` with counts). One call returns the shape of the whole CMDB. Takes no parameters.

**Returns**: `classes` — `{ sys_class_name, label, count }` sorted by `count` descending (classes with an empty name are dropped) — and `metadata` with `class_count` and `total_cis`.

## `find_stale_cis`

Find migration-skip candidates by **one** staleness signal per call (run once per `reason`), ordered by most recently updated.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `reason` | enum | Yes | `not_recently_discovered`, `retired_but_operational`, or `missing_assignment_group` |
| `stale_after_days` | number | No | For `not_recently_discovered`: flag CIs whose `last_discovered` is older than this many days. 1-3650, default 90 |
| `sys_class_name` | string | No | Optionally scope to a single CI class/table |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

Reason semantics:

- `not_recently_discovered` → `last_discovered` earlier than `now − stale_after_days` (UTC cutoff).
- `retired_but_operational` → `install_status=7` (Retired) **and** `operational_status=1` (Operational) — a data-quality contradiction.
- `missing_assignment_group` → `assignment_group` is empty.

**Returns**: matching CI summaries with `self_link`, plus `metadata` echoing `reason` (and `stale_after_days` for `not_recently_discovered`) alongside pagination fields.

## `get_ci_ticket_references`

Count `incident`, `change_request`, and `problem` records that reference the CI via their `cmdb_ci` field, with a small sample of the most recent of each. Answers "is this CI actually used?".

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Configuration item `sys_id` (32 hex chars) |
| `sample_limit` | number | No | Most-recent sample records per ticket type. 0-20, default 5 (`0` = counts only) |

Counts come from the `X-Total-Count` header, so they are accurate regardless of `sample_limit`.

**Returns**: `ci` (identity record plus `self_link`), `references` keyed by `incidents` / `changes` / `problems` (`count`, `returned`, `sample[]` with per-record `self_link`), and `metadata.total_references`.

---

**See also**: [Flow Logs](./flow-logs.md) · [Scheduled Jobs](./scheduled-jobs.md) · [Input Validation](../security/input-validation.md)

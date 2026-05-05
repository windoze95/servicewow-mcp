[docs](../README.md) / [tools](./README.md) / scheduled-jobs

# Scheduled Jobs Tools (2)

Read-only tools for inspecting Scheduled Script Executions (`sysauto_script`) — useful for tracing background automations such as monthly incident generators.

## `search_scheduled_jobs`

Search Scheduled Script Executions with filters. Returns a paginated summary list (script body excluded).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | Job name LIKE filter |
| `script_contains` | string | No | Match jobs whose script body contains this substring (LIKE) |
| `run_as` | string | No | Run-as user `sys_id` (32 hex chars) |
| `active` | boolean | No | Filter by active flag |
| `run_type` | string | No | e.g. `periodically`, `monthly`, `weekly`, `daily`, `on_demand` |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: Job summaries with `sys_id`, `name`, `active`, `run_type`, `run_period`, `run_dayofmonth`, `run_dayofweek`, `run_time`, `run_start`, `run_as`, `conditional`, `sys_class_name`, `sys_updated_on`, and `self_link`.

## `get_scheduled_job`

Get full details of a Scheduled Script Execution by `sys_id`, including the `script` body and `condition`.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Scheduled job `sys_id` (32 hex chars) |

**Returns**: The full job record plus `self_link`.

---

**See also**: [Update Sets](./update-sets.md) · [Input Validation](../security/input-validation.md)

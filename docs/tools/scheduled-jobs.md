[docs](../README.md) / [tools](./README.md) / scheduled-jobs

# Scheduled Jobs Tools (2)

Read-only tools for inspecting Scheduled Jobs — the parent `sysauto` table and every subclass that appears in the **System Definition → Scheduled Jobs** list:

- `sysauto_script` — Scheduled Script Executions
- `sysauto_template` — Scheduled Record Generators (e.g. monthly incident creators driven by a `sys_template`)
- `sysauto_report` — Scheduled report deliveries
- `sysauto_import` — Scheduled data imports
- ...and any other subclass of `sysauto`

`self_link` is built from the record's `sys_class_name`, so each link opens the correct subclass form.

## `search_scheduled_jobs`

Search the parent `sysauto` table (covers all subclasses). Returns a paginated summary list.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `name` | string | No | Job name LIKE filter |
| `script_contains` | string | No | Match Scheduled Script Executions whose script body contains this substring (LIKE). Automatically scopes the search to `sys_class_name=sysauto_script` because the `script` column only exists on that subclass; passing a different `sys_class_name` together with `script_contains` is rejected. |
| `run_as` | string | No | Run-as user `sys_id` (32 hex chars) |
| `active` | boolean | No | Filter by active flag |
| `run_type` | string | No | e.g. `periodically`, `monthly`, `weekly`, `daily`, `on_demand` |
| `sys_class_name` | string | No | Restrict to a subclass, e.g. `sysauto_script`, `sysauto_template`, `sysauto_report`, `sysauto_import` |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: Job summaries with `sys_id`, `name`, `active`, `run_type`, `run_period`, `run_dayofmonth`, `run_dayofweek`, `run_time`, `run_start`, `run_as`, `conditional`, `sys_class_name`, `sys_updated_on`, and `self_link`.

## `get_scheduled_job`

Get full details of any Scheduled Job by `sys_id`. The record is fetched via the `sysauto` parent table without a `sysparm_fields` restriction, so all columns defined on the record's actual subclass are returned (e.g. `script`/`condition` for `sysauto_script`, `template`/`table` for `sysauto_template`).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Scheduled job `sys_id` (32 hex chars) |

**Returns**: The full job record plus `self_link` (built from `sys_class_name`).

---

**See also**: [Update Sets](./update-sets.md) · [Input Validation](../security/input-validation.md)

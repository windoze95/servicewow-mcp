[docs](../README.md) / [tools](./README.md) / flow-logs

# Flow Logs Tools (2)

Read-only tools for inspecting **Flow Designer execution history**:

- `sys_flow_context` — one record per flow, subflow, or action run (name, state, timing, trigger record)
- `sys_flow_log` — the step-by-step engine log entries for a run, joined back via `sys_flow_log.context = sys_flow_context.sys_id`

Typical workflow: find the run with `search_flow_executions` (often filtered to `errors_only`), then drill into it with `get_flow_execution` to read the step log and diagnose the failure.

`self_link` is built for the `sys_flow_context` record and for each `sys_flow_log` entry.

## `search_flow_executions`

Search the `sys_flow_context` table. Returns a paginated summary list ordered by most recently started (`ORDERBYDESCstarted`).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `flow_name` | string | No | Flow/subflow/action name LIKE filter |
| `state` | string | No | Execution state token, e.g. `COMPLETE`, `ERROR`, `IN_PROGRESS`, `WAITING`, `CANCELLED` |
| `errors_only` | boolean | No | Convenience filter for failed runs (`state=ERROR`). Rejected if combined with an explicit `state`. |
| `flow` | string | No | Flow definition `sys_id` (`sys_hub_flow`, 32 hex chars) |
| `source_table` | string | No | Table of the triggering record |
| `source_record` | string | No | `sys_id` of the triggering record (32 hex chars) |
| `started_by` | string | No | `sys_id` of the user who triggered the run (32 hex chars) |
| `started_after` | string | No | Only runs started on/after this date. `YYYY-MM-DD` or ISO 8601 (with timezone) |
| `started_before` | string | No | Only runs started on/before this date. `YYYY-MM-DD` or ISO 8601 (with timezone) |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: Run summaries with `sys_id`, `name`, `state`, `started`, `completed`, `flow`, `source_table`, `source_record`, `started_by`, `type`, `sys_created_on`, `sys_updated_on`, and `self_link`, plus pagination `metadata`.

## `get_flow_execution`

Get full details of one flow execution by `sys_id`. The `sys_flow_context` record is fetched without a `sysparm_fields` restriction so all columns are returned; by default the run's `sys_flow_log` step entries are fetched too, oldest first.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Flow execution context `sys_id` (32 hex chars) |
| `include_logs` | boolean | No | Include `sys_flow_log` step entries (default `true`; set `false` for just the context record) |
| `log_limit` | number | No | Max log entries returned, oldest first. 1-1000, default 200 |

**Returns**: The full context record plus `self_link`. When `include_logs` is true, a `logs` array (`sys_id`, `level`, `message`, `source`, `sys_created_on`, `self_link` per entry) and `log_metadata` (`total_count`, `returned_count`, `truncated`) so the caller can tell when the log was capped by `log_limit`.

---

**See also**: [Scheduled Jobs](./scheduled-jobs.md) · [Input Validation](../security/input-validation.md)

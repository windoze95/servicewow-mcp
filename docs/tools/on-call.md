[docs](../README.md) / [tools](./README.md) / on-call

# On-Call Tools (8)

Read-only tools for inspecting On-Call Scheduling (`com.snc.on_call_rotation`) configuration — built for auditing and migrating a group's on-call setup (e.g. to another platform) without clicking through the Shift admin UI.

Data model orientation:

- `cmn_rota` ("Shift" in the UI) is the root record: one per group per shift pattern, pointing at a coverage schedule (`cmn_schedule`) and holding reminder + catch-all settings.
- `cmn_rota_roster` — ordered rosters within a shift; each carries the rotation interval/start (and, on the 2024 schedule engine, a `rotation_payload` JSON).
- `cmn_rota_member` — ordered members of a roster, each with optional from/to dates and a `rotation_schedule` reference into `cmn_schedule`.
- `roster_schedule_span` (extends `cmn_schedule_span`) — member rotation spans, overrides, and time-off.
- `cmn_rota_escalation_set` + `cmn_rota_esc_step_def` — escalation policy containers and their ordered steps (2024 schedule engine / Escalation Designer).
- `cmn_rota_contact_preference`, `on_call_communication_type`, `on_call_group_preference` — how each escalation attempt is delivered and group-level behavior.
- `cmn_notif_device` — per-user email/SMS/voice endpoints that deliveries resolve to.

## `search_on_call_shifts`

Search shifts (`cmn_rota`) by group, name, or active flag. Ordered by group then name.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group` | string | No | Owning group `sys_id` (32 hex chars) |
| `name` | string | No | Shift name LIKE filter |
| `active` | boolean | No | Filter by active flag |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: Shift summaries with group, coverage schedule reference, `schedule_engine`, coverage interval/lead type, reminder settings, `use_custom_escalation`, catch-all configuration, and `self_link`.

## `get_on_call_shift`

Expand one shift into its full rotation structure: the complete `cmn_rota` record, its rosters in order, each roster's ordered members, and any roster schedule spans (rotations/overrides/time-off). Members and spans are fetched with one dot-walked query each (`roster.rota=<sys_id>`), so the call is four API requests regardless of roster count.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Shift `sys_id` (`cmn_rota`, 32 hex chars) |
| `member_limit` | number | No | 1-500, default 200 — max member rows across all rosters |
| `span_limit` | number | No | 1-500, default 200 — max roster schedule span rows |

**Returns**: `{ shift, rosters: [{ ...roster, members: [...], schedule_spans: [...] }], metadata }`. An empty `schedule_spans` can mean none exist **or** that ACLs hide them from the calling user.

> The three expanding tools (`get_on_call_shift`, `get_on_call_schedule`, `get_on_call_escalation_policy`) request `sysparm_display_value=all`, so every field arrives as a `{value, display_value}` pair — raw values for machine processing plus human-readable names in one call.

## `get_on_call_schedule`

Get any `cmn_schedule` with its entries (`cmn_schedule_span`, including extended `roster_schedule_span` rows) and linked child/excluded schedules (`cmn_other_schedule` — how holiday calendars attach). Works for a shift's coverage schedule, a member's `rotation_schedule`, or standalone business-hours/holiday schedules. Schedules carry a `time_zone` — important when the migration target only supports one timezone per schedule.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Schedule `sys_id` (`cmn_schedule`, 32 hex chars) |
| `span_limit` | number | No | 1-500, default 100 |

**Returns**: `{ schedule, spans, child_schedules, metadata }` with `self_link` on every record.

## `get_on_call_escalation_policy`

The full "who gets paged, how, and after what delay" picture for one shift: escalation sets (`cmn_rota_escalation_set`, ordered, with conditions) with their ordered steps nested (`cmn_rota_esc_step_def`: level, `time_to_next_step`, reminders, target rosters/members, group-manager targeting, forced communication channel), shift- and set-level contact preferences, the group's `on_call_group_preference`, and the instance's `on_call_communication_type` records.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `sys_id` | string | Yes | Shift `sys_id` (`cmn_rota`, 32 hex chars) |

**Returns**: `{ shift, escalation_sets: [{ ...set, steps: [...] }], contact_preferences, group_preferences, communication_types, metadata }`.

## `who_is_on_call`

Read current on-call assignments from the `v_on_call` database view, optionally filtered to one group. **Caveat**: view visibility depends on the calling user's roles — an empty result can mean nobody is on call *or* that ACLs hide the rows; the response `metadata.note` flags the ambiguity. Use the config tools above for migration-grade data.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `group` | string | No | Group `sys_id` (32 hex chars) |
| `limit` | number | No | 1-100, default 50 |

**Returns**: View rows as returned by the instance, plus `metadata` with the empty-result note when applicable.

## `get_user_notification_devices`

List a user's notification devices (`cmn_notif_device`): email/SMS/voice endpoints with service provider, active flag, primary-email marker, and any quiet-hours schedule. This is the per-user contact surface that escalation deliveries resolve to.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `user` | string | Yes | User `sys_id` (32 hex chars) |
| `include_inactive` | boolean | No | Default false — only active devices |
| `limit` | number | No | 1-100, default 50 |

**Returns**: Devices ordered by their configured `order`, each with `self_link`.

## `search_on_call_trigger_rules`

Search On-Call trigger rules (`trigger_rule`) — the wiring that launches an assignment/paging workflow when a condition on a task table matches (e.g. a major-incident state change paging a group's rota). Expand the referenced workflow with `get_workflow` (Platform Metadata).

| Parameter | Type | Required | Description |
|---|---|---|---|
| `table` | string | No | Watched table, e.g. `incident` |
| `group` | string | No | Target group `sys_id` (32 hex chars) |
| `name` | string | No | Rule name LIKE filter |
| `active` | boolean | No | Filter by active flag |
| `limit` | number | No | 1-100, default 20 |
| `offset` | number | No | Pagination offset, default 0 |

**Returns**: Rules with watched table + condition, target group, launched workflow reference, trigger action/when settings, as `{value, display_value}` pairs, with `self_link`.

## `list_notify_numbers`

List Notify (Twilio) phone numbers (`notify_number`): provisioned SMS/voice numbers used for telephony paging, with capabilities, active flag, and the owning `notify_group` whose workflows handle inbound replies/outbound calls. An inactive number means voice/SMS paging steps in workflows will not deliver.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `active` | boolean | No | Filter by active flag |
| `limit` | number | No | 1-100, default 50 |

**Returns**: Numbers ordered by phone number, as `{value, display_value}` pairs, with `self_link`.

---

**See also**: [Platform Metadata](./platform-metadata.md) (notifications, classic workflows) · [Users and Groups](./users-and-groups.md) · [Input Validation](../security/input-validation.md)

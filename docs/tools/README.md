[docs](../README.md) / tools

# Tools (74)

All MCP tools provided by the server, grouped by domain.

## Master Index

| # | Tool | Domain | Description |
|---|---|---|---|
| 1 | `search_incidents` | [Incidents](./incidents.md) | Search incidents with filters |
| 2 | `get_incident` | [Incidents](./incidents.md) | Get incident by number or sys_id |
| 3 | `create_incident` | [Incidents](./incidents.md) | Create a new incident |
| 4 | `update_incident` | [Incidents](./incidents.md) | Update incident fields |
| 5 | `add_work_note` | [Incidents](./incidents.md) | Add work note or comment to incident |
| 6 | `search_change_requests` | [Change Requests](./change-requests.md) | Search change requests with filters |
| 7 | `get_change_request` | [Change Requests](./change-requests.md) | Get change request by number or sys_id |
| 8 | `create_change_request` | [Change Requests](./change-requests.md) | Create a new change request |
| 9 | `update_change_request` | [Change Requests](./change-requests.md) | Update change request fields |
| 10 | `get_change_request_approvals` | [Change Requests](./change-requests.md) | Get approvals for a change request |
| 11 | `add_change_request_work_note` | [Change Requests](./change-requests.md) | Add work note or comment to change request |
| 12 | `lookup_user` | [Users and Groups](./users-and-groups.md) | Search users by name, email, or ID |
| 13 | `lookup_group` | [Users and Groups](./users-and-groups.md) | Search assignment groups by name |
| 14 | `get_my_profile` | [Users and Groups](./users-and-groups.md) | Get authenticated user's profile |
| 15 | `search_knowledge` | [Knowledge](./knowledge.md) | Search knowledge base articles |
| 16 | `get_article` | [Knowledge](./knowledge.md) | Get full article by sys_id |
| 17 | `get_my_tasks` | [Tasks and Approvals](./tasks-and-approvals.md) | Get tasks assigned to me |
| 18 | `get_my_approvals` | [Tasks and Approvals](./tasks-and-approvals.md) | Get pending approvals |
| 19 | `approve_or_reject` | [Tasks and Approvals](./tasks-and-approvals.md) | Approve or reject a pending approval |
| 20 | `search_catalog_items` | [Catalog](./catalog.md) | Search the service catalog |
| 21 | `get_catalog_item` | [Catalog](./catalog.md) | Get catalog item details and variables |
| 22 | `submit_catalog_request` | [Catalog](./catalog.md) | Submit a catalog request |
| 23 | `create_catalog_item` | [Catalog Admin](./catalog-admin.md) | Create a catalog item |
| 24 | `update_catalog_item` | [Catalog Admin](./catalog-admin.md) | Update catalog item fields |
| 25 | `create_catalog_variable` | [Catalog Admin](./catalog-admin.md) | Create a form variable |
| 26 | `update_catalog_variable` | [Catalog Admin](./catalog-admin.md) | Update variable fields |
| 27 | `list_catalog_variables` | [Catalog Admin](./catalog-admin.md) | List variables for a catalog item |
| 28 | `create_variable_choice` | [Catalog Admin](./catalog-admin.md) | Create a choice for a select variable |
| 29 | `create_variable_set` | [Catalog Admin](./catalog-admin.md) | Create a reusable variable set |
| 30 | `attach_variable_set` | [Catalog Admin](./catalog-admin.md) | Attach a variable set to a catalog item |
| 31 | `create_catalog_client_script` | [Catalog Admin](./catalog-admin.md) | Create a client-side script |
| 32 | `update_catalog_client_script` | [Catalog Admin](./catalog-admin.md) | Update an existing client-side script |
| 33 | `create_catalog_ui_policy` | [Catalog Admin](./catalog-admin.md) | Create a UI policy |
| 34 | `create_catalog_ui_policy_action` | [Catalog Admin](./catalog-admin.md) | Create a UI policy action |
| 35 | `get_current_update_set` | [Update Sets](./update-sets.md) | Get the current update set |
| 36 | `change_update_set` | [Update Sets](./update-sets.md) | Change the current update set |
| 37 | `create_update_set` | [Update Sets](./update-sets.md) | Create a new update set |
| 38 | `search_scheduled_jobs` | [Scheduled Jobs](./scheduled-jobs.md) | Search Scheduled Script Executions |
| 39 | `get_scheduled_job` | [Scheduled Jobs](./scheduled-jobs.md) | Get a Scheduled Script Execution by sys_id |
| 40 | `search_flow_executions` | [Flow Logs](./flow-logs.md) | Search Flow Designer execution history |
| 41 | `get_flow_execution` | [Flow Logs](./flow-logs.md) | Get a flow execution + its step log by sys_id |
| 42 | `search_cis` | [CMDB](./cmdb.md) | Search CMDB CIs by class, name, source, status, last-discovered |
| 43 | `get_ci` | [CMDB](./cmdb.md) | Get full CI record by sys_id |
| 44 | `get_ci_relationships` | [CMDB](./cmdb.md) | Read cmdb_rel_ci for a CI (parent_of / child_of) |
| 45 | `count_cis_by_class` | [CMDB](./cmdb.md) | Aggregate CI counts per class (whole-CMDB shape) |
| 46 | `find_stale_cis` | [CMDB](./cmdb.md) | Find migration-skip candidate CIs by staleness signal |
| 47 | `get_ci_ticket_references` | [CMDB](./cmdb.md) | Count incident/change/problem refs to a CI |
| 48 | `search_business_rules` | [Platform Metadata](./platform-metadata.md) | Search business rules (sys_script) by table, when, script body |
| 49 | `get_business_rule` | [Platform Metadata](./platform-metadata.md) | Get a business rule + full script/condition by sys_id |
| 50 | `get_list_view` | [Platform Metadata](./platform-metadata.md) | Read list view column layouts (sys_ui_list) + columns |
| 51 | `search_navigator_modules` | [Platform Metadata](./platform-metadata.md) | Search nav modules (sys_app_module) — where list filters live |
| 52 | `search_flow_definitions` | [Platform Metadata](./platform-metadata.md) | Search Flow Designer flow/subflow definitions |
| 53 | `get_flow_definition` | [Platform Metadata](./platform-metadata.md) | Get a flow definition + triggers + ordered action steps |
| 54 | `get_flow_action_inputs` | [Platform Metadata](./platform-metadata.md) | Expand an action instance's input values (the fields a step writes) |
| 55 | `search_ui_policies` | [Form Rules](./form-rules.md) | Search UI policies (sys_ui_policy) by table/description |
| 56 | `get_ui_policy` | [Form Rules](./form-rules.md) | Get a UI policy + its per-field actions |
| 57 | `search_client_scripts` | [Form Rules](./form-rules.md) | Search client scripts (sys_script_client) |
| 58 | `get_client_script` | [Form Rules](./form-rules.md) | Get a client script + full body by sys_id |
| 59 | `search_data_policies` | [Form Rules](./form-rules.md) | Search data policies (sys_data_policy2) |
| 60 | `get_data_policy` | [Form Rules](./form-rules.md) | Get a data policy + its per-field rules |
| 61 | `search_acls` | [Access Control](./access-control.md) | Search ACLs (sys_security_acl) by name/operation/type |
| 62 | `get_acl` | [Access Control](./access-control.md) | Get an ACL + its roles, condition, and script |
| 63 | `search_notifications` | [Platform Metadata](./platform-metadata.md) | Search email/notification definitions (sysevent_email_action) |
| 64 | `get_notification` | [Platform Metadata](./platform-metadata.md) | Get a notification + recipients, condition, message by sys_id |
| 65 | `search_on_call_shifts` | [On-Call](./on-call.md) | Search on-call shifts (cmn_rota) by group/name/active |
| 66 | `get_on_call_shift` | [On-Call](./on-call.md) | Expand a shift into rosters, ordered members, and spans/overrides |
| 67 | `get_on_call_schedule` | [On-Call](./on-call.md) | Get a schedule + entries + child/holiday schedules |
| 68 | `get_on_call_escalation_policy` | [On-Call](./on-call.md) | Full escalation design for a shift: sets, steps, contact prefs |
| 69 | `who_is_on_call` | [On-Call](./on-call.md) | Current on-call assignments from the v_on_call view |
| 70 | `get_user_notification_devices` | [On-Call](./on-call.md) | A user's email/SMS/voice notification devices (cmn_notif_device) |
| 71 | `search_workflows` | [Platform Metadata](./platform-metadata.md) | Search classic Workflow definitions (wf_workflow) |
| 72 | `get_workflow` | [Platform Metadata](./platform-metadata.md) | Get a workflow + versions + activity/transition graph |
| 73 | `search_on_call_trigger_rules` | [On-Call](./on-call.md) | Trigger rules that launch paging workflows (trigger_rule) |
| 74 | `list_notify_numbers` | [On-Call](./on-call.md) | Notify (Twilio) SMS/voice numbers and their capabilities |

## Common Patterns

### Identity Enforcement

Tools that create records (`create_incident`, `create_change_request`, `submit_catalog_request`) forcefully set the caller/requester to the authenticated user. See [Identity Enforcement](../security/identity-enforcement.md).

### Identifier Resolution

Tools that accept `identifier` parameters (incidents, change requests) accept either the record number (`INC0012345`, `CHG0012345`) or a 32-character `sys_id`. The tool resolves the number to a sys_id automatically.

### Pagination

Search tools support `limit` and `offset` parameters and return `metadata.total_count` for pagination.

### Self Links

All returned records include a `self_link` URL pointing to the record in the ServiceNow UI.

---

**See also**: [Adding Tools](../development/adding-tools.md) · [Security Overview](../security/README.md) · [Prompts](../prompts/README.md)

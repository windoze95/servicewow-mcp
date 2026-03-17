[docs](../README.md) / tools

# Tools (36)

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
| 32 | `create_catalog_ui_policy` | [Catalog Admin](./catalog-admin.md) | Create a UI policy |
| 33 | `create_catalog_ui_policy_action` | [Catalog Admin](./catalog-admin.md) | Create a UI policy action |
| 34 | `get_current_update_set` | [Update Sets](./update-sets.md) | Get the current update set |
| 35 | `change_update_set` | [Update Sets](./update-sets.md) | Change the current update set |
| 36 | `create_update_set` | [Update Sets](./update-sets.md) | Create a new update set |

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

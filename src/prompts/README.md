# Catalog Administration Prompt Templates

MCP prompt templates that guide AI clients through multi-step catalog admin workflows. Registered via `server.prompt()` in [`catalog.ts`](./catalog.ts).

## Prompts

| Prompt | Description |
|---|---|
| `build_catalog_form` | Create a catalog item with variables, choices, and layout |
| `configure_catalog_ui_policy` | Set up UI policies with IO:{sys_id} conditions and actions |
| `configure_catalog_client_script` | onChange/onLoad/onSubmit client scripts with g_form API |
| `build_catalog_variable_set` | Create and attach reusable variable sets |

Full prompt content is served to MCP clients from [`catalog.ts`](./catalog.ts).

## Quick Reference

### Tool Sequencing

| Goal | Tool Sequence |
|---|---|
| New catalog form | `create_catalog_item` → `create_catalog_variable` (×N) → `create_variable_choice` (×N) |
| Add UI policy | `create_catalog_ui_policy` → `create_catalog_ui_policy_action` (×N) |
| Add client script | `create_catalog_client_script` |
| Reusable field group | `create_variable_set` → `attach_variable_set` (×N items) |
| Update existing item | `update_catalog_item` and/or `update_catalog_variable` |
| Audit existing form | `list_catalog_variables` with `include_set_variables: true` |

### Common Gotchas

- **IO: prefix**: required in `catalog_conditions` and `catalog_variable` for UI policies and in `cat_variable` for client scripts.
- **Choices are separate**: `select_box`/`multiple_choice` variables need `create_variable_choice` calls.
- **Container layout**: must follow `container_start` → `container_split` → `container_end` pattern.
- **Action values are strings**: `"true"`, `"false"`, `"Leave alone"` — not boolean.
- **Variable set variables**: can only be added through the ServiceNow UI, not via the API tools.
- **Order collisions**: duplicate order values produce unpredictable display order.

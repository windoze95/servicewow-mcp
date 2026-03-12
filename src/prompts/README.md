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

For detailed prompt guides, see [docs/prompts/](../../docs/prompts/).

[docs](../README.md) / prompts

# MCP Prompts (4)

MCP prompts are pre-authored instruction templates served to AI clients via `server.prompt()`. They guide the client through multi-step catalog administration workflows by explaining the tool sequence, parameters, and common gotchas.

## What Are MCP Prompts?

Unlike tools (which execute actions), prompts provide **guided context** to the AI client. When a client requests a prompt, the server returns a rich text guide that the client can use to plan and execute a series of tool calls.

## Available Prompts

| Prompt | Description | Guide |
|---|---|---|
| `build_catalog_form` | Create a catalog item with variables, choices, and two-column layout | [Full Guide](./build-catalog-form.md) |
| `configure_catalog_ui_policy` | Set up UI policies with IO:{sys_id} conditions and field-level actions | [Full Guide](./configure-ui-policy.md) |
| `configure_catalog_client_script` | Create onChange/onLoad/onSubmit client scripts with g_form API | [Full Guide](./configure-client-script.md) |
| `build_catalog_variable_set` | Create and attach reusable variable sets to catalog items | [Full Guide](./build-variable-set.md) |

## Implementation

Prompts are registered in `src/prompts/catalog.ts` via the `registerCatalogPrompts()` function. Each prompt returns a message array with detailed instructions.

For the source prompt templates, see [`src/prompts/`](../../src/prompts/).

---

**See also**: [Catalog Administration Tools](../tools/catalog-admin.md) · [Catalog Tools](../tools/catalog.md) · [Tools Overview](../tools/README.md)

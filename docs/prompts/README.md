[docs](../README.md) / prompts

# MCP Prompts (7)

MCP prompts are pre-authored instruction templates served to AI clients via `server.prompt()`. They guide the client through multi-step ServiceNow workflows by explaining the tool sequence, parameters, and common gotchas.

## What Are MCP Prompts?

Unlike tools (which execute actions), prompts provide **guided context** to the AI client. When a client requests a prompt, the server returns a rich text guide that the client can use to plan and execute a series of tool calls.

## Available Prompts

### Catalog Administration

| Prompt | Description | Guide |
|---|---|---|
| `build_catalog_form` | Create a catalog item with variables, choices, and two-column layout | [Full Guide](./build-catalog-form.md) |
| `configure_catalog_ui_policy` | Set up UI policies with IO:{sys_id} conditions and field-level actions | [Full Guide](./configure-ui-policy.md) |
| `configure_catalog_client_script` | Create onChange/onLoad/onSubmit client scripts with g_form API | [Full Guide](./configure-client-script.md) |
| `build_catalog_variable_set` | Create and attach reusable variable sets to catalog items | [Full Guide](./build-variable-set.md) |

### ITSM Workflows

| Prompt | Description | Guide |
|---|---|---|
| `incident_triage` | Guided incident classification with impact/urgency assessment and priority matrix | [Full Guide](./incident-triage.md) |
| `change_request_planning` | Structured change request creation with risk assessment and lifecycle management | [Full Guide](./change-request-planning.md) |
| `knowledge_article_authoring` | KB article writing guide with templates and best practices | [Full Guide](./knowledge-article-authoring.md) |

## Implementation

Prompts are registered in `src/prompts/` across domain-specific modules:
- `catalog.ts` — 4 catalog administration prompts
- `incidents.ts` — incident triage prompt
- `changeRequests.ts` — change request planning prompt
- `knowledge.ts` — knowledge article authoring prompt

For the source prompt templates, see [`src/prompts/`](../../src/prompts/).

---

**See also**: [Catalog Administration Tools](../tools/catalog-admin.md) · [Catalog Tools](../tools/catalog.md) · [Tools Overview](../tools/README.md) · [Resources Overview](../resources/README.md)

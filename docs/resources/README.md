[docs](../README.md) / resources

# MCP Resources (5)

MCP resources expose ServiceNow records as readable data via `server.resource()`. Unlike tools (which execute actions), resources provide **direct data access** — clients can read a resource URI to get the current state of a record.

## What Are MCP Resources?

Resources follow the MCP resource protocol. A client reads a URI like `servicenow://incident/{sys_id}` and receives the record as JSON. Resources support:

- **Fixed resources**: Static URIs like `servicenow://me` that always resolve to the same logical record (the current user)
- **Template resources**: Parameterized URIs like `servicenow://incident/{sys_id}` where the client provides the identifier

## How to Use Resources

Resources are consumed by the AI agent (MCP client), not by humans directly. The agent reads a resource URI to pull structured data into the conversation context — similar to how a tool returns data, but without side effects.

### When the Agent Uses Resources

During a conversation, the AI agent may read resources automatically when it needs record data. For example, if you ask "what's my ServiceNow profile?", the agent can read `servicenow://me` to get your user record.

Resources are particularly useful for:
- **Providing context** — the agent reads a record before deciding what actions to take
- **Referencing data** — fetching an incident or change request to answer questions about it
- **Avoiding tool overhead** — resources are read-only lookups, simpler than invoking a full tool

### Programmatic (MCP SDK)

Any MCP client can list and read resources via the protocol:

```typescript
// List available resources
const { resources } = await client.listResources();

// List resource templates (parameterized URIs)
const { resourceTemplates } = await client.listResourceTemplates();

// Read a fixed resource
const result = await client.readResource({ uri: "servicenow://me" });
// result.contents[0].text contains the JSON record

// Read a template resource by filling in the sys_id
const incident = await client.readResource({
  uri: "servicenow://incident/a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4"
});
```

## Available Resources

| Resource | URI | Type | Description |
|---|---|---|---|
| `my_profile` | `servicenow://me` | Fixed | Current authenticated user's profile |
| `incident` | `servicenow://incident/{sys_id}` | Template | Incident record by sys_id |
| `change_request` | `servicenow://change_request/{sys_id}` | Template | Change request record by sys_id |
| `kb_knowledge` | `servicenow://kb_knowledge/{sys_id}` | Template | Knowledge base article by sys_id |
| `catalog` | `servicenow://catalog/{sys_id}` | Template | Service catalog item by sys_id |

## Behavior

- All resources return JSON with `mimeType: "application/json"`
- Template resources validate `sys_id` format (32-character hex) before making API calls
- Errors are returned as JSON error content, not exceptions — resource reads never crash the server
- Resources use the same per-user OAuth delegation as tools — the authenticated user's permissions apply

## Implementation

Resources are registered in `src/resources/servicenow.ts` via `registerResources()`. They share the `getContext` closure from the tool registry for authentication and client instantiation.

---

**See also**: [Tools Overview](../tools/README.md) · [Prompts Overview](../prompts/README.md)

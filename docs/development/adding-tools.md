[docs](../README.md) / [development](./README.md) / adding-tools

# Adding Tools

How to add a new MCP tool to the server.

## Architecture

Tools are organized by domain in `src/tools/*.ts`. Each domain file exports a `register*Tools()` function that receives:

- `server: McpServer` — the MCP server instance to register tools on
- `wrapHandler: WrapHandler` — a wrapper that handles auth, rate limiting, error normalization

## Step 1: Create the Tool Handler

Add a new tool in the appropriate domain file (or create a new one). Use `server.tool()` with Zod schemas:

```typescript
server.tool(
  "my_tool_name",
  "Description of what the tool does.",
  {
    param1: z.string().describe("Parameter description"),
    param2: z.number().optional().describe("Optional parameter"),
  },
  wrapHandler(async (ctx: ToolContext, args: { param1: string; param2?: number }) => {
    // ctx provides:
    //   ctx.snClient    — authenticated ServiceNow REST client
    //   ctx.instanceUrl — ServiceNow instance URL
    //   ctx.userSysId   — authenticated user's sys_id
    //   ctx.userName     — authenticated user's user_name
    //   ctx.displayName  — authenticated user's display name

    const { data } = await ctx.snClient.get("/api/now/table/my_table", {
      params: { sysparm_query: `field=${args.param1}`, sysparm_limit: 10 },
    });

    return {
      success: true,
      data: data.result.map((r) => ({
        ...r,
        self_link: buildRecordUrl(ctx.instanceUrl, "my_table", r.sys_id),
      })),
    };
  })
);
```

## Step 2: ToolContext

`ToolContext` is created fresh for every tool call by `getContext()` in `src/tools/registry.ts`:

```typescript
interface ToolContext {
  snClient: ServiceNowClient;  // Authenticated API client
  instanceUrl: string;          // ServiceNow base URL
  userSysId: string;            // Authenticated user's sys_id
  userName: string;             // e.g., "jane.smith"
  displayName: string;          // e.g., "Jane Smith"
}
```

The context resolution flow: bearer token → `authInfo.userSysId` → rate limit check → token refresh → ServiceNowClient creation.

## Step 3: wrapHandler

`wrapHandler` provides:

1. **Authentication**: Calls `getContext()` to resolve the user from `authInfo` and create an authenticated client
2. **Rate limiting**: Checked before the handler executes
3. **Error normalization**: Catches all errors and maps them to consistent `ToolError` responses
4. **Logging**: Logs completion time and user

You never need to handle auth or errors manually — just throw or return your result.

## Step 4: Register the Tool

If you created a new domain file, import and call its register function in `src/tools/registry.ts`:

```typescript
import { registerMyTools } from "./myDomain.js";

// Inside registerAllTools():
registerMyTools(server, wrapHandler);
```

## Step 5: Validation Patterns

Use existing validators from `src/utils/validators.ts`:

```typescript
import { validateSysId, sanitizeUpdatePayload } from "../utils/validators.js";

// Validate sys_id format
if (!validateSysId(args.sys_id)) {
  return { success: false, error: { code: "VALIDATION_ERROR", message: "Invalid sys_id format" } };
}

// Strip readonly fields from update payloads
const sanitized = sanitizeUpdatePayload(args.fields);
```

## Step 6: Add Tests

Create or update the test file in `src/tools/__tests__/`. See [Testing](./testing.md).

## Step 7: Update Documentation

Update `docs/tools/` with the new tool documentation. If adding a new domain, create a new file and add it to the [Tools Master Index](../tools/README.md).

## Identity Enforcement Checklist

If your tool creates records:
- [ ] Set caller/requester fields to `ctx.userSysId` (not client-supplied values)

If your tool updates records:
- [ ] Use `sanitizeUpdatePayload()` to strip readonly fields

If your tool acts on behalf of a user:
- [ ] Verify ownership before modifying (like `approve_or_reject` does)

---

**See also**: [Project Structure](../architecture/project-structure.md) · [Request Flow](../architecture/request-flow.md) · [Testing](./testing.md)

[docs](../README.md) / [getting-started](./README.md) / first-tool-call

# First Tool Call

This guide walks through the complete flow from a running server to your first successful tool call.

## Prerequisites

- Server running locally (`npm run dev`) — see [Local Development](./local-development.md)
- ServiceNow OAuth app configured — see [ServiceNow OAuth Setup](./servicenow-oauth-setup.md)
- A ServiceNow user with `snc_platform_rest_api_access`

## Step 1: Health Check

Confirm the server and Redis are healthy:

```bash
curl -s http://localhost:8080/health | jq
```

You should see `"status": "healthy"` and `"redis": "connected"`.

## Step 2: Authenticate via OAuth

Open your browser and navigate to:

```
http://localhost:8080/oauth/authorize
```

This redirects you to ServiceNow's login page. After authenticating, ServiceNow redirects back to `/oauth/callback`, which exchanges the authorization code for tokens.

On success, you'll see a JSON response:

```json
{
  "success": true,
  "message": "Authentication successful for Jane Smith. You can now use MCP tools.",
  "user": {
    "sys_id": "abc123...",
    "user_name": "jane.smith",
    "display_name": "Jane Smith"
  }
}
```

The server now has encrypted OAuth tokens stored in Redis for this user.

## Step 3: Connect an MCP Client

Configure your MCP client to connect to the server. For Claude Desktop, add to your config:

```json
{
  "mcpServers": {
    "servicenow": {
      "type": "streamablehttp",
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

See [Client Configuration](../api/client-configuration.md) for more examples including reconnect tokens.

## Step 4: Make a Tool Call

Once connected, try a simple read operation:

- **`get_my_profile`** — returns the authenticated user's ServiceNow profile (no parameters needed)
- **`get_my_tasks`** — returns open tasks assigned to you
- **`search_incidents`** — search incidents (try `{ "limit": 5 }`)

If you get `AUTH_REQUIRED`, the session may not be mapped to the user. Re-authenticate via `/oauth/authorize?session_id=<your-mcp-session-id>`.

## What Happened Behind the Scenes

1. Your MCP client sent `POST /mcp` with an `initialize` request
2. The server created a new `McpServer` + `StreamableHTTPServerTransport` pair
3. The session ID was generated and returned in the `Mcp-Session-Id` header
4. When you called a tool, the server resolved your session → user → OAuth token
5. A fresh `ServiceNowClient` was created with your access token
6. The request was made to ServiceNow's REST API **as you**

See [Session Lifecycle](../architecture/session-lifecycle.md) and [Request Flow](../architecture/request-flow.md) for the full trace.

---

**See also**: [Tools Overview](../tools/README.md) · [OAuth Flow](../auth/oauth-flow.md) · [Troubleshooting](../troubleshooting/README.md)

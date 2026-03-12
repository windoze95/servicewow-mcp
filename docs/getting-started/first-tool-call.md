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

## Step 2: Configure Your MCP Client

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

The MCP client will automatically discover the OAuth endpoints via `/.well-known/oauth-authorization-server` and handle PKCE-based authentication. When you first connect, the client will redirect you to ServiceNow for login/consent, then exchange tokens automatically.

See [Client Configuration](../api/client-configuration.md) for more examples.

## Step 3: Make a Tool Call

Once connected, try a simple read operation:

- **`get_my_profile`** — returns the authenticated user's ServiceNow profile (no parameters needed)
- **`get_my_tasks`** — returns open tasks assigned to you
- **`search_incidents`** — search incidents (try `{ "limit": 5 }`)

If you get an authentication error, ensure your MCP client completed the OAuth flow successfully. Check that the server logs show a successful token exchange.

## What Happened Behind the Scenes

1. Your MCP client discovered OAuth metadata via `/.well-known/oauth-authorization-server`
2. The client registered dynamically and performed PKCE-based authorization
3. After ServiceNow login, the client exchanged an authorization code for a bearer token
4. The client sent `POST /mcp` with `Authorization: Bearer` and an `initialize` request
5. The server created a new `McpServer` + `StreamableHTTPServerTransport` pair
6. When you called a tool, the server resolved the bearer token → user → SN OAuth token
7. A fresh `ServiceNowClient` was created with your access token
8. The request was made to ServiceNow's REST API **as you**

See [Session Lifecycle](../architecture/session-lifecycle.md) and [Request Flow](../architecture/request-flow.md) for the full trace.

---

**See also**: [Tools Overview](../tools/README.md) · [OAuth Flow](../auth/oauth-flow.md) · [Troubleshooting](../troubleshooting/README.md)

[docs](../README.md) / [api](./README.md) / client-configuration

# Client Configuration

## Claude Desktop

### Basic Configuration

```json
{
  "mcpServers": {
    "servicenow": {
      "type": "streamablehttp",
      "url": "https://your-host:8080/mcp"
    }
  }
}
```

### With Reconnect Token

For session persistence across server restarts:

```json
{
  "mcpServers": {
    "servicenow": {
      "type": "streamablehttp",
      "url": "https://your-host:8080/mcp?token=<your-reconnect-token>"
    }
  }
}
```

See [Reconnect Tokens](../auth/reconnect-tokens.md) for how to generate a token.

### Local Development

For local development without TLS:

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

### Caddy Public Deployment

When using the Caddy auto-TLS overlay:

```json
{
  "mcpServers": {
    "servicenow": {
      "type": "streamablehttp",
      "url": "https://mcp.example.com/mcp"
    }
  }
}
```

## Authentication Flow

1. Configure the MCP client with the server URL
2. Connect — the client initializes an MCP session
3. On the first tool call, if no OAuth credentials exist, the tool returns an `AUTH_REQUIRED` error with an authorize URL
4. Open the URL in a browser, complete the ServiceNow login
5. Return to the MCP client — subsequent tool calls will succeed

With a reconnect token, step 3-4 are skipped on server restarts (the session is auto-mapped to existing credentials).

---

**See also**: [Endpoints](./endpoints.md) · [Reconnect Tokens](../auth/reconnect-tokens.md) · [First Tool Call](../getting-started/first-tool-call.md)

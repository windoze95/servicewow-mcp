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
2. Connect — the client discovers OAuth metadata via `/.well-known/oauth-authorization-server`
3. The client performs PKCE-based OAuth automatically (dynamic registration, authorization, token exchange)
4. The user is redirected to ServiceNow for login/consent
5. After successful auth, the client receives a bearer token and uses it on every `/mcp` request
6. When the MCP access token expires, the client uses its refresh token to obtain a new one

MCP clients that support the MCP OAuth spec handle this entire flow automatically — no manual link-opening required.

---

**See also**: [Endpoints](./endpoints.md) · [OAuth Flow](../auth/oauth-flow.md) · [First Tool Call](../getting-started/first-tool-call.md)

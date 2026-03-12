[docs](../README.md) / [getting-started](./README.md) / local-development

# Local Development

## 1. Install Dependencies

```bash
npm install
```

## 2. Configure Environment

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

### Generate an Encryption Key

The server encrypts OAuth tokens at rest with AES-256-GCM. Generate a 32-byte key:

```bash
npm run generate-key
```

Paste the output into `TOKEN_ENCRYPTION_KEY` in your `.env`.

### Required Variables

At minimum, set these in `.env`:

```bash
SERVICENOW_INSTANCE_URL=https://yourorg.service-now.com
SERVICENOW_CLIENT_ID=<from SN OAuth app>
SERVICENOW_CLIENT_SECRET=<from SN OAuth app>
OAUTH_REDIRECT_URI=http://localhost:8080/oauth/callback
TOKEN_ENCRYPTION_KEY=<base64 32-byte key>
ALLOWED_ORIGINS=https://claude.ai
```

See [Environment Variables](../deployment/environment-variables.md) for the full configuration reference.

## 3. Start the Dev Server

```bash
npm run dev
```

This runs the server with `tsx` in watch mode on port 8080 (or `MCP_PORT`).

## 4. Verify

```bash
curl -s http://localhost:8080/health | jq
```

Expected response:

```json
{
  "status": "healthy",
  "uptime": 1.234,
  "redis": "connected",
  "timestamp": "2026-03-11T..."
}
```

If Redis shows `"disconnected"`, check that Redis is running and `REDIS_URL` is correct. See [Troubleshooting](../troubleshooting/README.md).

## Build Check

```bash
npm run build    # TypeScript compilation
npm test         # Run all tests
```

---

**See also**: [Prerequisites](./prerequisites.md) · [ServiceNow OAuth Setup](./servicenow-oauth-setup.md) · [First Tool Call](./first-tool-call.md)

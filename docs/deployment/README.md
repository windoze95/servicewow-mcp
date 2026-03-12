[docs](../README.md) / deployment

# Deployment

Multiple deployment options are available depending on your environment.

## Options

| Option | Best For | Guide |
|---|---|---|
| **Docker + Local Overlay** | Development, VPN/LAN access | [Docker (Local)](./docker-local.md) |
| **Docker + Caddy Overlay** | Public internet with automatic TLS | [Docker (Caddy)](./docker-caddy.md) |
| **Native TLS** | Non-Docker environments with your own certs | [Native TLS](./native-tls.md) |
| **Setup Script** | One-shot Linux VM provisioning | [Setup Script](./setup-script.md) |

## Configuration

All deployment options are configured via environment variables. See [Environment Variables](./environment-variables.md) for the full reference.

## Docker Architecture

The base `docker-compose.yml` defines two services:

- **`servicenow-mcp`**: The MCP server (built from `Dockerfile`)
- **`redis`**: Redis 7 Alpine with password auth, AOF persistence, and 128MB memory limit

Overlays add networking configuration:
- `docker-compose.local.yml`: Exposes the server port directly
- `docker-compose.caddy.yml`: Adds a Caddy reverse proxy with automatic TLS

## Container Image

CI publishes a Docker image to GitHub Container Registry on merges to `main`:

```
ghcr.io/<owner>/servicewow-mcp:latest
ghcr.io/<owner>/servicewow-mcp:sha-<commit>
```

---

**See also**: [Environment Variables](./environment-variables.md) · [Getting Started](../getting-started/README.md) · [CI Pipeline](../development/ci-pipeline.md)

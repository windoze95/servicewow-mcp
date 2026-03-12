[docs](../README.md) / [deployment](./README.md) / docker-local

# Docker (Local)

For development or VPN/LAN access where the server is not exposed to the public internet.

## Usage

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

## What It Does

The **base** `docker-compose.yml` defines:

- **`servicenow-mcp`**: Builds from `Dockerfile`, exposes port internally, reads `.env`, depends on Redis health
- **`redis`**: Redis 7 Alpine with password auth (`REDIS_PASSWORD`), AOF persistence, 128MB memory limit, health check

The **local overlay** (`docker-compose.local.yml`) adds:

```yaml
services:
  servicenow-mcp:
    ports:
      - "${MCP_PORT:-8080}:${MCP_PORT:-8080}"
```

This maps the container port directly to the host, making the server accessible at `http://localhost:8080` (or whatever `MCP_PORT` is set to).

## Prerequisites

- Docker and Docker Compose installed
- A `.env` file configured (see [Environment Variables](./environment-variables.md))

## Networking

Both services are on the `mcp-internal` bridge network. The MCP server connects to Redis via `redis://:<password>@redis:6379` (the `redis` service name resolves within the Docker network).

## Volumes

| Volume | Purpose |
|---|---|
| `redis-data` | Redis AOF persistence |
| `./certs:/certs:ro` | TLS certificates (mounted read-only, optional) |

## Common Commands

```bash
# Start
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build

# View logs
docker compose logs -f

# Stop
docker compose down

# Stop and remove volumes
docker compose down -v
```

---

**See also**: [Docker (Caddy)](./docker-caddy.md) · [Environment Variables](./environment-variables.md) · [Setup Script](./setup-script.md)

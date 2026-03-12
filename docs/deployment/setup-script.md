[docs](../README.md) / [deployment](./README.md) / setup-script

# Setup Script

`setup.sh` is a one-shot provisioning script for Linux VMs that handles Docker installation, environment configuration, and deployment.

## Usage

```bash
chmod +x setup.sh
./setup.sh
```

## What It Does

The script runs 6 steps in sequence:

### 1. Install Docker

Detects the OS and installs Docker if not already present:
- **Debian/Ubuntu**: Uses the official Docker install script (`get.docker.com`)
- **RHEL/CentOS**: Installs via `dnf` from Docker's official repository
- **macOS**: Prints a message to install Docker Desktop manually
- Adds the current user to the `docker` group

### 2. Check Docker Compose

Verifies `docker compose` (v2 plugin) is available. Exits if not found.

### 3. Generate `.env`

Interactive prompt that collects:
- ServiceNow instance URL, OAuth client ID/secret
- Server hostname and port
- TLS certificate paths (optional)
- CORS origins
- Deployment mode: **Local** (direct port exposure) or **Public** (Caddy with auto-TLS)
- Caddy domain (if public mode)

Auto-generates:
- `TOKEN_ENCRYPTION_KEY` (via `openssl rand -base64 32`)
- `REDIS_PASSWORD` (via `openssl rand -base64 24`)

Sets `.env` file permissions to `600` (owner read/write only).

### 4. Build and Launch

Runs the appropriate `docker compose` command based on the chosen deployment mode:
- **Local**: `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d`
- **Public**: `docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d`

### 5. Health Check

Polls `http://localhost:{port}/health` every 2 seconds for up to 60 seconds. Reports success or failure.

### 6. Print Instructions

Displays:
- MCP endpoint URL
- Health check URL
- OAuth discovery URL (`/.well-known/oauth-authorization-server`)
- ServiceNow OAuth application setup steps
- User role requirements (`snc_platform_rest_api_access`)
- Claude Desktop configuration JSON

## Idempotency

If a `.env` file already exists, the script asks whether to overwrite it. Answering "N" keeps the existing configuration.

## Supported Platforms

| OS | Support |
|---|---|
| Debian / Ubuntu | Full (auto-installs Docker) |
| RHEL / CentOS | Full (auto-installs Docker) |
| macOS | Partial (requires manual Docker Desktop install) |
| Other | Manual Docker installation required |

---

**See also**: [Docker (Local)](./docker-local.md) · [Docker (Caddy)](./docker-caddy.md) · [Environment Variables](./environment-variables.md)

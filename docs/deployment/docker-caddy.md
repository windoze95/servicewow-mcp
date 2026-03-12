[docs](../README.md) / [deployment](./README.md) / docker-caddy

# Docker (Caddy)

For internet-facing deployments with automatic HTTPS via Let's Encrypt.

## Usage

```bash
# Set your public domain
echo "CADDY_DOMAIN=mcp.example.com" >> .env

# Launch with Caddy reverse proxy
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
```

## What It Does

The **Caddy overlay** (`docker-compose.caddy.yml`) adds a Caddy 2 reverse proxy:

- **Automatic TLS**: Caddy provisions Let's Encrypt certificates automatically
- **Ports 80 + 443**: Both must be open and DNS must point to your server
- **HTTP/3**: Port 443/udp is also exposed for QUIC support
- **Reverse proxy**: Routes all traffic to `servicenow-mcp` on the internal network

## Prerequisites

- DNS A record pointing `CADDY_DOMAIN` to your server's public IP
- Ports 80 and 443 open in your firewall
- `CADDY_DOMAIN` set in `.env` (required — compose will fail without it)
- A `Caddyfile` in the project root

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `CADDY_DOMAIN` | Yes | Public domain name (e.g., `mcp.example.com`) |
| `MCP_PORT` | No | Internal port (default `8080`, used for proxy routing) |

## Volumes

| Volume | Purpose |
|---|---|
| `caddy-data` | TLS certificates and OCSP stapling data |
| `caddy-config` | Caddy configuration state |
| `./Caddyfile` | Caddy configuration (mounted read-only) |

## Networking

Caddy joins the `mcp-internal` network and depends on `servicenow-mcp` being healthy. It proxies requests to `servicenow-mcp:${MCP_PORT}`.

## Notes

- The MCP server itself does **not** need TLS enabled (`TLS_CERT_PATH`/`TLS_KEY_PATH`) when behind Caddy — Caddy terminates TLS
- Caddy auto-renews certificates before expiry
- For the `OAUTH_REDIRECT_URI` in `.env`, use `https://${CADDY_DOMAIN}/oauth/callback`

---

**See also**: [Docker (Local)](./docker-local.md) · [Native TLS](./native-tls.md) · [Environment Variables](./environment-variables.md)

[docs](../README.md) / [deployment](./README.md) / native-tls

# Native TLS

For running without Docker or Caddy, the server supports built-in HTTPS via Node.js `https.createServer`.

## Configuration

Set both environment variables in `.env`:

```bash
TLS_CERT_PATH=/path/to/server.crt
TLS_KEY_PATH=/path/to/server.key
```

Both must be set together — the config validates that either both or neither are present.

## How It Works

In `src/index.ts`, the startup logic checks for TLS configuration:

```typescript
const useTls = !!(config.TLS_CERT_PATH && config.TLS_KEY_PATH);

const server = useTls
  ? createHttpsServer(
      { cert: readFileSync(config.TLS_CERT_PATH!), key: readFileSync(config.TLS_KEY_PATH!) },
      app
    )
  : app;
```

When TLS is enabled:
- The server listens on `https://localhost:{MCP_PORT}`
- Certificates are read at startup (not hot-reloaded)
- All endpoints use HTTPS

When TLS is not enabled:
- The server listens on `http://localhost:{MCP_PORT}`
- Express `app.listen()` is used directly

## Certificate Requirements

- Standard PEM-encoded X.509 certificate and private key
- The certificate should cover the hostname clients will use to connect
- Self-signed certificates work for development but require clients to trust them

## Self-Signed Certificate (Development)

```bash
openssl req -x509 -newkey rsa:2048 -keyout server.key -out server.crt \
  -days 365 -nodes -subj "/CN=localhost"
```

## When to Use

- Running directly on a VM without Docker
- Behind a load balancer that doesn't terminate TLS
- Development/testing with self-signed certs

For production deployments, consider [Docker with Caddy](./docker-caddy.md) for automatic certificate management.

---

**See also**: [Docker (Caddy)](./docker-caddy.md) · [Docker (Local)](./docker-local.md) · [Environment Variables](./environment-variables.md)

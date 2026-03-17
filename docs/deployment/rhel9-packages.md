[docs](../README.md) / [deployment](./README.md) / rhel9-packages

# RHEL 9 Package Requirements

Complete list of packages needed on a RHEL 9 VM to run, build, and develop the ServiceNow MCP server.

## Docker Deployment (run containers only)

These packages are sufficient if you only need to run pre-built Docker images.

```bash
# Docker Engine and Compose plugin
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Enable and start Docker
sudo systemctl enable --now docker

# Add your user to the docker group (log out / back in to take effect)
sudo usermod -aG docker "$USER"
```

### Supporting tools for Docker deployment

```bash
# curl — used by setup.sh health checks and general HTTP debugging
# openssl — generates TOKEN_ENCRYPTION_KEY and REDIS_PASSWORD in setup.sh
# git — clone the repository
sudo dnf install -y curl openssl git
```

## Build & Develop (compile TypeScript, run tests)

These packages are needed in addition to Docker if you want to build from source or run tests on the host.

### Node.js 22

The project requires Node.js >= 22. RHEL 9's default `appstream` repos do not ship Node 22, so use the NodeSource repository:

```bash
# Install Node.js 22 from NodeSource
sudo dnf install -y https://rpm.nodesource.com/pub_22.x/nodistro/repo/nodesource-release-nodistro-1.noarch.rpm
sudo dnf install -y nodejs

# Verify
node --version   # v22.x.x
npm --version    # bundled with Node.js
```

Alternatively, use `nvm` (Node Version Manager) if you prefer user-level installs:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
```

### Build toolchain

The `npm install` step compiles native addons for some dependencies, which requires a C/C++ compiler and Python:

```bash
sudo dnf install -y gcc-c++ make python3
```

### Redis 7 (optional — for running outside Docker)

Only needed if you want to run Redis directly on the host instead of in a container:

```bash
sudo dnf install -y redis
sudo systemctl enable --now redis
```

> **Note:** RHEL 9 AppStream ships Redis 6. For Redis 7, use the [Remi repository](https://rpms.remirepo.net/) or run Redis in Docker (recommended).

## Complete One-Liner

Install everything for both Docker deployment and local build/development:

```bash
# Add Docker repo
sudo dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo

# Add NodeSource repo for Node.js 22
sudo dnf install -y https://rpm.nodesource.com/pub_22.x/nodistro/repo/nodesource-release-nodistro-1.noarch.rpm

# Install all packages
sudo dnf install -y \
  docker-ce docker-ce-cli containerd.io docker-compose-plugin \
  nodejs \
  gcc-c++ make python3 \
  git curl openssl

# Enable services
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

## Package Summary

| Package | Purpose | Needed For |
|---|---|---|
| `docker-ce` | Container runtime | Running containers |
| `docker-ce-cli` | Docker CLI | Running containers |
| `containerd.io` | Container runtime dependency | Running containers |
| `docker-compose-plugin` | `docker compose` v2 | Orchestrating services (MCP + Redis + Caddy) |
| `nodejs` (22+) | JavaScript runtime | Building TypeScript, running dev server, running tests |
| `npm` | Package manager (bundled with Node.js) | Installing dependencies |
| `gcc-c++` | C++ compiler | Compiling native npm addons |
| `make` | Build automation | Compiling native npm addons |
| `python3` | Python interpreter | node-gyp (native addon build tool) |
| `git` | Version control | Cloning the repository |
| `curl` | HTTP client | Health checks, setup script |
| `openssl` | Cryptography toolkit | Generating encryption keys, TLS certs |

## Firewall

If `firewalld` is running, open the server port:

```bash
sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --reload

# For Caddy (public deployment)
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --reload
```

## SELinux

RHEL 9 has SELinux enabled by default. Docker generally works with SELinux, but if you encounter permission issues with volume mounts:

```bash
# Check current mode
getenforce

# If troubleshooting, temporarily set to permissive (not recommended for production)
sudo setenforce 0

# For persistent container volume access, use the :z or :Z mount flag
# (already handled by docker compose)
```

---

**See also**: [Setup Script](./setup-script.md) · [Docker (Local)](./docker-local.md) · [Docker (Caddy)](./docker-caddy.md) · [Environment Variables](./environment-variables.md)

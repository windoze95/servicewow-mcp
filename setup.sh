#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="/opt/servicenow-mcp-server"
BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BOLD}ServiceNow MCP Server — Setup Script${NC}"
echo "========================================"
echo ""

# 1. Detect OS and install Docker if missing
install_docker() {
    if command -v docker &>/dev/null; then
        echo -e "${GREEN}✓ Docker already installed${NC}"
        return
    fi

    echo -e "${YELLOW}Installing Docker...${NC}"
    if [ -f /etc/debian_version ]; then
        curl -fsSL https://get.docker.com | sh
        sudo systemctl enable docker
        sudo systemctl start docker
    elif [ -f /etc/redhat-release ]; then
        sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
        sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
        sudo systemctl enable docker
        sudo systemctl start docker
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo -e "${RED}Please install Docker Desktop for Mac from https://docker.com/products/docker-desktop${NC}"
        exit 1
    else
        echo -e "${RED}Unsupported OS. Please install Docker manually.${NC}"
        exit 1
    fi

    # Add current user to docker group
    sudo usermod -aG docker "$USER" 2>/dev/null || true
    echo -e "${GREEN}✓ Docker installed${NC}"
}

# 2. Check Docker Compose
check_compose() {
    if docker compose version &>/dev/null; then
        echo -e "${GREEN}✓ Docker Compose available${NC}"
    else
        echo -e "${RED}Docker Compose not found. Please install it.${NC}"
        exit 1
    fi
}

# 3. Interactive .env generation
generate_env() {
    local ENV_FILE=".env"

    if [ -f "$ENV_FILE" ]; then
        echo -e "${YELLOW}Existing .env file found.${NC}"
        read -rp "Overwrite? (y/N): " overwrite
        if [[ "$overwrite" != "y" && "$overwrite" != "Y" ]]; then
            echo "Keeping existing .env"
            return
        fi
    fi

    echo ""
    echo -e "${BOLD}ServiceNow Configuration${NC}"
    echo "------------------------"

    read -rp "ServiceNow Instance URL (e.g. https://myorg.service-now.com): " SN_URL
    read -rp "OAuth Client ID: " CLIENT_ID
    read -rsp "OAuth Client Secret: " CLIENT_SECRET
    echo ""
    read -rp "Server hostname/IP (for OAuth redirect URI): " SERVER_HOST
    read -rp "Server port [8080]: " SERVER_PORT
    SERVER_PORT=${SERVER_PORT:-8080}

    # Auto-generate secrets
    TOKEN_ENCRYPTION_KEY=$(openssl rand -base64 32)
    REDIS_PASSWORD=$(openssl rand -base64 24)

    REDIRECT_URI="https://${SERVER_HOST}:${SERVER_PORT}/oauth/callback"

    echo ""
    echo -e "${BOLD}TLS Configuration${NC}"
    echo "-----------------"
    read -rp "TLS certificate path (leave empty to skip): " TLS_CERT
    read -rp "TLS private key path (leave empty to skip): " TLS_KEY

    read -rp "Allowed CORS origins (comma-separated, or * for all) [*]: " CORS_ORIGINS
    CORS_ORIGINS=${CORS_ORIGINS:-*}

    # Write .env file
    cat > "$ENV_FILE" <<EOF
# ServiceNow Instance
SERVICENOW_INSTANCE_URL=${SN_URL}
SERVICENOW_CLIENT_ID=${CLIENT_ID}
SERVICENOW_CLIENT_SECRET=${CLIENT_SECRET}

# OAuth
OAUTH_REDIRECT_URI=${REDIRECT_URI}

# Security (auto-generated)
TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY}
REDIS_PASSWORD=${REDIS_PASSWORD}

# Redis
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379

# Server
MCP_PORT=${SERVER_PORT}
NODE_ENV=production
LOG_LEVEL=info

# Rate Limiting
RATE_LIMIT_PER_USER=60

# CORS
ALLOWED_ORIGINS=${CORS_ORIGINS}
EOF

    if [ -n "$TLS_CERT" ] && [ -n "$TLS_KEY" ]; then
        cat >> "$ENV_FILE" <<EOF

# TLS
TLS_CERT_PATH=${TLS_CERT}
TLS_KEY_PATH=${TLS_KEY}
EOF
    fi

    chmod 600 "$ENV_FILE"
    echo -e "${GREEN}✓ .env file generated${NC}"
}

# 4. Build and launch
build_and_launch() {
    echo ""
    echo -e "${BOLD}Building and launching...${NC}"

    docker compose build --no-cache
    docker compose up -d

    echo -e "${GREEN}✓ Containers started${NC}"
}

# 5. Health check
wait_for_health() {
    echo ""
    echo "Waiting for server to become healthy..."
    local max_attempts=30
    local attempt=0

    while [ $attempt -lt $max_attempts ]; do
        if curl -sf "http://localhost:${SERVER_PORT:-8080}/health" > /dev/null 2>&1; then
            echo -e "${GREEN}✓ Server is healthy!${NC}"
            return
        fi
        attempt=$((attempt + 1))
        sleep 2
    done

    echo -e "${RED}Server did not become healthy within 60 seconds.${NC}"
    echo "Check logs: docker compose logs servicenow-mcp"
}

# 6. Print setup instructions
print_instructions() {
    local PORT=${SERVER_PORT:-8080}
    echo ""
    echo "========================================"
    echo -e "${BOLD}Setup Complete!${NC}"
    echo "========================================"
    echo ""
    echo -e "${BOLD}MCP Endpoint:${NC} https://${SERVER_HOST:-localhost}:${PORT}/mcp"
    echo -e "${BOLD}Health Check:${NC} http://localhost:${PORT}/health"
    echo -e "${BOLD}OAuth Start:${NC}  https://${SERVER_HOST:-localhost}:${PORT}/oauth/authorize"
    echo ""
    echo -e "${BOLD}ServiceNow OAuth Application Setup:${NC}"
    echo "-----------------------------------"
    echo "1. Navigate to: System OAuth > Application Registry"
    echo "2. Create new: 'Create an OAuth API endpoint for external clients'"
    echo "3. Configure:"
    echo "   - Name: ServiceNow MCP Server"
    echo "   - Redirect URL: ${REDIRECT_URI:-https://localhost:${PORT}/oauth/callback}"
    echo "   - Note the Client ID and Client Secret"
    echo "   - Ensure they match your .env file"
    echo ""
    echo -e "${BOLD}User Role Requirement:${NC}"
    echo "-----------------------------------"
    echo "Users need the 'snc_platform_rest_api_access' role to use REST APIs."
    echo "Without it, all API calls return 403 (if glide.rest.enable_role_based_access is true)."
    echo ""
    echo "Grant it per-user or via a group (e.g., 'MCP Users')."
    echo "This role only allows REST API access — record-level permissions are still"
    echo "governed by each user's existing ACLs and roles."
    echo ""
    echo -e "${BOLD}Claude Desktop Configuration:${NC}"
    echo '{'
    echo '  "mcpServers": {'
    echo '    "servicenow": {'
    echo '      "type": "streamablehttp",'
    echo "      \"url\": \"https://${SERVER_HOST:-localhost}:${PORT}/mcp\""
    echo '    }'
    echo '  }'
    echo '}'
    echo ""
}

# Main
install_docker
check_compose
generate_env
build_and_launch
wait_for_health
print_instructions

FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine

LABEL org.opencontainers.image.source="https://github.com/windoze95/servicewow-mcp"
LABEL org.opencontainers.image.description="ServiceNow MCP Server"
LABEL org.opencontainers.image.version="1.0.0"

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY --from=builder /app/dist/ ./dist/

RUN addgroup -S mcp && adduser -S mcp -G mcp
USER mcp

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]

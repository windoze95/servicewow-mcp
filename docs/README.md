# ServiceNow MCP Server — Documentation

Comprehensive documentation for the ServiceNow MCP Server: a secure, enterprise-ready MCP server that executes every action as the authenticated ServiceNow user.

---

## Getting Started

New to the project? Start here.

- [Prerequisites](./getting-started/prerequisites.md) — Node 22, Redis, ServiceNow instance
- [Local Development](./getting-started/local-development.md) — Install, configure, and run
- [ServiceNow OAuth Setup](./getting-started/servicenow-oauth-setup.md) — Create the OAuth app and assign roles
- [First Tool Call](./getting-started/first-tool-call.md) — End-to-end walkthrough: health check, OAuth, tool call

## Architecture

How the server is designed and how requests flow through it.

- [Overview](./architecture/README.md) — High-level diagram and module map
- [Project Structure](./architecture/project-structure.md) — `src/` directory layout
- [Session Lifecycle](./architecture/session-lifecycle.md) — Per-session McpServer and transport init
- [Request Flow](./architecture/request-flow.md) — POST /mcp through handler to response
- [Redis Schema](./architecture/redis-schema.md) — Key patterns, TTLs, and data shapes

## Authentication

Per-user OAuth 2.0 delegation and token management.

- [Overview](./auth/README.md) — Auth system design
- [OAuth Flow](./auth/oauth-flow.md) — Authorization Code flow with CSRF protection
- [Token Storage](./auth/token-storage.md) — AES-256-GCM encryption and StoredToken shape
- [Token Refresh](./auth/token-refresh.md) — Transparent refresh with distributed lock

## Security

Server-side protections and enforcement.

- [Overview](./security/README.md) — Security posture
- [Identity Enforcement](./security/identity-enforcement.md) — Per-tool caller/requester locking
- [Input Validation](./security/input-validation.md) — sys_id, number, state, and payload sanitization
- [Rate Limiting](./security/rate-limiting.md) — Token bucket via Redis Lua script
- [Error Handling](./security/error-handling.md) — ErrorCode enum and error normalization

## Tools (35)

All MCP tools grouped by domain.

- [Master Index](./tools/README.md) — All 35 tools at a glance
- [Incidents](./tools/incidents.md) — 5 tools
- [Change Requests](./tools/change-requests.md) — 6 tools
- [Users and Groups](./tools/users-and-groups.md) — 3 tools
- [Knowledge](./tools/knowledge.md) — 2 tools
- [Tasks and Approvals](./tools/tasks-and-approvals.md) — 3 tools
- [Catalog](./tools/catalog.md) — 3 tools
- [Catalog Administration](./tools/catalog-admin.md) — 11 tools
- [Update Sets](./tools/update-sets.md) — 2 tools

## Resources (5)

MCP resources for direct record access.

- [Overview](./resources/README.md) — What MCP resources are and how they work
  - `servicenow://me` — Current user profile
  - `servicenow://incident/{sys_id}` — Incident record
  - `servicenow://change_request/{sys_id}` — Change request record
  - `servicenow://kb_knowledge/{sys_id}` — Knowledge article
  - `servicenow://catalog/{sys_id}` — Catalog item

## Prompts (7)

MCP prompt templates for guided workflows.

- [Overview](./prompts/README.md) — What MCP prompts are
- [Build Catalog Form](./prompts/build-catalog-form.md) — End-to-end catalog item creation
- [Configure UI Policy](./prompts/configure-ui-policy.md) — Conditions and actions guide
- [Configure Client Script](./prompts/configure-client-script.md) — Script types and g_form API
- [Build Variable Set](./prompts/build-variable-set.md) — Set creation and attachment
- [Incident Triage](./prompts/incident-triage.md) — Classification, priority matrix, assignment
- [Change Request Planning](./prompts/change-request-planning.md) — Risk assessment, lifecycle management
- [Knowledge Article Authoring](./prompts/knowledge-article-authoring.md) — Templates and best practices

## HTTP API

Endpoints and client configuration.

- [Overview](./api/README.md) — HTTP API surface
- [Endpoints](./api/endpoints.md) — All 8 endpoints with request/response details
- [Client Configuration](./api/client-configuration.md) — Claude Desktop JSON config examples

## Deployment

Running in production.

- [Overview](./deployment/README.md) — Deployment options
- [Docker (Local)](./deployment/docker-local.md) — docker-compose.yml with local overlay
- [Docker (Caddy)](./deployment/docker-caddy.md) — Caddy auto-TLS overlay
- [Native TLS](./deployment/native-tls.md) — TLS_CERT_PATH / TLS_KEY_PATH
- [Setup Script](./deployment/setup-script.md) — setup.sh walkthrough
- [Environment Variables](./deployment/environment-variables.md) — Full configuration reference

## Development

Contributing and extending the server.

- [Overview](./development/README.md) — Contributing guide
- [Adding Tools](./development/adding-tools.md) — wrapHandler, ToolContext, registration
- [Testing](./development/testing.md) — Vitest, mocking patterns, coverage
- [CI Pipeline](./development/ci-pipeline.md) — GitHub Actions workflows

## Troubleshooting

- [Troubleshooting Guide](./troubleshooting/README.md) — Common issues and debug cheat sheet

# AI Agent Instructions

## Project Context
- This repository is a ServiceNow MCP server built with TypeScript + Node.js 22.
- It uses Express + Streamable HTTP transport, Redis-backed token/session storage, and OAuth 2.0 per-user delegation.
- Prioritize correctness and security over broad refactors.

## Architecture Highlights
- `src/index.ts`: process startup/shutdown wiring.
- `src/server.ts`: Express app, MCP routes, session lifecycle.
- `src/auth/*`: OAuth callback, encryption, token store, refresh logic, reconnect tokens.
- `src/tools/*`: MCP tool implementations grouped by domain.
- `src/middleware/*`: error normalization, rate limiting, session helpers.
- `src/servicenow/*`: API client and query building.

## Agent Priorities & Required Workflow
1. Match existing code patterns before proposing new abstractions.
2. Keep edits scoped to the user request.
3. Include tests for behavior changes.
4. Run validation commands before finishing.

## Implementation Guardrails
- Do not bypass identity enforcement logic in tools.
- Do not remove or weaken input validation (`sys_id`, enums, payload sanitization).
- Do not modify generated/runtime folders (`dist/`, `coverage/`, `node_modules/`).
- Do not add dependencies unless necessary.
- Never commit secrets or sample real credentials.
- Never log raw reconnect tokens; pino redact config guards this as defense-in-depth.

## Documentation
- Keep `README.md` aligned when adding or changing features, endpoints, config, or behavior — but keep it concise; delegate details to `docs/`.
- When adding tools, update `docs/tools/` with the new tool documentation.

## Validation Commands
- Build: `npm run build`
- Tests: `npm test`
- Coverage (when tests change): `npm run test:coverage`

## Testing Notes
- Use Vitest with focused unit tests.
- Mock ServiceNow, Redis, and MCP transport interactions.
- Keep coverage thresholds passing.

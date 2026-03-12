[docs](../README.md) / development

# Development

Guides for contributing to the ServiceNow MCP Server.

## Section Index

| Guide | Description |
|---|---|
| [Adding Tools](./adding-tools.md) | How to add a new MCP tool: wrapHandler, ToolContext, registration |
| [Testing](./testing.md) | Vitest setup, mocking patterns, coverage thresholds |
| [CI Pipeline](./ci-pipeline.md) | GitHub Actions workflows: test, build, Docker push |

## Quick Reference

```bash
# Install
npm install

# Dev server (hot reload)
npm run dev

# Build
npm run build

# Test
npm test

# Coverage
npm run test:coverage
```

## Code Style

- TypeScript with ES2022 target, NodeNext module resolution
- Named imports for ioredis: `import { Redis } from "ioredis"`
- Zod for all input validation
- Pino for structured logging (with redaction for sensitive fields)
- Express 5 with async route handlers

---

**See also**: [Project Structure](../architecture/project-structure.md) · [Getting Started](../getting-started/README.md) · [Testing](./testing.md)

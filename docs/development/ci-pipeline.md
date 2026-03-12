[docs](../README.md) / [development](./README.md) / ci-pipeline

# CI Pipeline

The project uses GitHub Actions for continuous integration and delivery.

## Workflows

### `ci.yml` — Build, Test, and Docker Push

**Triggers**: Push to `main`, pull requests targeting `main`.

#### `test` Job

Runs on every push and PR:

1. Checkout code
2. Setup Node.js 22 with npm cache
3. `npm ci` — install dependencies
4. `npm run build` — TypeScript compilation
5. `npm run test:coverage` — run tests with coverage thresholds

#### `changes` Job

Runs only on push to `main`. Uses `dorny/paths-filter` to detect if deployable files changed:
- `src/**`
- `Dockerfile`
- `package*.json`
- `tsconfig.json`

#### `docker` Job

Runs only on push to `main` when tests pass **and** deployable files changed:

1. Setup Docker Buildx
2. Login to GitHub Container Registry (`ghcr.io`)
3. Build and push Docker image with tags:
   - `ghcr.io/<owner>/servicewow-mcp:latest`
   - `ghcr.io/<owner>/servicewow-mcp:sha-<commit>`
4. Uses GitHub Actions cache for Docker layer caching

### `check-ai-instructions.yml` — AI Instruction Alignment

**Triggers**: Push/PR when `AGENTS.md`, `CLAUDE.md`, or `.github/copilot-instructions.md` change.

Verifies that all three AI instruction files are identical using `diff -q`. Fails if any file differs from `AGENTS.md`.

This ensures consistent instructions across Claude, Copilot, and other AI coding agents.

## Pull Request Checks

Every PR must pass:
- TypeScript build (`npm run build`)
- All tests with coverage (`npm run test:coverage`)
- AI instruction alignment (if those files changed)

## Local Pre-Flight

Before pushing, run:

```bash
npm run build && npm test
```

Or with coverage:

```bash
npm run build && npm run test:coverage
```

---

**See also**: [Testing](./testing.md) · [Adding Tools](./adding-tools.md) · [Deployment](../deployment/README.md)

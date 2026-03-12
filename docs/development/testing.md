[docs](../README.md) / [development](./README.md) / testing

# Testing

The project uses **Vitest** for unit testing with mocked external dependencies.

## Running Tests

```bash
# All tests
npm test

# With coverage
npm run test:coverage

# Watch mode
npx vitest --watch
```

## Test Structure

Tests live alongside source files or in `__tests__` directories:

```
src/
├── tools/__tests__/
│   ├── incidents.test.ts
│   ├── changeRequests.test.ts
│   ├── users.test.ts
│   ├── knowledge.test.ts
│   ├── tasks.test.ts
│   ├── catalog.test.ts
│   ├── catalogAdmin.test.ts
│   └── updateSets.test.ts
├── auth/__tests__/
│   ├── tokenStore.test.ts
│   ├── tokenRefresh.test.ts
│   ├── encryption.test.ts
│   └── reconnectToken.test.ts
├── middleware/__tests__/
│   ├── errorHandler.test.ts
│   └── rateLimiter.test.ts
└── server.test.ts
```

## Mocking Patterns

### ServiceNow API

Mock the `ServiceNowClient` to avoid real API calls:

```typescript
const mockSnClient = {
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
};
```

### Redis

Mock ioredis operations:

```typescript
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  eval: vi.fn(),
  // ... other operations as needed
};
```

### TokenStore

Mock the token store for tool tests:

```typescript
const mockTokenStore = {
  getToken: vi.fn(),
  storeToken: vi.fn(),
  // ...
};
```

### MCP Transport

For server-level tests, mock the MCP SDK transport interactions.

## Coverage

Coverage thresholds are configured in `vitest.config.ts`. The CI pipeline runs `npm run test:coverage` and fails if thresholds aren't met.

When adding new tools or modifying behavior, ensure:
- New code paths have test coverage
- Existing tests still pass
- Coverage thresholds are maintained

## Writing Good Tests

1. **Test behavior, not implementation**: Focus on what the tool returns, not how it builds queries
2. **Test error paths**: Verify that invalid inputs return appropriate error codes
3. **Test identity enforcement**: Verify that `caller_id`/`requester` fields are set correctly
4. **Test validation**: Verify sys_id, number format, and payload sanitization
5. **Keep tests focused**: One behavior per test case

---

**See also**: [Adding Tools](./adding-tools.md) · [CI Pipeline](./ci-pipeline.md) · [Error Handling](../security/error-handling.md)

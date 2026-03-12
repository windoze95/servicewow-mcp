[docs](../README.md) / [architecture](./README.md) / project-structure

# Project Structure

```
src/
├── index.ts                    # Process entry point, startup/shutdown wiring
├── server.ts                   # Express app, MCP routes, session lifecycle
├── config.ts                   # Zod-validated environment config
│
├── auth/
│   ├── oauth.ts                # MCP-spec OAuth provider, SN callback route
│   ├── tokenStore.ts           # Encrypted token CRUD, MCP token management
│   ├── tokenRefresh.ts         # Transparent token refresh with distributed lock
│   └── encryption.ts           # AES-256-GCM encrypt/decrypt primitives
│
├── tools/
│   ├── registry.ts             # Tool registration, ToolContext factory, wrapHandler
│   ├── incidents.ts            # search, get, create, update, add_work_note
│   ├── changeRequests.ts       # search, get, create, update, get_approvals, add_work_note
│   ├── users.ts                # lookup_user, lookup_group, get_my_profile
│   ├── knowledge.ts            # search_knowledge, get_article
│   ├── tasks.ts                # get_my_tasks, get_my_approvals, approve_or_reject
│   ├── catalog.ts              # search, get, submit_catalog_request
│   ├── catalogAdmin.ts         # 11 catalog admin tools
│   └── updateSets.ts           # change_update_set, create_update_set
│
├── prompts/
│   ├── catalog.ts              # 4 MCP prompt templates
│   └── README.md               # Prompt reference
│
├── middleware/
│   ├── errorHandler.ts         # ErrorCode enum, error normalization, SN error mapping
│   └── rateLimiter.ts          # Token bucket rate limiter (Redis Lua script)
│
├── servicenow/
│   ├── client.ts               # Authenticated Axios client for ServiceNow REST API
│   ├── queryBuilder.ts         # Encoded query builder with input sanitization
│   └── types.ts                # TypeScript interfaces for SN records
│
└── utils/
    ├── logger.ts               # Pino logger with redaction
    └── validators.ts           # sys_id, incident/change number, state, payload validation
```

## Key Entry Points

| File | Responsibility |
|---|---|
| `src/index.ts` | Loads config, connects Redis, creates the Express app, starts HTTP/HTTPS server, handles SIGTERM/SIGINT |
| `src/server.ts` | Configures Express middleware (helmet, CORS), mounts `/health`, `/oauth/*`, and `/mcp` routes, manages the per-session `Map<string, SessionEntry>` |
| `src/tools/registry.ts` | Creates `ToolContext` (authenticated ServiceNow client + user identity), wraps all tool handlers with error handling and logging |

## Module Dependency Flow

```
index.ts → config.ts → server.ts → auth/oauth.ts
                                  → tools/registry.ts → tools/*.ts
                                                      → auth/tokenRefresh.ts → auth/tokenStore.ts → auth/encryption.ts
                                                      → middleware/rateLimiter.ts
                                                      → middleware/errorHandler.ts
                                                      → servicenow/client.ts
```

---

**See also**: [Session Lifecycle](./session-lifecycle.md) · [Request Flow](./request-flow.md) · [Adding Tools](../development/adding-tools.md)

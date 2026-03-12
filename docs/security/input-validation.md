[docs](../README.md) / [security](./README.md) / input-validation

# Input Validation

All tool inputs are validated before reaching ServiceNow. Validation happens at two levels: Zod schemas (type/format) and custom validators (business rules).

## Zod Schema Validation

Every tool defines its parameters with Zod schemas. The MCP SDK validates inputs against these schemas before the handler executes. Invalid inputs never reach tool code.

```typescript
server.tool("get_incident", "...", {
  identifier: z.string().describe("Incident number or sys_id"),
}, handler);
```

## Custom Validators

Located in `src/utils/validators.ts`:

### `validateSysId(value: string): boolean`

Validates ServiceNow sys_id format: exactly 32 hexadecimal characters.

```typescript
const SYS_ID_REGEX = /^[0-9a-fA-F]{32}$/;
```

Used by nearly every tool that accepts a `sys_id` parameter. Returns a `VALIDATION_ERROR` if the format doesn't match.

### `validateIncidentNumber(value: string): boolean`

Validates incident number format: `INC` followed by 7+ digits.

```typescript
const INCIDENT_NUMBER_REGEX = /^INC\d{7,}$/;
```

### `validateChangeNumber(value: string): boolean`

Validates change request number format: `CHG` followed by 7+ digits.

```typescript
const CHANGE_NUMBER_REGEX = /^CHG\d{7,}$/;
```

### `validateState(state: string): boolean`

Validates against allowed incident states:

- String values: `New`, `In Progress`, `On Hold`, `Resolved`, `Closed`, `Canceled`
- Numeric equivalents: `1`, `2`, `3`, `6`, `7`, `8`

### `validatePriority(impact: number, urgency: number): number`

Validates impact and urgency are between 1 and 3, calculates priority as `impact + urgency - 1`.

## Payload Sanitization

### `sanitizeUpdatePayload(payload): Record<string, unknown>`

Strips read-only and audit fields from update payloads to prevent field injection:

```typescript
const READONLY_FIELDS = new Set([
  "sys_id",
  "sys_created_on",
  "sys_created_by",
  "sys_updated_on",
  "sys_updated_by",
  "sys_mod_count",
  "sys_class_name",
  "sys_domain",
  "sys_domain_path",
  "number",
  "opened_at",
  "opened_by",
]);
```

This is applied by `update_incident`, `update_change_request`, `update_catalog_item`, and `update_catalog_variable`.

## Validation Flow

```
Client args
    ↓
Zod schema (type, format, required)
    ↓
Custom validators (sys_id, number, state)
    ↓
sanitizeUpdatePayload (strip readonly fields)
    ↓
ServiceNow API call
```

---

**See also**: [Identity Enforcement](./identity-enforcement.md) · [Error Handling](./error-handling.md) · [Tools Overview](../tools/README.md)

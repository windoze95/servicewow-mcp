[docs](../README.md) / [auth](./README.md) / token-storage

# Token Storage

OAuth tokens are encrypted at rest in Redis using AES-256-GCM.

## StoredToken Shape

```typescript
interface StoredToken {
  access_token: string;     // ServiceNow OAuth access token
  refresh_token: string;    // ServiceNow OAuth refresh token
  expires_at: number;       // Unix timestamp (seconds) when access_token expires
  user_sys_id: string;      // ServiceNow user sys_id
  user_name: string;        // e.g., "jane.smith"
  display_name: string;     // e.g., "Jane Smith"
}
```

## Encryption

### Algorithm

- **AES-256-GCM** (authenticated encryption with associated data)
- 12-byte random IV per encryption
- 16-byte authentication tag

### Key

- `TOKEN_ENCRYPTION_KEY` environment variable
- Must be a base64-encoded 32-byte (256-bit) key
- Generate with: `npm run generate-key` or `openssl rand -base64 32`

### Wire Format

Stored as: `base64(iv || authTag || ciphertext)`

```
┌─────────┬──────────┬────────────┐
│ IV (12B) │ Tag (16B) │ Ciphertext │
└─────────┴──────────┴────────────┘
              ↕ base64 encode/decode
         Redis string value
```

### Encrypt

```typescript
function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}
```

### Decrypt

Reverses the process: splits the base64 blob into IV, auth tag, and ciphertext, then decrypts and verifies authenticity. If the auth tag doesn't match (tampered data), decryption fails and the corrupted token is deleted from Redis.

## Redis Key

```
token:<user_sys_id>  →  base64(encrypted blob)   TTL: 8,640,000s (100 days)
```

See [Redis Schema](../architecture/redis-schema.md) for all key patterns.

## Operations

| Method | Description |
|---|---|
| `storeToken(token)` | Encrypts and stores a `StoredToken` |
| `getToken(userSysId)` | Retrieves and decrypts; returns `null` and deletes on corruption |
| `updateToken(userSysId, updates)` | Merges updates into existing token, re-encrypts |
| `deleteToken(userSysId)` | Removes the token from Redis |

## Security Properties

- **Unique IV per write**: Every `storeToken` call generates a fresh random IV, even for the same user
- **Authenticated encryption**: GCM mode detects tampering via the auth tag
- **Automatic cleanup**: Failed decryption (corruption or wrong key) deletes the stored blob
- **No plaintext logging**: Token values are never logged; pino redact config provides defense-in-depth

---

**See also**: [OAuth Flow](./oauth-flow.md) · [Token Refresh](./token-refresh.md) · [Redis Schema](../architecture/redis-schema.md)

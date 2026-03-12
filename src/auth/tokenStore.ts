import { Redis } from "ioredis";
import { encrypt, decrypt, getEncryptionKey } from "./encryption.js";
import { logger } from "../utils/logger.js";

export interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp seconds
  user_sys_id: string;
  user_name: string;
  display_name: string;
}

export interface PendingAuthData {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  scopes?: string[];
}

export interface SnStateData {
  pendingAuthId: string;
}

export interface AuthCodeData {
  userSysId: string;
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  scopes: string[];
}

export interface McpTokenData {
  userSysId: string;
  clientId: string;
  scopes: string[];
  expiresAt: number; // Unix timestamp seconds
}

export interface McpRefreshData {
  userSysId: string;
  clientId: string;
  scopes: string[];
}

/** Session TTL for reconnect-token sessions (7 days) vs default 24h. */
export const RECONNECT_SESSION_TTL = 604800;

export function createRedisClient(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
  });
}

export class TokenStore {
  private redis: Redis;
  private encryptionKey: Buffer;

  constructor(redis: Redis, encryptionKeyBase64: string) {
    this.redis = redis;
    this.encryptionKey = getEncryptionKey(encryptionKeyBase64);
  }

  async storeToken(token: StoredToken): Promise<void> {
    const key = `token:${token.user_sys_id}`;
    const encrypted = encrypt(JSON.stringify(token), this.encryptionKey);
    // TTL based on refresh token lifespan (100 days default)
    const ttl = 8640000;
    await this.redis.set(key, encrypted, "EX", ttl);
    logger.debug({ userSysId: token.user_sys_id }, "Token stored");
  }

  async getToken(userSysId: string): Promise<StoredToken | null> {
    const key = `token:${userSysId}`;
    const encrypted = await this.redis.get(key);
    if (!encrypted) return null;

    try {
      const decrypted = decrypt(encrypted, this.encryptionKey);
      return JSON.parse(decrypted) as StoredToken;
    } catch (err) {
      logger.error({ err, userSysId }, "Failed to decrypt token");
      await this.redis.del(key);
      return null;
    }
  }

  async deleteToken(userSysId: string): Promise<void> {
    await this.redis.del(`token:${userSysId}`);
    logger.debug({ userSysId }, "Token deleted");
  }

  async updateToken(
    userSysId: string,
    updates: Partial<StoredToken>
  ): Promise<StoredToken | null> {
    const existing = await this.getToken(userSysId);
    if (!existing) return null;

    const updated = { ...existing, ...updates };
    await this.storeToken(updated);
    return updated;
  }

  async storeSessionMapping(
    sessionId: string,
    userSysId: string
  ): Promise<void> {
    const key = `session:${sessionId}`;
    // Session mappings expire after 24 hours
    await this.redis.set(key, userSysId, "EX", 86400);
    logger.debug({ sessionId, userSysId }, "Session mapping stored");
  }

  async getUserForSession(sessionId: string): Promise<string | null> {
    const key = `session:${sessionId}`;
    return this.redis.get(key);
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.del(`session:${sessionId}`);
  }

  async storeSessionMappingWithTTL(
    sessionId: string,
    userSysId: string,
    ttlSeconds: number
  ): Promise<void> {
    const key = `session:${sessionId}`;
    await this.redis.set(key, userSysId, "EX", ttlSeconds);
    logger.debug({ sessionId, userSysId }, "Session mapping stored with custom TTL");
  }

  async storeReconnectToken(
    token: string,
    userSysId: string,
    ttlSeconds: number
  ): Promise<void> {
    const key = `reconnect:${token}`;
    const indexKey = `reconnect_index:${userSysId}`;
    await this.redis.set(key, userSysId, "EX", ttlSeconds);
    await this.redis.sadd(indexKey, token);
    await this.redis.expire(indexKey, ttlSeconds);
    logger.debug({ userSysId }, "Reconnect token stored");
  }

  async getUserForReconnectToken(token: string): Promise<string | null> {
    const key = `reconnect:${token}`;
    return this.redis.get(key);
  }

  async refreshReconnectTokenTTL(
    token: string,
    userSysId: string,
    ttlSeconds: number
  ): Promise<void> {
    await this.redis.expire(`reconnect:${token}`, ttlSeconds);
    await this.redis.expire(`reconnect_index:${userSysId}`, ttlSeconds);
    logger.debug({ userSysId }, "Reconnect token TTL refreshed");
  }

  async revokeReconnectToken(
    token: string,
    userSysId: string
  ): Promise<void> {
    await this.redis.del(`reconnect:${token}`);
    await this.redis.srem(`reconnect_index:${userSysId}`, token);
    logger.debug({ userSysId }, "Reconnect token revoked");
  }

  async revokeAllReconnectTokens(userSysId: string): Promise<void> {
    const indexKey = `reconnect_index:${userSysId}`;
    const tokens = await this.redis.smembers(indexKey);
    if (tokens.length > 0) {
      const keys = tokens.map((t) => `reconnect:${t}`);
      await this.redis.del(...keys);
    }
    await this.redis.del(indexKey);
    logger.debug({ userSysId }, "All reconnect tokens revoked");
  }

  async storeOAuthState(
    state: string,
    data: { sessionId?: string; redirectUri?: string }
  ): Promise<void> {
    const key = `oauth_state:${state}`;
    await this.redis.set(key, JSON.stringify(data), "EX", 600); // 10 min TTL
  }

  async getOAuthState(
    state: string
  ): Promise<{ sessionId?: string; redirectUri?: string } | null> {
    const key = `oauth_state:${state}`;
    const data = await this.redis.get(key);
    if (!data) return null;
    await this.redis.del(key); // one-time use
    return JSON.parse(data);
  }

  // --- MCP OAuth SDK support ---

  async storePendingAuth(id: string, data: PendingAuthData, ttlSeconds: number): Promise<void> {
    const key = `pending_auth:${id}`;
    await this.redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
  }

  async getPendingAuth(id: string): Promise<PendingAuthData | null> {
    const key = `pending_auth:${id}`;
    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async deletePendingAuth(id: string): Promise<void> {
    await this.redis.del(`pending_auth:${id}`);
  }

  async storeSnState(state: string, data: SnStateData, ttlSeconds: number): Promise<void> {
    const key = `sn_state:${state}`;
    await this.redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
  }

  async getSnState(state: string): Promise<SnStateData | null> {
    const key = `sn_state:${state}`;
    const raw = await this.redis.get(key);
    if (!raw) return null;
    await this.redis.del(key); // one-time use
    return JSON.parse(raw);
  }

  async storeAuthCode(code: string, data: AuthCodeData, ttlSeconds: number): Promise<void> {
    const key = `auth_code:${code}`;
    await this.redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
  }

  async getAuthCode(code: string): Promise<AuthCodeData | null> {
    const key = `auth_code:${code}`;
    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async deleteAuthCode(code: string): Promise<void> {
    await this.redis.del(`auth_code:${code}`);
  }

  async storeMcpToken(token: string, data: McpTokenData, ttlSeconds: number): Promise<void> {
    const key = `mcp_token:${token}`;
    await this.redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
  }

  async getMcpToken(token: string): Promise<McpTokenData | null> {
    const key = `mcp_token:${token}`;
    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async deleteMcpToken(token: string): Promise<void> {
    await this.redis.del(`mcp_token:${token}`);
  }

  async storeMcpRefreshToken(token: string, data: McpRefreshData, ttlSeconds: number): Promise<void> {
    const key = `mcp_refresh:${token}`;
    await this.redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
  }

  async getMcpRefreshToken(token: string): Promise<McpRefreshData | null> {
    const key = `mcp_refresh:${token}`;
    const raw = await this.redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async deleteMcpRefreshToken(token: string): Promise<void> {
    await this.redis.del(`mcp_refresh:${token}`);
  }

  async storeOAuthClient(clientId: string, data: string, ttlSeconds: number): Promise<void> {
    const key = `oauth_client:${clientId}`;
    await this.redis.set(key, data, "EX", ttlSeconds);
  }

  async getOAuthClient(clientId: string): Promise<string | null> {
    const key = `oauth_client:${clientId}`;
    return this.redis.get(key);
  }
}

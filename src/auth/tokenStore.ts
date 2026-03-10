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
}

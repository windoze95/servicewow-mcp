import axios from "axios";
import crypto from "node:crypto";
import type { Redis } from "ioredis";
import { TokenStore, type StoredToken } from "./tokenStore.js";
import { type Config } from "../config.js";
import { logger } from "../utils/logger.js";

const REFRESH_BUFFER_SECONDS = 60;
const LOCK_TTL_SECONDS = 10;

export class TokenRefresher {
  constructor(
    private config: Config,
    private tokenStore: TokenStore,
    private redis: Redis
  ) {}

  async ensureFreshToken(userSysId: string): Promise<StoredToken> {
    const token = await this.tokenStore.getToken(userSysId);
    if (!token) {
      throw new AuthRequiredError(userSysId);
    }

    const now = Math.floor(Date.now() / 1000);
    if (token.expires_at - now > REFRESH_BUFFER_SECONDS) {
      return token; // Still valid
    }

    // Token is expired or about to expire — refresh
    return this.refreshWithLock(userSysId, token);
  }

  private async refreshWithLock(
    userSysId: string,
    token: StoredToken
  ): Promise<StoredToken> {
    const lockKey = `token_refresh_lock:${userSysId}`;
    const lockValue = crypto.randomUUID();

    // Try to acquire lock with unique value
    const acquired = await this.redis.set(
      lockKey,
      lockValue,
      "EX",
      LOCK_TTL_SECONDS,
      "NX"
    );

    if (!acquired) {
      // Another request is refreshing — wait briefly and re-read
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const refreshed = await this.tokenStore.getToken(userSysId);
      if (refreshed) return refreshed;
      throw new AuthRequiredError(userSysId);
    }

    try {
      // Double-check after acquiring lock (another request may have refreshed)
      const current = await this.tokenStore.getToken(userSysId);
      if (current && current.expires_at - Math.floor(Date.now() / 1000) > REFRESH_BUFFER_SECONDS) {
        return current;
      }

      logger.info({ userSysId }, "Refreshing access token");

      const response = await axios.post(
        `${this.config.SERVICENOW_INSTANCE_URL}/oauth_token.do`,
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: this.config.SERVICENOW_CLIENT_ID,
          client_secret: this.config.SERVICENOW_CLIENT_SECRET,
          refresh_token: token.refresh_token,
        }).toString(),
        {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        }
      );

      const { access_token, refresh_token, expires_in } = response.data;

      const updated: StoredToken = {
        ...token,
        access_token,
        refresh_token: refresh_token || token.refresh_token,
        expires_at: Math.floor(Date.now() / 1000) + (expires_in || 1800),
      };

      await this.tokenStore.storeToken(updated);
      logger.info({ userSysId }, "Token refreshed successfully");

      return updated;
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number } };
      logger.error({ err, userSysId }, "Token refresh failed");

      // If refresh token is invalid, delete stored tokens
      if (axiosErr.response?.status === 401 || axiosErr.response?.status === 400) {
        await this.tokenStore.deleteToken(userSysId);
        throw new AuthRequiredError(userSysId);
      }

      throw err;
    } finally {
      // Only delete the lock if we still own it (compare-and-delete)
      await this.redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`,
        1,
        lockKey,
        lockValue
      );
    }
  }
}

export class AuthRequiredError extends Error {
  public readonly code = "AUTH_REQUIRED";

  constructor(public readonly userSysId?: string) {
    super("Authentication required");
    this.name = "AuthRequiredError";
  }
}

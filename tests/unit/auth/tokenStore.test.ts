import { describe, it, expect, vi, beforeEach } from "vitest";
import { TokenStore, type StoredToken } from "../../../src/auth/tokenStore.js";
import crypto from "node:crypto";

// Mock Redis
const mockRedis = {
  set: vi.fn().mockResolvedValue("OK"),
  get: vi.fn().mockResolvedValue(null),
  del: vi.fn().mockResolvedValue(1),
};

const TEST_KEY = crypto.randomBytes(32).toString("base64");

describe("TokenStore", () => {
  let store: TokenStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new TokenStore(mockRedis as any, TEST_KEY);
  });

  const testToken: StoredToken = {
    access_token: "access_123",
    refresh_token: "refresh_456",
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user_sys_id: "abc123def456abc123def456abc12345",
    user_name: "john.doe",
    display_name: "John Doe",
  };

  it("should store and retrieve a token", async () => {
    let storedValue: string | null = null;

    mockRedis.set.mockImplementation(
      async (_key: string, value: string) => {
        storedValue = value;
        return "OK";
      }
    );

    mockRedis.get.mockImplementation(async () => storedValue);

    await store.storeToken(testToken);
    expect(mockRedis.set).toHaveBeenCalledWith(
      `token:${testToken.user_sys_id}`,
      expect.any(String),
      "EX",
      8640000
    );

    const retrieved = await store.getToken(testToken.user_sys_id);
    expect(retrieved).toEqual(testToken);
  });

  it("should return null for non-existent token", async () => {
    mockRedis.get.mockResolvedValue(null);

    const result = await store.getToken("nonexistent");
    expect(result).toBeNull();
  });

  it("should delete a token", async () => {
    await store.deleteToken(testToken.user_sys_id);
    expect(mockRedis.del).toHaveBeenCalledWith(
      `token:${testToken.user_sys_id}`
    );
  });

  it("should store and retrieve session mappings", async () => {
    let storedValue: string | null = null;
    mockRedis.set.mockImplementation(
      async (_key: string, value: string) => {
        storedValue = value;
        return "OK";
      }
    );
    mockRedis.get.mockImplementation(async () => storedValue);

    await store.storeSessionMapping("session-123", "user-456");
    expect(mockRedis.set).toHaveBeenCalledWith(
      "session:session-123",
      "user-456",
      "EX",
      86400
    );

    const userId = await store.getUserForSession("session-123");
    expect(userId).toBe("user-456");
  });

  it("should store and retrieve OAuth state (one-time use)", async () => {
    let storedValue: string | null = null;
    mockRedis.set.mockImplementation(
      async (_key: string, value: string) => {
        storedValue = value;
        return "OK";
      }
    );
    mockRedis.get.mockImplementation(async () => {
      const val = storedValue;
      storedValue = null; // Simulate one-time use
      return val;
    });
    mockRedis.del.mockResolvedValue(1);

    const stateData = { sessionId: "sess-1" };
    await store.storeOAuthState("state-abc", stateData);

    const retrieved = await store.getOAuthState("state-abc");
    expect(retrieved).toEqual(stateData);

    // Second retrieval should return null (one-time use)
    const second = await store.getOAuthState("state-abc");
    expect(second).toBeNull();
  });
});

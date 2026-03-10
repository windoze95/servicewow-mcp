import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { TokenStore } from "../../../src/auth/tokenStore.js";
import { createOAuthRouter } from "../../../src/auth/oauth.js";

// --- TokenStore reconnect method tests (mock Redis) ---

const mockRedis = {
  set: vi.fn().mockResolvedValue("OK"),
  get: vi.fn().mockResolvedValue(null),
  del: vi.fn().mockResolvedValue(1),
  sadd: vi.fn().mockResolvedValue(1),
  srem: vi.fn().mockResolvedValue(1),
  expire: vi.fn().mockResolvedValue(1),
  smembers: vi.fn().mockResolvedValue([]),
};

const TEST_KEY = crypto.randomBytes(32).toString("base64");

describe("TokenStore reconnect methods", () => {
  let store: TokenStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new TokenStore(mockRedis as any, TEST_KEY);
  });

  it("storeReconnectToken writes key with TTL and adds to index set", async () => {
    await store.storeReconnectToken("tok123", "user-1", 8640000);

    expect(mockRedis.set).toHaveBeenCalledWith(
      "reconnect:tok123",
      "user-1",
      "EX",
      8640000
    );
    expect(mockRedis.sadd).toHaveBeenCalledWith("reconnect_index:user-1", "tok123");
    expect(mockRedis.expire).toHaveBeenCalledWith("reconnect_index:user-1", 8640000);
  });

  it("getUserForReconnectToken returns user or null", async () => {
    mockRedis.get.mockResolvedValueOnce("user-1");
    const result = await store.getUserForReconnectToken("tok123");
    expect(result).toBe("user-1");
    expect(mockRedis.get).toHaveBeenCalledWith("reconnect:tok123");

    mockRedis.get.mockResolvedValueOnce(null);
    const missing = await store.getUserForReconnectToken("bad");
    expect(missing).toBeNull();
  });

  it("revokeReconnectToken deletes key and removes from index", async () => {
    await store.revokeReconnectToken("tok123", "user-1");

    expect(mockRedis.del).toHaveBeenCalledWith("reconnect:tok123");
    expect(mockRedis.srem).toHaveBeenCalledWith("reconnect_index:user-1", "tok123");
  });

  it("revokeAllReconnectTokens deletes all keys and the index", async () => {
    mockRedis.smembers.mockResolvedValueOnce(["tok1", "tok2"]);

    await store.revokeAllReconnectTokens("user-1");

    expect(mockRedis.smembers).toHaveBeenCalledWith("reconnect_index:user-1");
    expect(mockRedis.del).toHaveBeenCalledWith("reconnect:tok1", "reconnect:tok2");
    expect(mockRedis.del).toHaveBeenCalledWith("reconnect_index:user-1");
  });

  it("revokeAllReconnectTokens handles empty set gracefully", async () => {
    mockRedis.smembers.mockResolvedValueOnce([]);

    await store.revokeAllReconnectTokens("user-1");

    // Should only delete the index key, not call del with token keys
    expect(mockRedis.del).toHaveBeenCalledTimes(1);
    expect(mockRedis.del).toHaveBeenCalledWith("reconnect_index:user-1");
  });

  it("refreshReconnectTokenTTL resets expiry on token and index keys", async () => {
    await store.refreshReconnectTokenTTL("tok123", "user-1", 8640000);

    expect(mockRedis.expire).toHaveBeenCalledWith("reconnect:tok123", 8640000);
    expect(mockRedis.expire).toHaveBeenCalledWith("reconnect_index:user-1", 8640000);
  });

  it("storeSessionMappingWithTTL writes session with custom TTL", async () => {
    await store.storeSessionMappingWithTTL("sess-1", "user-1", 604800);

    expect(mockRedis.set).toHaveBeenCalledWith(
      "session:sess-1",
      "user-1",
      "EX",
      604800
    );
  });
});

// --- OAuth reconnect-token endpoint tests ---

const axiosMocks = vi.hoisted(() => ({
  post: vi.fn(),
  get: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    post: axiosMocks.post,
    get: axiosMocks.get,
  },
}));

describe("OAuth reconnect-token endpoints", () => {
  const tokenStore = {
    storeOAuthState: vi.fn(),
    getOAuthState: vi.fn(),
    storeToken: vi.fn(),
    storeSessionMapping: vi.fn(),
    getToken: vi.fn(),
    storeReconnectToken: vi.fn(),
    getUserForReconnectToken: vi.fn(),
    revokeReconnectToken: vi.fn(),
    revokeAllReconnectTokens: vi.fn(),
  };

  const config = {
    SERVICENOW_INSTANCE_URL: "https://example.service-now.com",
    SERVICENOW_CLIENT_ID: "client-id",
    SERVICENOW_CLIENT_SECRET: "client-secret",
    OAUTH_REDIRECT_URI: "http://localhost:3001/oauth/callback",
    RECONNECT_TOKEN_TTL: 8640000,
  };

  function createTestApp() {
    const app = express();
    app.use("/oauth", createOAuthRouter(config as any, tokenStore as any));
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /oauth/reconnect-token returns 400 without user_sys_id", async () => {
    const app = createTestApp();

    const response = await request(app)
      .post("/oauth/reconnect-token")
      .send({})
      .expect(400);

    expect(response.body.error.code).toBe("INVALID_REQUEST");
  });

  it("POST /oauth/reconnect-token returns 404 when user has no credentials", async () => {
    tokenStore.getToken.mockResolvedValueOnce(null);
    const app = createTestApp();

    const response = await request(app)
      .post("/oauth/reconnect-token")
      .send({ user_sys_id: "user-1" })
      .expect(404);

    expect(response.body.error.code).toBe("NO_CREDENTIALS");
  });

  it("POST /oauth/reconnect-token generates token on success", async () => {
    tokenStore.getToken.mockResolvedValueOnce({ access_token: "at" });
    tokenStore.storeReconnectToken.mockResolvedValueOnce(undefined);
    const app = createTestApp();

    const response = await request(app)
      .post("/oauth/reconnect-token")
      .send({ user_sys_id: "user-1" })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.reconnect_token).toHaveLength(64); // 32 bytes hex
    expect(response.body.ttl_seconds).toBe(8640000);
    expect(tokenStore.storeReconnectToken).toHaveBeenCalledWith(
      expect.any(String),
      "user-1",
      8640000
    );
  });

  it("DELETE /oauth/reconnect-token revokes a specific token", async () => {
    tokenStore.revokeReconnectToken.mockResolvedValueOnce(undefined);
    const app = createTestApp();

    const response = await request(app)
      .delete("/oauth/reconnect-token")
      .send({ user_sys_id: "user-1", reconnect_token: "tok123" })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(tokenStore.revokeReconnectToken).toHaveBeenCalledWith("tok123", "user-1");
  });

  it("DELETE /oauth/reconnect-token revokes all when revoke_all is true", async () => {
    tokenStore.revokeAllReconnectTokens.mockResolvedValueOnce(undefined);
    const app = createTestApp();

    const response = await request(app)
      .delete("/oauth/reconnect-token")
      .send({ user_sys_id: "user-1", revoke_all: true })
      .expect(200);

    expect(response.body.message).toContain("All");
    expect(tokenStore.revokeAllReconnectTokens).toHaveBeenCalledWith("user-1");
  });

  it("DELETE /oauth/reconnect-token returns 400 without user_sys_id", async () => {
    const app = createTestApp();

    const response = await request(app)
      .delete("/oauth/reconnect-token")
      .send({})
      .expect(400);

    expect(response.body.error.code).toBe("INVALID_REQUEST");
  });

  it("DELETE /oauth/reconnect-token returns 400 without token or revoke_all", async () => {
    const app = createTestApp();

    const response = await request(app)
      .delete("/oauth/reconnect-token")
      .send({ user_sys_id: "user-1" })
      .expect(400);

    expect(response.body.error.code).toBe("INVALID_REQUEST");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { TokenStore } from "../../../src/auth/tokenStore.js";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../src/auth/encryption.js", () => ({
  getEncryptionKey: () => Buffer.alloc(32, 1),
  encrypt: (text: string) => Buffer.from(text).toString("base64"),
  decrypt: (text: string) => Buffer.from(text, "base64").toString("utf8"),
}));

describe("TokenStore — MCP OAuth methods", () => {
  const mockRedis = {
    set: vi.fn().mockResolvedValue("OK"),
    get: vi.fn().mockResolvedValue(null),
    getdel: vi.fn().mockResolvedValue(null),
    del: vi.fn().mockResolvedValue(1),
  };

  let store: TokenStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new TokenStore(mockRedis as any, Buffer.alloc(32, 1).toString("base64"));
  });

  describe("pending auth", () => {
    it("stores and retrieves pending auth data", async () => {
      const data = {
        clientId: "c1",
        redirectUri: "http://localhost/cb",
        codeChallenge: "ch",
        state: "st",
        scopes: ["read"],
      };

      await store.storePendingAuth("pa-1", data, 600);
      expect(mockRedis.set).toHaveBeenCalledWith(
        "pending_auth:pa-1",
        JSON.stringify(data),
        "EX",
        600
      );

      mockRedis.get.mockResolvedValueOnce(JSON.stringify(data));
      const result = await store.getPendingAuth("pa-1");
      expect(result).toEqual(data);
    });

    it("returns null for missing pending auth", async () => {
      const result = await store.getPendingAuth("missing");
      expect(result).toBeNull();
    });

    it("deletes pending auth", async () => {
      await store.deletePendingAuth("pa-1");
      expect(mockRedis.del).toHaveBeenCalledWith("pending_auth:pa-1");
    });
  });

  describe("SN state", () => {
    it("stores and atomically consumes SN state (one-time use)", async () => {
      const data = { pendingAuthId: "pa-1" };

      await store.storeSnState("state-1", data, 600);
      expect(mockRedis.set).toHaveBeenCalledWith(
        "sn_state:state-1",
        JSON.stringify(data),
        "EX",
        600
      );

      mockRedis.getdel.mockResolvedValueOnce(JSON.stringify(data));
      const result = await store.getSnState("state-1");
      expect(result).toEqual(data);
      expect(mockRedis.getdel).toHaveBeenCalledWith("sn_state:state-1");
    });
  });

  describe("auth code", () => {
    const data = {
      userSysId: "u1",
      clientId: "c1",
      codeChallenge: "ch",
      redirectUri: "http://localhost",
      scopes: ["read"],
    };

    it("stores, retrieves, and deletes auth codes", async () => {
      await store.storeAuthCode("code-1", data, 300);
      expect(mockRedis.set).toHaveBeenCalledWith(
        "auth_code:code-1",
        JSON.stringify(data),
        "EX",
        300
      );

      mockRedis.get.mockResolvedValueOnce(JSON.stringify(data));
      const result = await store.getAuthCode("code-1");
      expect(result).toEqual(data);

      await store.deleteAuthCode("code-1");
      expect(mockRedis.del).toHaveBeenCalledWith("auth_code:code-1");
    });

    it("atomically consumes auth code via consumeAuthCode", async () => {
      mockRedis.getdel.mockResolvedValueOnce(JSON.stringify(data));
      const result = await store.consumeAuthCode("code-1");
      expect(result).toEqual(data);
      expect(mockRedis.getdel).toHaveBeenCalledWith("auth_code:code-1");
    });

    it("returns null from consumeAuthCode when code does not exist", async () => {
      mockRedis.getdel.mockResolvedValueOnce(null);
      const result = await store.consumeAuthCode("missing");
      expect(result).toBeNull();
    });
  });

  describe("MCP token", () => {
    it("stores, retrieves, and deletes MCP tokens", async () => {
      const data = {
        userSysId: "u1",
        clientId: "c1",
        scopes: ["read"],
        expiresAt: 1700001800,
      };

      await store.storeMcpToken("tok-1", data, 3600);
      expect(mockRedis.set).toHaveBeenCalledWith(
        "mcp_token:tok-1",
        JSON.stringify(data),
        "EX",
        3600
      );

      mockRedis.get.mockResolvedValueOnce(JSON.stringify(data));
      const result = await store.getMcpToken("tok-1");
      expect(result).toEqual(data);

      await store.deleteMcpToken("tok-1");
      expect(mockRedis.del).toHaveBeenCalledWith("mcp_token:tok-1");
    });
  });

  describe("MCP refresh token", () => {
    it("stores, retrieves, and deletes MCP refresh tokens", async () => {
      const data = {
        userSysId: "u1",
        clientId: "c1",
        scopes: ["read"],
      };

      await store.storeMcpRefreshToken("ref-1", data, 2592000);
      expect(mockRedis.set).toHaveBeenCalledWith(
        "mcp_refresh:ref-1",
        JSON.stringify(data),
        "EX",
        2592000
      );

      mockRedis.get.mockResolvedValueOnce(JSON.stringify(data));
      const result = await store.getMcpRefreshToken("ref-1");
      expect(result).toEqual(data);

      await store.deleteMcpRefreshToken("ref-1");
      expect(mockRedis.del).toHaveBeenCalledWith("mcp_refresh:ref-1");
    });
  });

  describe("OAuth client", () => {
    it("stores and retrieves OAuth client data", async () => {
      const data = JSON.stringify({ client_id: "c1", client_secret: "sec" });

      await store.storeOAuthClient("c1", data, 7776000);
      expect(mockRedis.set).toHaveBeenCalledWith(
        "oauth_client:c1",
        data,
        "EX",
        7776000
      );

      mockRedis.get.mockResolvedValueOnce(data);
      const result = await store.getOAuthClient("c1");
      expect(result).toBe(data);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { ServiceNowOAuthProvider } from "../../../src/auth/oauthProvider.js";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("ServiceNowOAuthProvider", () => {
  const tokenStore = {
    storePendingAuth: vi.fn().mockResolvedValue(undefined),
    getPendingAuth: vi.fn(),
    deletePendingAuth: vi.fn().mockResolvedValue(undefined),
    storeSnState: vi.fn().mockResolvedValue(undefined),
    getSnState: vi.fn(),
    storeAuthCode: vi.fn().mockResolvedValue(undefined),
    getAuthCode: vi.fn(),
    consumeAuthCode: vi.fn(),
    deleteAuthCode: vi.fn().mockResolvedValue(undefined),
    storeMcpToken: vi.fn().mockResolvedValue(undefined),
    getMcpToken: vi.fn(),
    deleteMcpToken: vi.fn().mockResolvedValue(undefined),
    storeMcpRefreshToken: vi.fn().mockResolvedValue(undefined),
    getMcpRefreshToken: vi.fn(),
    deleteMcpRefreshToken: vi.fn().mockResolvedValue(undefined),
    getToken: vi.fn(),
    getOAuthClient: vi.fn(),
    storeOAuthClient: vi.fn(),
  };

  const config = {
    SERVICENOW_INSTANCE_URL: "https://example.service-now.com",
    SERVICENOW_CLIENT_ID: "sn-client-id",
    SN_CALLBACK_URI: "http://localhost:8080/oauth/sn-callback",
  };

  let provider: ServiceNowOAuthProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    provider = new ServiceNowOAuthProvider(config as any, tokenStore as any);
  });

  describe("authorize", () => {
    it("stores pending auth and redirects to ServiceNow", async () => {
      const mockRes = { redirect: vi.fn() };
      const client = { client_id: "test-client" } as any;
      const params = {
        redirectUri: "http://client/callback",
        codeChallenge: "challenge123",
        state: "client-state",
        scopes: ["read"],
      };

      await provider.authorize(client, params, mockRes as any);

      expect(tokenStore.storePendingAuth).toHaveBeenCalledWith(
        expect.any(String),
        {
          clientId: "test-client",
          redirectUri: "http://client/callback",
          codeChallenge: "challenge123",
          state: "client-state",
          scopes: ["read"],
        },
        600
      );

      expect(tokenStore.storeSnState).toHaveBeenCalledWith(
        expect.any(String),
        { pendingAuthId: expect.any(String) },
        600
      );

      expect(mockRes.redirect).toHaveBeenCalledWith(
        expect.stringContaining("https://example.service-now.com/oauth_auth.do?")
      );
      const redirectUrl = mockRes.redirect.mock.calls[0][0] as string;
      expect(redirectUrl).toContain("client_id=sn-client-id");
      expect(redirectUrl).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Foauth%2Fsn-callback");
    });
  });

  describe("challengeForAuthorizationCode", () => {
    it("returns stored code challenge", async () => {
      tokenStore.getAuthCode.mockResolvedValue({
        codeChallenge: "stored-challenge",
        userSysId: "user-1",
        clientId: "client-1",
        redirectUri: "http://localhost",
        scopes: [],
      });

      const challenge = await provider.challengeForAuthorizationCode(
        {} as any,
        "auth-code-123"
      );

      expect(challenge).toBe("stored-challenge");
    });

    it("throws when auth code not found", async () => {
      tokenStore.getAuthCode.mockResolvedValue(null);

      await expect(
        provider.challengeForAuthorizationCode({} as any, "bad-code")
      ).rejects.toThrow("Authorization code not found or expired");
    });
  });

  describe("exchangeAuthorizationCode", () => {
    const matchingClient = { client_id: "client-1" } as any;

    it("atomically consumes auth code and returns MCP tokens", async () => {
      tokenStore.consumeAuthCode.mockResolvedValue({
        userSysId: "user-abc",
        clientId: "client-1",
        codeChallenge: "challenge",
        redirectUri: "http://localhost",
        scopes: ["read"],
      });

      const tokens = await provider.exchangeAuthorizationCode(
        matchingClient,
        "auth-code-123"
      );

      expect(tokens.access_token).toBeTruthy();
      expect(tokens.token_type).toBe("Bearer");
      expect(tokens.expires_in).toBe(3600);
      expect(tokens.refresh_token).toBeTruthy();
      expect(tokenStore.consumeAuthCode).toHaveBeenCalledWith("auth-code-123");
      expect(tokenStore.storeMcpToken).toHaveBeenCalledWith(
        tokens.access_token,
        expect.objectContaining({ userSysId: "user-abc", clientId: "client-1" }),
        3600
      );
      expect(tokenStore.storeMcpRefreshToken).toHaveBeenCalledWith(
        tokens.refresh_token,
        expect.objectContaining({ userSysId: "user-abc", clientId: "client-1" }),
        2592000
      );
    });

    it("throws when auth code not found", async () => {
      tokenStore.consumeAuthCode.mockResolvedValue(null);

      await expect(
        provider.exchangeAuthorizationCode(matchingClient, "bad-code")
      ).rejects.toThrow("Authorization code not found or expired");
    });

    it("rejects when client_id does not match the code", async () => {
      tokenStore.consumeAuthCode.mockResolvedValue({
        userSysId: "user-abc",
        clientId: "client-1",
        codeChallenge: "challenge",
        redirectUri: "http://localhost",
        scopes: [],
      });

      const wrongClient = { client_id: "client-other" } as any;

      await expect(
        provider.exchangeAuthorizationCode(wrongClient, "auth-code-123")
      ).rejects.toThrow("Authorization code was not issued to this client");
    });

    it("rejects when redirect_uri does not match the code", async () => {
      tokenStore.consumeAuthCode.mockResolvedValue({
        userSysId: "user-abc",
        clientId: "client-1",
        codeChallenge: "challenge",
        redirectUri: "http://localhost/callback",
        scopes: [],
      });

      await expect(
        provider.exchangeAuthorizationCode(
          matchingClient,
          "auth-code-123",
          undefined,
          "http://evil.example.com/callback"
        )
      ).rejects.toThrow("redirect_uri does not match");
    });
  });

  describe("exchangeRefreshToken", () => {
    const matchingClient = { client_id: "client-1" } as any;

    it("returns new access token when refresh token and SN creds are valid", async () => {
      tokenStore.getMcpRefreshToken.mockResolvedValue({
        userSysId: "user-abc",
        clientId: "client-1",
        scopes: ["read"],
      });
      tokenStore.getToken.mockResolvedValue({ access_token: "sn-token" });

      const tokens = await provider.exchangeRefreshToken(matchingClient, "refresh-123");

      expect(tokens.access_token).toBeTruthy();
      expect(tokens.token_type).toBe("Bearer");
      expect(tokens.refresh_token).toBe("refresh-123");
      expect(tokenStore.storeMcpToken).toHaveBeenCalled();
    });

    it("throws when refresh token not found", async () => {
      tokenStore.getMcpRefreshToken.mockResolvedValue(null);

      await expect(
        provider.exchangeRefreshToken(matchingClient, "bad-refresh")
      ).rejects.toThrow("Refresh token not found or expired");
    });

    it("rejects when client_id does not match the refresh token", async () => {
      tokenStore.getMcpRefreshToken.mockResolvedValue({
        userSysId: "user-abc",
        clientId: "client-1",
        scopes: [],
      });

      const wrongClient = { client_id: "client-other" } as any;

      await expect(
        provider.exchangeRefreshToken(wrongClient, "refresh-123")
      ).rejects.toThrow("Refresh token was not issued to this client");
    });

    it("revokes refresh token and throws when SN creds are gone", async () => {
      tokenStore.getMcpRefreshToken.mockResolvedValue({
        userSysId: "user-abc",
        clientId: "client-1",
        scopes: [],
      });
      tokenStore.getToken.mockResolvedValue(null);

      await expect(
        provider.exchangeRefreshToken(matchingClient, "refresh-123")
      ).rejects.toThrow("ServiceNow credentials expired");

      expect(tokenStore.deleteMcpRefreshToken).toHaveBeenCalledWith("refresh-123");
    });
  });

  describe("verifyAccessToken", () => {
    it("returns AuthInfo for valid token", async () => {
      tokenStore.getMcpToken.mockResolvedValue({
        userSysId: "user-abc",
        clientId: "client-1",
        scopes: ["read"],
        expiresAt: 1700001800,
      });

      const authInfo = await provider.verifyAccessToken("valid-token");

      expect(authInfo.token).toBe("valid-token");
      expect(authInfo.clientId).toBe("client-1");
      expect(authInfo.scopes).toEqual(["read"]);
      expect(authInfo.extra).toEqual({ userSysId: "user-abc" });
    });

    it("throws for missing token", async () => {
      tokenStore.getMcpToken.mockResolvedValue(null);

      await expect(
        provider.verifyAccessToken("missing-token")
      ).rejects.toThrow("Access token not found or expired");
    });

    it("throws and deletes expired token", async () => {
      tokenStore.getMcpToken.mockResolvedValue({
        userSysId: "user-abc",
        clientId: "client-1",
        scopes: [],
        expiresAt: 1699999000, // in the past
      });

      await expect(
        provider.verifyAccessToken("expired-token")
      ).rejects.toThrow("Access token expired");

      expect(tokenStore.deleteMcpToken).toHaveBeenCalledWith("expired-token");
    });
  });

  describe("revokeToken", () => {
    const owningClient = { client_id: "client-1" } as any;

    it("deletes access token when hinted and client matches", async () => {
      tokenStore.getMcpToken.mockResolvedValue({
        userSysId: "user-abc",
        clientId: "client-1",
        scopes: [],
        expiresAt: 1700001800,
      });

      await provider.revokeToken(owningClient, {
        token: "tok-123",
        token_type_hint: "access_token",
      });

      expect(tokenStore.deleteMcpToken).toHaveBeenCalledWith("tok-123");
      expect(tokenStore.deleteMcpRefreshToken).not.toHaveBeenCalled();
    });

    it("deletes refresh token when hinted and client matches", async () => {
      tokenStore.getMcpRefreshToken.mockResolvedValue({
        userSysId: "user-abc",
        clientId: "client-1",
        scopes: [],
      });

      await provider.revokeToken(owningClient, {
        token: "tok-123",
        token_type_hint: "refresh_token",
      });

      expect(tokenStore.deleteMcpRefreshToken).toHaveBeenCalledWith("tok-123");
      expect(tokenStore.deleteMcpToken).not.toHaveBeenCalled();
    });

    it("tries both when no hint provided", async () => {
      tokenStore.getMcpToken.mockResolvedValue(null);
      tokenStore.getMcpRefreshToken.mockResolvedValue(null);

      await provider.revokeToken(owningClient, { token: "tok-123" });

      expect(tokenStore.deleteMcpToken).toHaveBeenCalledWith("tok-123");
      expect(tokenStore.deleteMcpRefreshToken).toHaveBeenCalledWith("tok-123");
    });

    it("succeeds silently when token does not exist", async () => {
      tokenStore.getMcpToken.mockResolvedValue(null);

      await provider.revokeToken(owningClient, {
        token: "nonexistent",
        token_type_hint: "access_token",
      });

      expect(tokenStore.deleteMcpToken).toHaveBeenCalledWith("nonexistent");
    });

    it("rejects when access token belongs to a different client", async () => {
      tokenStore.getMcpToken.mockResolvedValue({
        userSysId: "user-abc",
        clientId: "other-client",
        scopes: [],
        expiresAt: 1700001800,
      });

      const wrongClient = { client_id: "client-1" } as any;

      await expect(
        provider.revokeToken(wrongClient, {
          token: "tok-123",
          token_type_hint: "access_token",
        })
      ).rejects.toThrow("Token was not issued to this client");

      expect(tokenStore.deleteMcpToken).not.toHaveBeenCalled();
    });

    it("rejects when refresh token belongs to a different client", async () => {
      tokenStore.getMcpRefreshToken.mockResolvedValue({
        userSysId: "user-abc",
        clientId: "other-client",
        scopes: [],
      });

      const wrongClient = { client_id: "client-1" } as any;

      await expect(
        provider.revokeToken(wrongClient, {
          token: "tok-123",
          token_type_hint: "refresh_token",
        })
      ).rejects.toThrow("Token was not issued to this client");

      expect(tokenStore.deleteMcpRefreshToken).not.toHaveBeenCalled();
    });
  });
});

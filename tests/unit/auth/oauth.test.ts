import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";
import { createOAuthRouter } from "../../../src/auth/oauth.js";

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

describe("createOAuthRouter", () => {
  const tokenStore = {
    storeToken: vi.fn(),
    getSnState: vi.fn(),
    getPendingAuth: vi.fn(),
    deletePendingAuth: vi.fn(),
    storeAuthCode: vi.fn(),
  };

  const config = {
    SERVICENOW_INSTANCE_URL: "https://example.service-now.com",
    SERVICENOW_CLIENT_ID: "client-id",
    SERVICENOW_CLIENT_SECRET: "client-secret",
    SN_CALLBACK_URI: "http://localhost:8080/oauth/sn-callback",
  };

  function createTestApp() {
    const app = express();
    app.use("/oauth", createOAuthRouter(config as any, tokenStore as any));
    return app;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    vi.spyOn(crypto, "randomBytes").mockReturnValue(Buffer.alloc(32, 1));
  });

  it("returns INVALID_CALLBACK when sn-callback is missing code/state", async () => {
    const app = createTestApp();

    const response = await request(app).get("/oauth/sn-callback").expect(400);

    expect(response.body.error.code).toBe("INVALID_CALLBACK");
  });

  it("redirects error back to MCP client when SN sends error with state", async () => {
    tokenStore.getSnState.mockResolvedValue({ pendingAuthId: "pending-1" });
    tokenStore.getPendingAuth.mockResolvedValue({
      clientId: "mcp-client-1",
      redirectUri: "http://client.example.com/callback",
      codeChallenge: "challenge123",
      state: "mcp-client-state",
      scopes: [],
    });
    tokenStore.deletePendingAuth.mockResolvedValue(undefined);

    const app = createTestApp();

    const response = await request(app)
      .get("/oauth/sn-callback?error=access_denied&state=sn-state-1")
      .expect(302);

    const location = response.headers.location as string;
    expect(location).toContain("http://client.example.com/callback");
    expect(location).toContain("error=access_denied");
    expect(location).toContain("state=mcp-client-state");
    expect(tokenStore.deletePendingAuth).toHaveBeenCalledWith("pending-1");
  });

  it("returns SN_OAUTH_ERROR JSON when SN sends error without state", async () => {
    const app = createTestApp();

    const response = await request(app)
      .get("/oauth/sn-callback?error=access_denied")
      .expect(400);

    expect(response.body.error.code).toBe("SN_OAUTH_ERROR");
  });

  it("returns INVALID_STATE when sn_state not found", async () => {
    tokenStore.getSnState.mockResolvedValue(null);
    const app = createTestApp();

    const response = await request(app)
      .get("/oauth/sn-callback?code=abc&state=badstate")
      .expect(400);

    expect(response.body.error.code).toBe("INVALID_STATE");
  });

  it("returns EXPIRED_AUTH when pending auth expired", async () => {
    tokenStore.getSnState.mockResolvedValue({ pendingAuthId: "pending-1" });
    tokenStore.getPendingAuth.mockResolvedValue(null);
    const app = createTestApp();

    const response = await request(app)
      .get("/oauth/sn-callback?code=abc&state=valid-state")
      .expect(400);

    expect(response.body.error.code).toBe("EXPIRED_AUTH");
  });

  it("exchanges SN code, stores token, generates auth code, and redirects to client", async () => {
    tokenStore.getSnState.mockResolvedValue({ pendingAuthId: "pending-1" });
    tokenStore.getPendingAuth.mockResolvedValue({
      clientId: "mcp-client-1",
      redirectUri: "http://client.example.com/callback",
      codeChallenge: "challenge123",
      state: "mcp-client-state",
      scopes: ["read"],
    });
    tokenStore.storeToken.mockResolvedValue(undefined);
    tokenStore.storeAuthCode.mockResolvedValue(undefined);
    tokenStore.deletePendingAuth.mockResolvedValue(undefined);

    axiosMocks.post.mockResolvedValue({
      data: {
        access_token: "sn-access",
        refresh_token: "sn-refresh",
        expires_in: 1800,
      },
    });

    axiosMocks.get.mockResolvedValue({
      data: {
        result: [
          {
            sys_id: "user-sys-id-123",
            user_name: "jane.doe",
            name: "Jane Doe",
          },
        ],
      },
    });

    const app = createTestApp();
    const response = await request(app)
      .get("/oauth/sn-callback?code=sn-auth-code&state=sn-state-1")
      .expect(302);

    // Verify SN token exchange
    expect(axiosMocks.post).toHaveBeenCalledWith(
      "https://example.service-now.com/oauth_token.do",
      expect.stringContaining("grant_type=authorization_code"),
      expect.any(Object)
    );

    // Verify SN token stored
    expect(tokenStore.storeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: "sn-access",
        refresh_token: "sn-refresh",
        user_sys_id: "user-sys-id-123",
        user_name: "jane.doe",
      })
    );

    // Verify our auth code was stored
    expect(tokenStore.storeAuthCode).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        userSysId: "user-sys-id-123",
        clientId: "mcp-client-1",
        codeChallenge: "challenge123",
      }),
      300
    );

    // Verify pending auth cleaned up
    expect(tokenStore.deletePendingAuth).toHaveBeenCalledWith("pending-1");

    // Verify redirect to MCP client
    const location = response.headers.location as string;
    expect(location).toContain("http://client.example.com/callback");
    expect(location).toContain("state=mcp-client-state");
    expect(location).toContain("code=");
  });

  it("redirects error to MCP client and cleans up pending auth when SN token exchange fails", async () => {
    tokenStore.getSnState.mockResolvedValue({ pendingAuthId: "pending-1" });
    tokenStore.getPendingAuth.mockResolvedValue({
      clientId: "mcp-client-1",
      redirectUri: "http://client.example.com/callback",
      codeChallenge: "challenge123",
      state: "mcp-client-state",
      scopes: [],
    });
    tokenStore.deletePendingAuth.mockResolvedValue(undefined);

    axiosMocks.post.mockRejectedValue({
      response: { status: 400, data: { error: "invalid_grant" } },
    });

    const app = createTestApp();
    const response = await request(app)
      .get("/oauth/sn-callback?code=bad&state=valid-state")
      .expect(302);

    const location = response.headers.location as string;
    expect(location).toContain("http://client.example.com/callback");
    expect(location).toContain("error=server_error");
    expect(location).toContain("error_description=");
    expect(location).toContain("state=mcp-client-state");
    expect(tokenStore.deletePendingAuth).toHaveBeenCalledWith("pending-1");
  });

  it("redirects error without state when pending auth has no state", async () => {
    tokenStore.getSnState.mockResolvedValue({ pendingAuthId: "pending-2" });
    tokenStore.getPendingAuth.mockResolvedValue({
      clientId: "mcp-client-1",
      redirectUri: "http://client.example.com/callback",
      codeChallenge: "challenge123",
      scopes: [],
    });
    tokenStore.deletePendingAuth.mockResolvedValue(undefined);

    axiosMocks.post.mockRejectedValue({
      response: { status: 500, data: "upstream error" },
    });

    const app = createTestApp();
    const response = await request(app)
      .get("/oauth/sn-callback?code=bad&state=valid-state")
      .expect(302);

    const location = response.headers.location as string;
    expect(location).toContain("error=server_error");
    expect(location).not.toContain("state=");
    expect(tokenStore.deletePendingAuth).toHaveBeenCalledWith("pending-2");
  });
});

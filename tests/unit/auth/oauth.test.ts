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
    storeOAuthState: vi.fn(),
    getOAuthState: vi.fn(),
    storeToken: vi.fn(),
    storeSessionMapping: vi.fn(),
  };

  const config = {
    SERVICENOW_INSTANCE_URL: "https://example.service-now.com",
    SERVICENOW_CLIENT_ID: "client-id",
    SERVICENOW_CLIENT_SECRET: "client-secret",
    OAUTH_REDIRECT_URI: "http://localhost:3001/oauth/callback",
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

  it("redirects to ServiceNow and stores OAuth state on authorize", async () => {
    tokenStore.storeOAuthState.mockResolvedValue(undefined);
    const app = createTestApp();

    const response = await request(app)
      .get("/oauth/authorize?session_id=session-123")
      .expect(302);

    expect(tokenStore.storeOAuthState).toHaveBeenCalledWith(
      expect.any(String),
      { sessionId: "session-123" }
    );

    const location = response.headers.location as string;
    expect(location).toContain("https://example.service-now.com/oauth_auth.do?");
    expect(location).toContain("response_type=code");
    expect(location).toContain("client_id=client-id");
    expect(location).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Foauth%2Fcallback");
  });

  it("returns INVALID_CALLBACK when code/state are missing", async () => {
    const app = createTestApp();

    const response = await request(app).get("/oauth/callback").expect(400);

    expect(response.body).toEqual({
      success: false,
      error: {
        code: "INVALID_CALLBACK",
        message: "Missing code or state parameter",
      },
    });
  });

  it("returns OAUTH_ERROR when provider sends an error", async () => {
    const app = createTestApp();

    const response = await request(app)
      .get("/oauth/callback?error=access_denied")
      .expect(400);

    expect(response.body.error.code).toBe("OAUTH_ERROR");
    expect(response.body.error.message).toContain("access_denied");
  });

  it("returns INVALID_STATE for unknown or expired OAuth state", async () => {
    tokenStore.getOAuthState.mockResolvedValue(null);
    const app = createTestApp();

    const response = await request(app)
      .get("/oauth/callback?code=abc&state=badstate")
      .expect(400);

    expect(tokenStore.getOAuthState).toHaveBeenCalledWith("badstate");
    expect(response.body.error.code).toBe("INVALID_STATE");
  });

  it("stores token and session mapping on successful callback", async () => {
    tokenStore.getOAuthState.mockResolvedValue({ sessionId: "session-abc" });
    tokenStore.storeToken.mockResolvedValue(undefined);
    tokenStore.storeSessionMapping.mockResolvedValue(undefined);

    axiosMocks.post.mockResolvedValue({
      data: {
        access_token: "access-new",
        refresh_token: "refresh-new",
        expires_in: 1800,
      },
    });

    axiosMocks.get.mockResolvedValue({
      data: {
        result: [
          {
            sys_id: "abc123def456abc123def456abc12345",
            user_name: "john.doe",
            name: "John Doe",
          },
        ],
      },
    });

    const app = createTestApp();
    const response = await request(app)
      .get("/oauth/callback?code=authcode123&state=state-1")
      .expect(200);

    expect(axiosMocks.post).toHaveBeenCalledWith(
      "https://example.service-now.com/oauth_token.do",
      expect.stringContaining("grant_type=authorization_code"),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    expect(axiosMocks.get).toHaveBeenCalledWith(
      "https://example.service-now.com/api/now/table/sys_user",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer access-new" }),
      })
    );

    expect(tokenStore.storeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: "access-new",
        refresh_token: "refresh-new",
        user_sys_id: "abc123def456abc123def456abc12345",
        user_name: "john.doe",
        display_name: "John Doe",
        expires_at: 1700001800,
      })
    );
    expect(tokenStore.storeSessionMapping).toHaveBeenCalledWith(
      "session-abc",
      "abc123def456abc123def456abc12345"
    );
    expect(response.body.success).toBe(true);
    expect(response.body.user.user_name).toBe("john.doe");
  });

  it("returns TOKEN_EXCHANGE_FAILED when token exchange fails", async () => {
    tokenStore.getOAuthState.mockResolvedValue({ sessionId: "session-abc" });
    axiosMocks.post.mockRejectedValue({
      response: { status: 400, data: { error: "invalid_grant" } },
    });

    const app = createTestApp();
    const response = await request(app)
      .get("/oauth/callback?code=bad&state=state-1")
      .expect(500);

    expect(response.body).toEqual({
      success: false,
      error: {
        code: "TOKEN_EXCHANGE_FAILED",
        message: "Failed to exchange authorization code for tokens",
      },
    });
  });
});

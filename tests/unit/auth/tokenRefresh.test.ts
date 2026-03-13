import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TokenRefresher, AuthRequiredError } from "../../../src/auth/tokenRefresh.js";
import type { StoredToken } from "../../../src/auth/tokenStore.js";

const { mockAxiosPost, mockRandomUUID } = vi.hoisted(() => ({
  mockAxiosPost: vi.fn(),
  mockRandomUUID: vi.fn().mockReturnValue("test-uuid-1234"),
}));

vi.mock("axios", () => ({
  default: {
    post: mockAxiosPost,
  },
}));

vi.mock("node:crypto", () => ({
  default: {
    randomUUID: mockRandomUUID,
  },
}));

const baseConfig = {
  SERVICENOW_INSTANCE_URL: "https://example.service-now.com",
  SERVICENOW_CLIENT_ID: "client-id",
  SERVICENOW_CLIENT_SECRET: "client-secret",
};

describe("TokenRefresher", () => {
  const mockTokenStore = {
    getToken: vi.fn(),
    storeToken: vi.fn(),
    deleteToken: vi.fn(),
  };

  const mockRedis = {
    set: vi.fn(),
    del: vi.fn(),
    eval: vi.fn(),
  };

  const userSysId = "abc123def456abc123def456abc12345";

  const buildToken = (expiresAt: number): StoredToken => ({
    access_token: "access-old",
    refresh_token: "refresh-old",
    expires_at: expiresAt,
    user_sys_id: userSysId,
    user_name: "john.doe",
    display_name: "John Doe",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    mockRandomUUID.mockReturnValue("test-uuid-1234");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws AuthRequiredError when token is missing", async () => {
    mockTokenStore.getToken.mockResolvedValue(null);

    const refresher = new TokenRefresher(
      baseConfig as any,
      mockTokenStore as any,
      mockRedis as any
    );

    await expect(refresher.ensureFreshToken(userSysId)).rejects.toBeInstanceOf(
      AuthRequiredError
    );
  });

  it("returns existing token when outside refresh buffer", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const now = Math.floor(Date.now() / 1000);
    const freshToken = buildToken(now + 120);
    mockTokenStore.getToken.mockResolvedValue(freshToken);

    const refresher = new TokenRefresher(
      baseConfig as any,
      mockTokenStore as any,
      mockRedis as any
    );

    const token = await refresher.ensureFreshToken(userSysId);

    expect(token).toEqual(freshToken);
    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(mockAxiosPost).not.toHaveBeenCalled();
  });

  it("refreshes expiring token and stores updated values", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const now = Math.floor(Date.now() / 1000);
    const staleToken = buildToken(now + 30);

    mockTokenStore.getToken
      .mockResolvedValueOnce(staleToken)
      .mockResolvedValueOnce(staleToken);
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.del.mockResolvedValue(1);
    mockTokenStore.storeToken.mockResolvedValue(undefined);
    mockAxiosPost.mockResolvedValue({
      data: {
        access_token: "access-new",
        expires_in: 1800,
      },
    });

    const refresher = new TokenRefresher(
      baseConfig as any,
      mockTokenStore as any,
      mockRedis as any
    );

    const updated = await refresher.ensureFreshToken(userSysId);

    expect(mockRedis.set).toHaveBeenCalledWith(
      `token_refresh_lock:${userSysId}`,
      "test-uuid-1234",
      "EX",
      10,
      "NX"
    );
    expect(mockAxiosPost).toHaveBeenCalledWith(
      "https://example.service-now.com/oauth_token.do",
      expect.stringContaining("grant_type=refresh_token"),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    expect(mockTokenStore.storeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        access_token: "access-new",
        refresh_token: "refresh-old",
        expires_at: now + 1800,
      })
    );
    expect(updated.access_token).toBe("access-new");
    expect(updated.refresh_token).toBe("refresh-old");
    // Lock released via compare-and-delete Lua script, not blind del
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1]) == ARGV[1]'),
      1,
      `token_refresh_lock:${userSysId}`,
      "test-uuid-1234"
    );
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it("waits and returns refreshed token when lock is already held", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00.000Z"));
    const now = Math.floor(Date.now() / 1000);
    const staleToken = buildToken(now + 5);
    const refreshedToken = buildToken(now + 3600);

    mockTokenStore.getToken
      .mockResolvedValueOnce(staleToken)
      .mockResolvedValueOnce(refreshedToken);
    mockRedis.set.mockResolvedValue(null);

    const refresher = new TokenRefresher(
      baseConfig as any,
      mockTokenStore as any,
      mockRedis as any
    );

    const pending = refresher.ensureFreshToken(userSysId);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;

    expect(result).toEqual(refreshedToken);
    expect(mockAxiosPost).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it("uses unique lock value per call to prevent cross-process lock deletion", async () => {
    mockRandomUUID
      .mockReturnValueOnce("uuid-call-1")
      .mockReturnValueOnce("uuid-call-2");

    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const now = Math.floor(Date.now() / 1000);
    const staleToken = buildToken(now + 30);

    // Each ensureFreshToken call needs: initial getToken + post-lock getToken
    mockTokenStore.getToken
      .mockResolvedValueOnce(staleToken)   // call 1: initial check
      .mockResolvedValueOnce(staleToken)   // call 1: post-lock double-check
      .mockResolvedValueOnce(staleToken)   // call 2: initial check
      .mockResolvedValueOnce(staleToken);  // call 2: post-lock double-check
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.eval.mockResolvedValue(1);
    mockTokenStore.storeToken.mockResolvedValue(undefined);
    mockAxiosPost.mockResolvedValue({
      data: { access_token: "new-1", expires_in: 1800 },
    });

    const refresher = new TokenRefresher(
      baseConfig as any,
      mockTokenStore as any,
      mockRedis as any
    );

    await refresher.ensureFreshToken(userSysId);
    await refresher.ensureFreshToken(userSysId);

    // First call acquired and released with uuid-call-1
    expect(mockRedis.set).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      "uuid-call-1",
      "EX",
      10,
      "NX"
    );
    expect(mockRedis.eval).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      1,
      expect.any(String),
      "uuid-call-1"
    );

    // Second call acquired and released with uuid-call-2
    expect(mockRedis.set).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      "uuid-call-2",
      "EX",
      10,
      "NX"
    );
    expect(mockRedis.eval).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      1,
      expect.any(String),
      "uuid-call-2"
    );
  });

  it("deletes token and throws AuthRequiredError when refresh is unauthorized", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const now = Math.floor(Date.now() / 1000);
    const staleToken = buildToken(now + 10);

    mockTokenStore.getToken
      .mockResolvedValueOnce(staleToken)
      .mockResolvedValueOnce(staleToken);
    mockRedis.set.mockResolvedValue("OK");
    mockRedis.del.mockResolvedValue(1);
    mockAxiosPost.mockRejectedValue({ response: { status: 401 } });

    const refresher = new TokenRefresher(
      baseConfig as any,
      mockTokenStore as any,
      mockRedis as any
    );

    await expect(refresher.ensureFreshToken(userSysId)).rejects.toBeInstanceOf(
      AuthRequiredError
    );
    expect(mockTokenStore.deleteToken).toHaveBeenCalledWith(userSysId);
    // Lock released via compare-and-delete, not blind del
    expect(mockRedis.eval).toHaveBeenCalledWith(
      expect.stringContaining('redis.call("get", KEYS[1]) == ARGV[1]'),
      1,
      `token_refresh_lock:${userSysId}`,
      "test-uuid-1234"
    );
    expect(mockRedis.del).not.toHaveBeenCalled();
  });
});

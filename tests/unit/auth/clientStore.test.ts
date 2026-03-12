import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { RedisClientStore } from "../../../src/auth/clientStore.js";

describe("RedisClientStore", () => {
  const tokenStore = {
    getOAuthClient: vi.fn(),
    storeOAuthClient: vi.fn(),
  };

  let store: RedisClientStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new RedisClientStore(tokenStore as any);
  });

  it("returns undefined for unknown client", async () => {
    tokenStore.getOAuthClient.mockResolvedValue(null);

    const result = await store.getClient("unknown-id");

    expect(result).toBeUndefined();
    expect(tokenStore.getOAuthClient).toHaveBeenCalledWith("unknown-id");
  });

  it("returns parsed client for known client", async () => {
    const client = {
      client_id: "known-id",
      client_secret: "secret",
      redirect_uris: ["http://localhost/callback"],
    };
    tokenStore.getOAuthClient.mockResolvedValue(JSON.stringify(client));

    const result = await store.getClient("known-id");

    expect(result).toEqual(client);
  });

  it("registers a new client with generated id and secret", async () => {
    tokenStore.storeOAuthClient.mockResolvedValue(undefined);
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);

    const metadata = {
      redirect_uris: [new URL("http://localhost/callback")],
      client_name: "Test Client",
    };

    const result = await store.registerClient(metadata as any);

    expect(result.client_id).toBeTruthy();
    expect(result.client_secret).toBeTruthy();
    expect(result.client_secret!.length).toBe(64); // 32 bytes hex
    expect(result.client_id_issued_at).toBe(1700000000);
    expect(result.client_name).toBe("Test Client");
    expect(tokenStore.storeOAuthClient).toHaveBeenCalledWith(
      result.client_id,
      expect.any(String),
      7776000
    );
  });
});

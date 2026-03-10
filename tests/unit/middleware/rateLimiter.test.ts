import { describe, it, expect, vi, beforeEach } from "vitest";
import { RateLimiter } from "../../../src/middleware/rateLimiter.js";

describe("RateLimiter", () => {
  const redis = {
    eval: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
  });

  it("returns true when Redis script allows request", async () => {
    redis.eval.mockResolvedValue(1);
    const limiter = new RateLimiter(redis as any, 60);

    const allowed = await limiter.checkLimit("abc123def456abc123def456abc12345");

    expect(allowed).toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      1,
      "ratelimit:abc123def456abc123def456abc12345",
      60,
      1700000000
    );
  });

  it("returns false when Redis script denies request", async () => {
    redis.eval.mockResolvedValue(0);
    const limiter = new RateLimiter(redis as any, 10);

    const allowed = await limiter.checkLimit("user-1");

    expect(allowed).toBe(false);
  });

  it("fails open when Redis errors", async () => {
    redis.eval.mockRejectedValue(new Error("Redis unavailable"));
    const limiter = new RateLimiter(redis as any, 10);

    const allowed = await limiter.checkLimit("user-1");

    expect(allowed).toBe(true);
  });
});

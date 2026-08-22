import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SUMMARY_DAYS, UsageMetrics } from "../../../src/metrics/usage.js";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const FIXED_NOW = new Date("2026-07-17T12:00:00Z");
const TODAY = "2026-07-17";
const YESTERDAY = "2026-07-16";

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("UsageMetrics.record", () => {
  let chain: {
    hincrby: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
    exec: ReturnType<typeof vi.fn>;
  };
  let metrics: UsageMetrics;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);

    chain = {
      hincrby: vi.fn(),
      expire: vi.fn(),
      exec: vi.fn().mockResolvedValue([]),
    };
    chain.hincrby.mockReturnValue(chain);
    chain.expire.mockReturnValue(chain);
    const redis = { multi: vi.fn(() => chain) };
    metrics = new UsageMetrics(redis as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("increments the daily and all-time calls hashes keyed by tool and user", () => {
    metrics.record("lookup_user", "john.doe", true);

    expect(chain.hincrby).toHaveBeenCalledWith(
      `metrics:calls:${TODAY}`,
      "lookup_user|john.doe",
      1
    );
    expect(chain.expire).toHaveBeenCalledWith(
      `metrics:calls:${TODAY}`,
      400 * 86400,
      "NX"
    );
    expect(chain.hincrby).toHaveBeenCalledWith(
      "metrics:total:calls",
      "lookup_user|john.doe",
      1
    );
    expect(chain.exec).toHaveBeenCalled();
  });

  it("uses the errors hashes for failed calls", () => {
    metrics.record("lookup_user", "john.doe", false);

    expect(chain.hincrby).toHaveBeenCalledWith(
      `metrics:errors:${TODAY}`,
      "lookup_user|john.doe",
      1
    );
    expect(chain.hincrby).toHaveBeenCalledWith(
      "metrics:total:errors",
      "lookup_user|john.doe",
      1
    );
  });

  it("strips the field separator from tool and user names", () => {
    metrics.record("weird|tool", "user|name", true);

    expect(chain.hincrby).toHaveBeenCalledWith(
      `metrics:calls:${TODAY}`,
      "weird_tool|user_name",
      1
    );
  });

  it("swallows redis failures without throwing", async () => {
    chain.exec.mockRejectedValue(new Error("redis down"));

    expect(() => metrics.record("lookup_user", "john.doe", true)).not.toThrow();
    await flushAsync();
  });
});

describe("UsageMetrics.summary", () => {
  let pipeline: {
    hgetall: ReturnType<typeof vi.fn>;
    exec: ReturnType<typeof vi.fn>;
  };
  let redis: { pipeline: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);

    pipeline = {
      hgetall: vi.fn(),
      exec: vi.fn(),
    };
    pipeline.hgetall.mockReturnValue(pipeline);
    redis = { pipeline: vi.fn(() => pipeline) };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aggregates calls and errors across days, tools, and users", async () => {
    // days=2 → hgetall order: calls today, calls yesterday, errors today,
    // errors yesterday, then all-time calls and all-time errors
    pipeline.exec.mockResolvedValue([
      [null, { "lookup_user|john.doe": "3", "search_incidents|jane.roe": "2" }],
      [null, { "lookup_user|john.doe": "5" }],
      [null, { "lookup_user|john.doe": "1" }],
      [null, {}],
      [null, { "lookup_user|john.doe": "40", "search_incidents|jane.roe": "7" }],
      [null, { "lookup_user|john.doe": "2" }],
    ]);

    const metrics = new UsageMetrics(redis as never);
    const summary = await metrics.summary(2);

    expect(pipeline.hgetall).toHaveBeenCalledWith(`metrics:calls:${TODAY}`);
    expect(pipeline.hgetall).toHaveBeenCalledWith(`metrics:calls:${YESTERDAY}`);
    expect(pipeline.hgetall).toHaveBeenCalledWith(`metrics:errors:${TODAY}`);
    expect(pipeline.hgetall).toHaveBeenCalledWith(`metrics:errors:${YESTERDAY}`);

    expect(summary.days).toBe(2);
    expect(summary.from).toBe(YESTERDAY);
    expect(summary.to).toBe(TODAY);
    expect(summary.totals).toEqual({ calls: 10, errors: 1 });
    expect(summary.byTool).toEqual({
      lookup_user: { calls: 8, errors: 1 },
      search_incidents: { calls: 2, errors: 0 },
    });
    expect(summary.byUser).toEqual({
      "john.doe": { calls: 8, errors: 1 },
      "jane.roe": { calls: 2, errors: 0 },
    });
    expect(summary.byDay).toEqual({
      [TODAY]: { calls: 5, errors: 1 },
      [YESTERDAY]: { calls: 5, errors: 0 },
    });
    expect(summary.byToolUser.lookup_user["john.doe"]).toEqual({
      calls: 8,
      errors: 1,
    });
    expect(pipeline.hgetall).toHaveBeenCalledWith("metrics:total:calls");
    expect(pipeline.hgetall).toHaveBeenCalledWith("metrics:total:errors");
    expect(summary.allTime.totals).toEqual({ calls: 47, errors: 2 });
    expect(summary.allTime.byTool).toEqual({
      lookup_user: { calls: 40, errors: 2 },
      search_incidents: { calls: 7, errors: 0 },
    });
    expect(summary.allTime.byUser["john.doe"]).toEqual({ calls: 40, errors: 2 });
  });

  it("skips per-day results that errored and ignores malformed counts", async () => {
    pipeline.exec.mockResolvedValue([
      [new Error("failed"), null],
      [null, { "lookup_user|john.doe": "not-a-number" }],
    ]);

    const metrics = new UsageMetrics(redis as never);
    const summary = await metrics.summary(1);

    expect(summary.totals).toEqual({ calls: 0, errors: 0 });
    expect(summary.byTool).toEqual({});
    expect(summary.allTime.totals).toEqual({ calls: 0, errors: 0 });
  });

  it("caps the window at MAX_SUMMARY_DAYS and floors it at 1", async () => {
    pipeline.exec.mockResolvedValue([]);
    const metrics = new UsageMetrics(redis as never);

    const capped = await metrics.summary(9999);
    expect(capped.days).toBe(MAX_SUMMARY_DAYS);

    const floored = await metrics.summary(-5);
    expect(floored.days).toBe(1);
  });
});

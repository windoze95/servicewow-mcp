import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withRetry } from "../../../src/servicenow/retry.js";

const loggerMocks = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    warn: loggerMocks.warn,
  },
}));

describe("withRetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5); // deterministic jitter: 10%
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns result on first success without retrying", async () => {
    const operation = vi.fn().mockResolvedValue("ok");

    const result = await withRetry(operation);

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it("retries on 429 status code and succeeds", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 429, message: "Rate limited" })
      .mockResolvedValue("ok");

    const promise = withRetry(operation);
    // Advance past the first retry delay
    await vi.advanceTimersByTimeAsync(600); // 500 * 2^0 + 10% jitter = 550

    const result = await promise;

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
  });

  it("retries on 500 status code", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 500, message: "Server error" })
      .mockResolvedValue("ok");

    const promise = withRetry(operation);
    await vi.advanceTimersByTimeAsync(600);

    const result = await promise;

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("retries on 502 status code", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 502, message: "Bad gateway" })
      .mockResolvedValue("ok");

    const promise = withRetry(operation);
    await vi.advanceTimersByTimeAsync(600);

    const result = await promise;

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("retries on 503 status code", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 503, message: "Unavailable" })
      .mockResolvedValue("ok");

    const promise = withRetry(operation);
    await vi.advanceTimersByTimeAsync(600);

    const result = await promise;

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("retries on 504 status code", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 504, message: "Gateway timeout" })
      .mockResolvedValue("ok");

    const promise = withRetry(operation);
    await vi.advanceTimersByTimeAsync(600);

    const result = await promise;

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("retries on ECONNRESET error code", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ code: "ECONNRESET" })
      .mockResolvedValue("ok");

    const promise = withRetry(operation);
    await vi.advanceTimersByTimeAsync(600);

    const result = await promise;

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("retries on ETIMEDOUT error code", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ code: "ETIMEDOUT" })
      .mockResolvedValue("ok");

    const promise = withRetry(operation);
    await vi.advanceTimersByTimeAsync(600);

    const result = await promise;

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("retries on ECONNABORTED error code", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ code: "ECONNABORTED" })
      .mockResolvedValue("ok");

    const promise = withRetry(operation);
    await vi.advanceTimersByTimeAsync(600);

    const result = await promise;

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on 400 status code", async () => {
    const error = { statusCode: 400, message: "Bad request" };
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withRetry(operation)).rejects.toMatchObject(error);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it("does NOT retry on 401 status code", async () => {
    const error = { statusCode: 401, message: "Unauthorized" };
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withRetry(operation)).rejects.toMatchObject(error);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it("does NOT retry on 403 status code", async () => {
    const error = { statusCode: 403, message: "Forbidden" };
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withRetry(operation)).rejects.toMatchObject(error);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it("does NOT retry on 404 status code", async () => {
    const error = { statusCode: 404, message: "Not found" };
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withRetry(operation)).rejects.toMatchObject(error);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(loggerMocks.warn).not.toHaveBeenCalled();
  });

  it("gives up after maxRetries and throws the last error", async () => {
    const error = { statusCode: 503, message: "Unavailable" };
    const operation = vi.fn().mockRejectedValue(error);

    const promise = withRetry(operation, { maxRetries: 2 });
    // Attach rejection handler immediately to prevent unhandled rejection
    const assertion = expect(promise).rejects.toMatchObject(error);

    // Advance past retry delays: attempt 0 delay + attempt 1 delay
    await vi.advanceTimersByTimeAsync(600); // first retry
    await vi.advanceTimersByTimeAsync(1200); // second retry

    await assertion;

    expect(operation).toHaveBeenCalledTimes(3); // initial + 2 retries
    expect(loggerMocks.warn).toHaveBeenCalledTimes(2);
  });

  it("uses retryAfterMs when present and larger than calculated delay", async () => {
    const error = {
      statusCode: 429,
      message: "Rate limited",
      retryAfterMs: 10000,
    };
    const operation = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("ok");

    const promise = withRetry(operation);

    // Calculated delay for attempt 0: 500 * 2^0 + 10% jitter = 550
    // retryAfterMs (10000) is larger, so 10000 should be used
    await vi.advanceTimersByTimeAsync(10000);

    const result = await promise;

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        delayMs: 10000,
      }),
      "Retrying ServiceNow API call"
    );
  });

  it("uses calculated delay when retryAfterMs is smaller", async () => {
    const error = {
      statusCode: 429,
      message: "Rate limited",
      retryAfterMs: 100, // smaller than calculated delay
    };
    const operation = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("ok");

    const promise = withRetry(operation);

    // Calculated delay for attempt 0: 500 * 2^0 + 10% jitter = 550
    // retryAfterMs (100) is smaller, so calculated delay (550) should be used
    await vi.advanceTimersByTimeAsync(600);

    const result = await promise;

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        delayMs: 550,
      }),
      "Retrying ServiceNow API call"
    );
  });

  it("respects custom maxRetries option", async () => {
    const error = { statusCode: 500, message: "Error" };
    const operation = vi.fn().mockRejectedValue(error);

    const promise = withRetry(operation, { maxRetries: 1 });
    // Attach rejection handler immediately to prevent unhandled rejection
    const assertion = expect(promise).rejects.toMatchObject(error);

    await vi.advanceTimersByTimeAsync(600);

    await assertion;

    expect(operation).toHaveBeenCalledTimes(2); // initial + 1 retry
    expect(loggerMocks.warn).toHaveBeenCalledTimes(1);
  });

  it("respects custom initialDelayMs option", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 500, message: "Error" })
      .mockResolvedValue("ok");

    const promise = withRetry(operation, { initialDelayMs: 1000 });

    // With initialDelayMs=1000, attempt 0: 1000 * 2^0 + 10% jitter = 1100
    await vi.advanceTimersByTimeAsync(1100);

    const result = await promise;

    expect(result).toBe("ok");
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        delayMs: 1100,
      }),
      "Retrying ServiceNow API call"
    );
  });

  it("respects custom backoffMultiplier option", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 500, message: "Error" })
      .mockRejectedValueOnce({ statusCode: 500, message: "Error" })
      .mockResolvedValue("ok");

    const promise = withRetry(operation, { backoffMultiplier: 3 });

    // Attempt 0: 500 * 3^0 + 10% jitter = 550
    await vi.advanceTimersByTimeAsync(600);
    // Attempt 1: 500 * 3^1 + 10% jitter = 1650
    await vi.advanceTimersByTimeAsync(1700);

    const result = await promise;

    expect(result).toBe("ok");
    expect(loggerMocks.warn).toHaveBeenCalledTimes(2);
    expect(loggerMocks.warn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ delayMs: 550 }),
      "Retrying ServiceNow API call"
    );
    expect(loggerMocks.warn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ delayMs: 1650 }),
      "Retrying ServiceNow API call"
    );
  });

  it("caps delay at maxDelayMs", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 500, message: "Error" })
      .mockResolvedValue("ok");

    const promise = withRetry(operation, {
      initialDelayMs: 50000,
      maxDelayMs: 5000,
    });

    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;

    expect(result).toBe("ok");
    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        delayMs: 5000,
      }),
      "Retrying ServiceNow API call"
    );
  });


  it("logs warning with correct metadata on each retry", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 503, message: "Unavailable" })
      .mockRejectedValueOnce({
        statusCode: 502,
        message: "Bad gateway",
        code: undefined,
      })
      .mockResolvedValue("ok");

    const promise = withRetry(operation, { maxRetries: 3 });

    await vi.advanceTimersByTimeAsync(600); // first retry
    await vi.advanceTimersByTimeAsync(1200); // second retry

    await promise;

    expect(loggerMocks.warn).toHaveBeenCalledTimes(2);
    expect(loggerMocks.warn).toHaveBeenNthCalledWith(
      1,
      {
        attempt: 1,
        maxRetries: 3,
        delayMs: 550,
        statusCode: 503,
        errorCode: undefined,
      },
      "Retrying ServiceNow API call"
    );
    expect(loggerMocks.warn).toHaveBeenNthCalledWith(
      2,
      {
        attempt: 2,
        maxRetries: 3,
        delayMs: 1100,
        statusCode: 502,
        errorCode: undefined,
      },
      "Retrying ServiceNow API call"
    );
  });

  it("logs network error code in retry metadata", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ code: "ECONNRESET" })
      .mockResolvedValue("ok");

    const promise = withRetry(operation);
    await vi.advanceTimersByTimeAsync(600);

    await promise;

    expect(loggerMocks.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "ECONNRESET",
        statusCode: undefined,
      }),
      "Retrying ServiceNow API call"
    );
  });

  it("applies exponential backoff across multiple retries", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 500, message: "Error" })
      .mockRejectedValueOnce({ statusCode: 500, message: "Error" })
      .mockRejectedValueOnce({ statusCode: 500, message: "Error" })
      .mockResolvedValue("ok");

    const promise = withRetry(operation);

    // Attempt 0: 500 * 2^0 + 10% = 550
    await vi.advanceTimersByTimeAsync(600);
    // Attempt 1: 500 * 2^1 + 10% = 1100
    await vi.advanceTimersByTimeAsync(1200);
    // Attempt 2: 500 * 2^2 + 10% = 2200
    await vi.advanceTimersByTimeAsync(2300);

    const result = await promise;

    expect(result).toBe("ok");
    expect(operation).toHaveBeenCalledTimes(4);
    expect(loggerMocks.warn).toHaveBeenCalledTimes(3);
  });
});

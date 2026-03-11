import { describe, expect, it, vi } from "vitest";
import {
  createToolError,
  mapServiceNowError,
  handleToolError,
} from "../../../src/middleware/errorHandler.js";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { error: vi.fn() },
}));

describe("createToolError", () => {
  it("returns a structured error with code, message, and reference_id", () => {
    const result = createToolError("VALIDATION_ERROR", "Bad input");
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.message).toBe("Bad input");
    expect(result.error.reference_id).toBeTruthy();
  });

  it("includes optional details", () => {
    const result = createToolError("NOT_FOUND", "Missing", { id: "x" });
    expect(result.error.details).toEqual({ id: "x" });
  });
});

describe("mapServiceNowError", () => {
  it("maps 401 to AUTH_EXPIRED", () => {
    expect(mapServiceNowError(401).error.code).toBe("AUTH_EXPIRED");
  });

  it("maps 403 to INSUFFICIENT_PERMISSIONS", () => {
    expect(mapServiceNowError(403).error.code).toBe("INSUFFICIENT_PERMISSIONS");
  });

  it("maps 404 to NOT_FOUND", () => {
    expect(mapServiceNowError(404).error.code).toBe("NOT_FOUND");
  });

  it("maps 429 to RATE_LIMITED", () => {
    expect(mapServiceNowError(429).error.code).toBe("RATE_LIMITED");
  });

  it("maps 5xx to SN_UNAVAILABLE", () => {
    expect(mapServiceNowError(500).error.code).toBe("SN_UNAVAILABLE");
    expect(mapServiceNowError(503).error.code).toBe("SN_UNAVAILABLE");
  });

  it("maps other codes to UNEXPECTED_ERROR with response body", () => {
    const result = mapServiceNowError(418, { detail: "teapot" });
    expect(result.error.code).toBe("UNEXPECTED_ERROR");
    expect(result.error.details).toEqual({ detail: "teapot" });
  });
});

describe("handleToolError", () => {
  it("delegates ServiceNow API errors to mapServiceNowError", () => {
    const result = handleToolError({ statusCode: 404 });
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("handles AuthRequiredError by name", () => {
    const err = new Error("Auth needed");
    err.name = "AuthRequiredError";
    const result = handleToolError(err);
    expect(result.error.code).toBe("AUTH_REQUIRED");
  });

  it("returns UNEXPECTED_ERROR for unknown errors", () => {
    const result = handleToolError(new Error("boom"));
    expect(result.error.code).toBe("UNEXPECTED_ERROR");
    expect(result.error.reference_id).toBeTruthy();
  });
});

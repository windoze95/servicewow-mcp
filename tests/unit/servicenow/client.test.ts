import { describe, it, expect, vi, beforeEach } from "vitest";
import { ServiceNowClient } from "../../../src/servicenow/client.js";

const axiosMocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("axios", () => ({
  default: {
    create: axiosMocks.create,
  },
}));

describe("ServiceNowClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    axiosMocks.create.mockReturnValue({
      get: axiosMocks.get,
      post: axiosMocks.post,
      patch: axiosMocks.patch,
    });
  });

  it("creates axios instance with auth headers", () => {
    new ServiceNowClient("https://example.service-now.com", "token-123");

    expect(axiosMocks.create).toHaveBeenCalledWith({
      baseURL: "https://example.service-now.com",
      headers: {
        Authorization: "Bearer token-123",
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  });

  it("merges default and custom params for GET", async () => {
    axiosMocks.get.mockResolvedValue({
      status: 200,
      data: { result: [{ sys_id: "123" }] },
      headers: { etag: "abc" },
    });

    const client = new ServiceNowClient("https://example.service-now.com", "token-123");
    const result = await client.get("/api/now/table/incident", {
      params: { sysparm_limit: 1 },
      headers: { "X-Trace": "trace-1" },
    });

    expect(axiosMocks.get).toHaveBeenCalledWith("/api/now/table/incident", {
      params: {
        sysparm_display_value: "true",
        sysparm_limit: 1,
      },
      headers: { "X-Trace": "trace-1" },
    });
    expect(result).toEqual({
      data: { result: [{ sys_id: "123" }] },
      headers: { etag: "abc" },
    });
  });

  it("maps 404 responses to record-not-found message", async () => {
    axiosMocks.get.mockRejectedValue({
      response: {
        status: 404,
        data: { error: "not found" },
      },
    });

    const client = new ServiceNowClient("https://example.service-now.com", "token-123");

    await expect(client.get("/api/now/table/incident/bad-id")).rejects.toMatchObject({
      statusCode: 404,
      responseBody: { error: "not found" },
      message: "Record not found",
    });
  });

  it("maps 5xx responses to ServiceNow unavailable", async () => {
    axiosMocks.post.mockRejectedValue({
      response: {
        status: 503,
        data: { error: "maintenance" },
      },
    });

    const client = new ServiceNowClient("https://example.service-now.com", "token-123");

    await expect(client.post("/api/now/table/incident", { short_description: "x" })).rejects.toMatchObject({
      statusCode: 503,
      message: "ServiceNow unavailable",
    });
  });

  it("maps non-special client errors to generic API message", async () => {
    axiosMocks.patch.mockRejectedValue({
      response: {
        status: 400,
        data: { error: "bad request" },
      },
    });

    const client = new ServiceNowClient("https://example.service-now.com", "token-123");

    await expect(client.patch("/api/now/table/incident/1", { state: "2" })).rejects.toMatchObject({
      statusCode: 400,
      message: "ServiceNow API error (400)",
    });
  });
});

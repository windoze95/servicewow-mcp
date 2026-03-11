import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerKnowledgeTools } from "../../../src/tools/knowledge.js";
import type { ToolContext } from "../../../src/tools/registry.js";

type WrappedHandler<T = unknown> = (args: T) => Promise<unknown>;

describe("registerKnowledgeTools", () => {
  const userSysId = "abc123def456abc123def456abc12345";

  function setup() {
    const handlers: Record<string, WrappedHandler> = {};

    const server = {
      tool: vi.fn(
        (
          name: string,
          _description: string,
          _schema: unknown,
          handler: WrappedHandler
        ) => {
          handlers[name] = handler;
        }
      ),
    };

    const snClient = {
      get: vi.fn(),
      patch: vi.fn(),
      post: vi.fn(),
    };

    const ctx: ToolContext = {
      snClient: snClient as unknown as ToolContext["snClient"],
      instanceUrl: "https://example.service-now.com",
      userSysId,
      userName: "john.doe",
      displayName: "John Doe",
    };

    const wrapHandler = <T>(
      handler: (context: ToolContext, args: T) => Promise<unknown>
    ) => {
      return async (args: T) => handler(ctx, args);
    };

    registerKnowledgeTools(server as any, wrapHandler);

    return { handlers, snClient, server };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("search_knowledge returns articles with self_link using kb_knowledge table", async () => {
    const { handlers, snClient } = setup();
    const articleId = "0123456789abcdef0123456789abcdef";

    snClient.get.mockResolvedValue({
      data: {
        result: [
          { sys_id: articleId, short_description: "How to reset password" },
        ],
      },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.search_knowledge({
      query: "reset password",
      limit: 10,
    })) as any;

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/sn_km/knowledge/articles",
      {
        params: {
          sysparm_query: "reset password",
          sysparm_limit: 10,
        },
      }
    );
    expect(result).toEqual({
      success: true,
      data: [
        {
          sys_id: articleId,
          short_description: "How to reset password",
          self_link: `https://example.service-now.com/kb_knowledge.do?sys_id=${articleId}`,
        },
      ],
      metadata: {
        total_count: 1,
        returned_count: 1,
      },
    });
  });

  it("search_knowledge handles articles without sys_id", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [{ title: "No ID article" }] },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.search_knowledge({
      query: "test",
      limit: 10,
    })) as any;

    expect(result.data[0].self_link).toBeUndefined();
  });

  it("get_article handles result without sys_id", async () => {
    const { handlers, snClient } = setup();
    const articleId = "fedcba9876543210fedcba9876543210";

    snClient.get.mockResolvedValue({
      data: { result: { title: "No sys_id" } },
      headers: {},
    });

    const result = (await handlers.get_article({ sys_id: articleId })) as any;
    expect(result.data.self_link).toBeUndefined();
  });

  it("get_article returns article with self_link", async () => {
    const { handlers, snClient } = setup();
    const articleId = "fedcba9876543210fedcba9876543210";

    snClient.get.mockResolvedValue({
      data: {
        result: {
          sys_id: articleId,
          short_description: "VPN setup guide",
          text: "Full article body here",
        },
      },
      headers: {},
    });

    const result = (await handlers.get_article({
      sys_id: articleId,
    })) as any;

    expect(snClient.get).toHaveBeenCalledWith(
      `/api/sn_km/knowledge/articles/${articleId}`
    );
    expect(result).toEqual({
      success: true,
      data: {
        sys_id: articleId,
        short_description: "VPN setup guide",
        text: "Full article body here",
        self_link: `https://example.service-now.com/kb_knowledge.do?sys_id=${articleId}`,
      },
    });
  });

  it("get_article returns VALIDATION_ERROR for invalid sys_id", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.get_article({
      sys_id: "bad-id",
    })) as any;

    expect(result).toEqual({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid sys_id format. Must be a 32-character hex string.",
      },
    });
    expect(snClient.get).not.toHaveBeenCalled();
  });
});

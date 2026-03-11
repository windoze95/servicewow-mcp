import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerCatalogTools } from "../../../src/tools/catalog.js";
import type { ToolContext } from "../../../src/tools/registry.js";

type WrappedHandler<T = unknown> = (args: T) => Promise<unknown>;

describe("registerCatalogTools", () => {
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

    registerCatalogTools(server as any, wrapHandler);

    return { handlers, snClient, server };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("search_catalog_items", () => {
    it("returns catalog items with self_link using sc_cat_item table", async () => {
      const { handlers, snClient } = setup();
      const itemId = "0123456789abcdef0123456789abcdef";

      snClient.get.mockResolvedValue({
        data: {
          result: [
            { sys_id: itemId, name: "Laptop Request" },
          ],
        },
      });

      const result = (await handlers.search_catalog_items({
        query: "laptop",
        limit: 10,
      })) as any;

      expect(snClient.get).toHaveBeenCalledWith(
        "/api/sn_sc/servicecatalog/items",
        {
          params: {
            sysparm_text: "laptop",
            sysparm_limit: 10,
          },
        }
      );
      expect(result.success).toBe(true);
      expect(result.data[0].self_link).toBe(
        `https://example.service-now.com/sc_cat_item.do?sys_id=${itemId}`
      );
      expect(result.metadata).toEqual({ returned_count: 1 });
    });

    it("handles items without sys_id gracefully", async () => {
      const { handlers, snClient } = setup();

      snClient.get.mockResolvedValue({
        data: { result: [{ name: "No ID item" }] },
      });

      const result = (await handlers.search_catalog_items({
        query: "test",
        limit: 10,
      })) as any;

      expect(result.data[0].self_link).toBeUndefined();
    });
  });

  describe("get_catalog_item", () => {
    it("returns item details with self_link", async () => {
      const { handlers, snClient } = setup();
      const itemId = "fedcba9876543210fedcba9876543210";

      snClient.get.mockResolvedValue({
        data: {
          result: { sys_id: itemId, name: "VPN Access" },
        },
      });

      const result = (await handlers.get_catalog_item({
        sys_id: itemId,
      })) as any;

      expect(snClient.get).toHaveBeenCalledWith(
        `/api/sn_sc/servicecatalog/items/${itemId}`
      );
      expect(result.success).toBe(true);
      expect(result.data.self_link).toBe(
        `https://example.service-now.com/sc_cat_item.do?sys_id=${itemId}`
      );
    });

    it("handles item without sys_id gracefully", async () => {
      const { handlers, snClient } = setup();
      const itemId = "fedcba9876543210fedcba9876543210";

      snClient.get.mockResolvedValue({
        data: { result: { name: "No ID" } },
      });

      const result = (await handlers.get_catalog_item({ sys_id: itemId })) as any;
      expect(result.data.self_link).toBeUndefined();
    });

    it("returns validation error for invalid sys_id", async () => {
      const { handlers, snClient } = setup();

      const result = (await handlers.get_catalog_item({
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

  describe("submit_catalog_request", () => {
    it("submits order and returns request with self_link using sc_request table", async () => {
      const { handlers, snClient } = setup();
      const itemId = "0123456789abcdef0123456789abcdef";
      const requestId = "fedcba9876543210fedcba9876543210";

      snClient.post.mockResolvedValue({
        data: {
          result: { sys_id: requestId, number: "REQ0010001" },
        },
      });

      const result = (await handlers.submit_catalog_request({
        sys_id: itemId,
        variables: { urgency: "high" },
        quantity: 1,
      })) as any;

      expect(snClient.post).toHaveBeenCalledWith(
        `/api/sn_sc/servicecatalog/items/${itemId}/order_now`,
        {
          sysparm_quantity: 1,
          variables: { urgency: "high" },
        }
      );
      expect(result.success).toBe(true);
      expect(result.data.self_link).toBe(
        `https://example.service-now.com/sc_request.do?sys_id=${requestId}`
      );
    });

    it("returns validation error for invalid sys_id", async () => {
      const { handlers, snClient } = setup();

      const result = (await handlers.submit_catalog_request({
        sys_id: "not-valid",
        variables: {},
        quantity: 1,
      })) as any;

      expect(result).toEqual({
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid sys_id format. Must be a 32-character hex string.",
        },
      });
      expect(snClient.post).not.toHaveBeenCalled();
    });
  });
});

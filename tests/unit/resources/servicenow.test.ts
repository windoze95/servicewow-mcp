import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerResources } from "../../../src/resources/servicenow.js";
import type { ToolContext } from "../../../src/tools/registry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FixedHandler = (uri: URL, extra: any) => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TemplateHandler = (uri: URL, variables: Record<string, string>, extra: any) => Promise<any>;

const VALID_SYS_ID = "0123456789abcdef0123456789abcdef";

describe("registerResources", () => {
  function setup() {
    const handlers: Record<string, FixedHandler | TemplateHandler> = {};

    const server = {
      resource: vi.fn((...args: unknown[]) => {
        const name = args[0] as string;
        const handler = args[args.length - 1] as FixedHandler | TemplateHandler;
        handlers[name] = handler;
      }),
    };

    const snClient = {
      get: vi.fn(),
      patch: vi.fn(),
      post: vi.fn(),
    };

    const ctx: ToolContext = {
      snClient: snClient as unknown as ToolContext["snClient"],
      instanceUrl: "https://example.service-now.com",
      userSysId: VALID_SYS_ID,
      userName: "john.doe",
      displayName: "John Doe",
    };

    const getContext = vi.fn().mockResolvedValue(ctx);

    registerResources(server as any, getContext);

    return { handlers, snClient, server, getContext, ctx };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers exactly 5 resources", () => {
    const { server } = setup();
    expect(server.resource).toHaveBeenCalledTimes(5);
  });

  it("registers resources with expected names", () => {
    const { server } = setup();
    const names = server.resource.mock.calls.map((c: unknown[]) => c[0]);
    expect(names).toEqual([
      "my_profile",
      "incident",
      "change_request",
      "kb_knowledge",
      "catalog",
    ]);
  });

  it("each resource has a description", () => {
    const { server } = setup();
    for (const call of server.resource.mock.calls) {
      // Description metadata is the 3rd argument (index 2)
      const meta = call[2] as { description: string };
      expect(typeof meta.description).toBe("string");
      expect(meta.description.length).toBeGreaterThan(0);
    }
  });

  describe("my_profile", () => {
    it("returns current user profile data", async () => {
      const { handlers, snClient } = setup();
      const userData = {
        sys_id: VALID_SYS_ID,
        user_name: "john.doe",
        name: "John Doe",
        email: "john.doe@example.com",
      };
      snClient.get.mockResolvedValue({ data: { result: userData } });

      const handler = handlers.my_profile as FixedHandler;
      const result = await handler(new URL("servicenow://me"), {});

      expect(snClient.get).toHaveBeenCalledWith(
        `/api/now/table/sys_user/${VALID_SYS_ID}`,
        {
          params: {
            sysparm_fields: "sys_id,user_name,name,first_name,last_name,email,phone,department,title,manager,active,employee_number,location,photo",
          },
        }
      );
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe("servicenow://me");
      expect(result.contents[0].mimeType).toBe("application/json");
      expect(JSON.parse(result.contents[0].text)).toEqual(userData);
    });

    it("returns error content when snClient throws", async () => {
      const { handlers, snClient } = setup();
      snClient.get.mockRejectedValue(new Error("Network timeout"));

      const handler = handlers.my_profile as FixedHandler;
      const result = await handler(new URL("servicenow://me"), {});

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe("application/json");
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.error).toBe("Network timeout");
    });
  });

  describe("incident", () => {
    it("returns incident data for valid sys_id", async () => {
      const { handlers, snClient } = setup();
      const incidentData = {
        sys_id: VALID_SYS_ID,
        number: "INC0010001",
        short_description: "Test incident",
      };
      snClient.get.mockResolvedValue({ data: { result: incidentData } });

      const handler = handlers.incident as TemplateHandler;
      const result = await handler(
        new URL(`servicenow://incident/${VALID_SYS_ID}`),
        { identifier: VALID_SYS_ID },
        {}
      );

      expect(snClient.get).toHaveBeenCalledWith(
        `/api/now/table/incident/${VALID_SYS_ID}`
      );
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe("application/json");
      expect(JSON.parse(result.contents[0].text)).toEqual(incidentData);
    });

    it("resolves incident by INC number", async () => {
      const { handlers, snClient } = setup();
      const incidentData = {
        sys_id: VALID_SYS_ID,
        number: "INC0010001",
        short_description: "Test incident",
      };
      snClient.get.mockResolvedValue({ data: { result: [incidentData] } });

      const handler = handlers.incident as TemplateHandler;
      const result = await handler(
        new URL("servicenow://incident/INC0010001"),
        { identifier: "INC0010001" },
        {}
      );

      expect(snClient.get).toHaveBeenCalledWith("/api/now/table/incident", {
        params: { sysparm_query: "number=INC0010001", sysparm_limit: 1 },
      });
      expect(JSON.parse(result.contents[0].text)).toEqual(incidentData);
    });

    it("returns not found for unknown INC number", async () => {
      const { handlers, snClient } = setup();
      snClient.get.mockResolvedValue({ data: { result: [] } });

      const handler = handlers.incident as TemplateHandler;
      const result = await handler(
        new URL("servicenow://incident/INC9999999"),
        { identifier: "INC9999999" },
        {}
      );

      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.error).toContain("INC9999999");
    });

    it("returns error for invalid identifier", async () => {
      const { handlers, snClient } = setup();

      const handler = handlers.incident as TemplateHandler;
      const result = await handler(
        new URL("servicenow://incident/bad-id"),
        { identifier: "bad-id" },
        {}
      );

      expect(snClient.get).not.toHaveBeenCalled();
      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.error).toContain("Invalid identifier");
    });

    it("returns error content when snClient throws", async () => {
      const { handlers, snClient } = setup();
      snClient.get.mockRejectedValue(new Error("Not found"));

      const handler = handlers.incident as TemplateHandler;
      const result = await handler(
        new URL(`servicenow://incident/${VALID_SYS_ID}`),
        { identifier: VALID_SYS_ID },
        {}
      );

      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.error).toBe("Not found");
    });
  });

  describe("change_request", () => {
    it("returns change request data for valid sys_id", async () => {
      const { handlers, snClient } = setup();
      const crData = {
        sys_id: VALID_SYS_ID,
        number: "CHG0010001",
        short_description: "Test change",
      };
      snClient.get.mockResolvedValue({ data: { result: crData } });

      const handler = handlers.change_request as TemplateHandler;
      const result = await handler(
        new URL(`servicenow://change_request/${VALID_SYS_ID}`),
        { identifier: VALID_SYS_ID },
        {}
      );

      expect(snClient.get).toHaveBeenCalledWith(
        `/api/now/table/change_request/${VALID_SYS_ID}`
      );
      expect(result.contents).toHaveLength(1);
      expect(JSON.parse(result.contents[0].text)).toEqual(crData);
    });

    it("resolves change request by CHG number", async () => {
      const { handlers, snClient } = setup();
      const crData = {
        sys_id: VALID_SYS_ID,
        number: "CHG0010001",
        short_description: "Test change",
      };
      snClient.get.mockResolvedValue({ data: { result: [crData] } });

      const handler = handlers.change_request as TemplateHandler;
      const result = await handler(
        new URL("servicenow://change_request/CHG0010001"),
        { identifier: "CHG0010001" },
        {}
      );

      expect(snClient.get).toHaveBeenCalledWith("/api/now/table/change_request", {
        params: { sysparm_query: "number=CHG0010001", sysparm_limit: 1 },
      });
      expect(JSON.parse(result.contents[0].text)).toEqual(crData);
    });

    it("returns not found for unknown CHG number", async () => {
      const { handlers, snClient } = setup();
      snClient.get.mockResolvedValue({ data: { result: [] } });

      const handler = handlers.change_request as TemplateHandler;
      const result = await handler(
        new URL("servicenow://change_request/CHG9999999"),
        { identifier: "CHG9999999" },
        {}
      );

      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.error).toContain("CHG9999999");
    });

    it("returns error for invalid identifier", async () => {
      const { handlers, snClient } = setup();

      const handler = handlers.change_request as TemplateHandler;
      const result = await handler(
        new URL("servicenow://change_request/not-valid"),
        { identifier: "not-valid" },
        {}
      );

      expect(snClient.get).not.toHaveBeenCalled();
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.error).toContain("Invalid identifier");
    });

    it("returns error content when snClient throws", async () => {
      const { handlers, snClient } = setup();
      snClient.get.mockRejectedValue(new Error("Server error"));

      const handler = handlers.change_request as TemplateHandler;
      const result = await handler(
        new URL(`servicenow://change_request/${VALID_SYS_ID}`),
        { identifier: VALID_SYS_ID },
        {}
      );

      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.error).toBe("Server error");
    });
  });

  describe("kb_knowledge", () => {
    it("returns knowledge article data for valid sys_id", async () => {
      const { handlers, snClient } = setup();
      const kbData = {
        sys_id: VALID_SYS_ID,
        number: "KB0010001",
        short_description: "Test article",
        text: "Article content",
      };
      snClient.get.mockResolvedValue({ data: { result: kbData } });

      const handler = handlers.kb_knowledge as TemplateHandler;
      const result = await handler(
        new URL(`servicenow://kb_knowledge/${VALID_SYS_ID}`),
        { sys_id: VALID_SYS_ID },
        {}
      );

      expect(snClient.get).toHaveBeenCalledWith(
        `/api/sn_km/knowledge/articles/${VALID_SYS_ID}`
      );
      expect(result.contents).toHaveLength(1);
      expect(JSON.parse(result.contents[0].text)).toEqual(kbData);
    });

    it("returns error for invalid sys_id", async () => {
      const { handlers, snClient } = setup();

      const handler = handlers.kb_knowledge as TemplateHandler;
      const result = await handler(
        new URL("servicenow://kb_knowledge/xyz"),
        { sys_id: "xyz" },
        {}
      );

      expect(snClient.get).not.toHaveBeenCalled();
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.error).toBe("Invalid sys_id format");
    });

    it("returns error content when snClient throws", async () => {
      const { handlers, snClient } = setup();
      snClient.get.mockRejectedValue(new Error("Forbidden"));

      const handler = handlers.kb_knowledge as TemplateHandler;
      const result = await handler(
        new URL(`servicenow://kb_knowledge/${VALID_SYS_ID}`),
        { sys_id: VALID_SYS_ID },
        {}
      );

      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.error).toBe("Forbidden");
    });
  });

  describe("catalog", () => {
    it("returns catalog item data for valid sys_id", async () => {
      const { handlers, snClient } = setup();
      const catalogData = {
        sys_id: VALID_SYS_ID,
        name: "Laptop Request",
        short_description: "Request a new laptop",
      };
      snClient.get.mockResolvedValue({ data: { result: catalogData } });

      const handler = handlers.catalog as TemplateHandler;
      const result = await handler(
        new URL(`servicenow://catalog/${VALID_SYS_ID}`),
        { sys_id: VALID_SYS_ID },
        {}
      );

      expect(snClient.get).toHaveBeenCalledWith(
        `/api/sn_sc/servicecatalog/items/${VALID_SYS_ID}`
      );
      expect(result.contents).toHaveLength(1);
      expect(JSON.parse(result.contents[0].text)).toEqual(catalogData);
    });

    it("returns error for invalid sys_id", async () => {
      const { handlers, snClient } = setup();

      const handler = handlers.catalog as TemplateHandler;
      const result = await handler(
        new URL("servicenow://catalog/!!!"),
        { sys_id: "!!!" },
        {}
      );

      expect(snClient.get).not.toHaveBeenCalled();
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.error).toBe("Invalid sys_id format");
    });

    it("returns error content when snClient throws", async () => {
      const { handlers, snClient } = setup();
      snClient.get.mockRejectedValue(new Error("Unauthorized"));

      const handler = handlers.catalog as TemplateHandler;
      const result = await handler(
        new URL(`servicenow://catalog/${VALID_SYS_ID}`),
        { sys_id: VALID_SYS_ID },
        {}
      );

      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.error).toBe("Unauthorized");
    });
  });

  describe("error fallback message", () => {
    it("uses fallback when error has no message property", async () => {
      const { handlers, snClient } = setup();
      snClient.get.mockRejectedValue({ code: "UNKNOWN" });

      const handler = handlers.my_profile as FixedHandler;
      const result = await handler(new URL("servicenow://me"), {});

      expect(result.contents).toHaveLength(1);
      const parsed = JSON.parse(result.contents[0].text);
      expect(parsed.error).toBe("Failed to read resource");
    });
  });
});

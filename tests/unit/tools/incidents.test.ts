import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerIncidentTools } from "../../../src/tools/incidents.js";
import type { ToolContext } from "../../../src/tools/registry.js";

type WrappedHandler<T = unknown> = (args: T) => Promise<unknown>;

describe("registerIncidentTools", () => {
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

    registerIncidentTools(server as any, wrapHandler);

    return { handlers, snClient, server };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("search_incidents returns results with self_link", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: {
        result: [
          { sys_id: "inc-sys-id-001", number: "INC0010001", short_description: "Server down" },
        ],
      },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.search_incidents({
      query: "Server",
      limit: 10,
      offset: 0,
    })) as any;

    expect(snClient.get).toHaveBeenCalledWith("/api/now/table/incident", {
      params: {
        sysparm_query: "short_descriptionLIKEServer^ORDERBYDESCsys_updated_on",
        sysparm_limit: 10,
        sysparm_offset: 0,
        sysparm_fields:
          "sys_id,number,short_description,state,priority,impact,urgency,assigned_to,assignment_group,caller_id,category,opened_at,sys_updated_on",
      },
    });
    expect(result.success).toBe(true);
    expect(result.data[0].self_link).toBe(
      "https://example.service-now.com/incident.do?sys_id=inc-sys-id-001"
    );
    expect(result.metadata).toEqual({
      total_count: 1,
      returned_count: 1,
      offset: 0,
    });
  });

  it("get_incident resolves by incident number and returns self_link", async () => {
    const { handlers, snClient } = setup();
    const incSysId = "0123456789abcdef0123456789abcdef";

    snClient.get.mockResolvedValue({
      data: {
        result: [
          { sys_id: incSysId, number: "INC0012345", short_description: "Printer jam" },
        ],
      },
      headers: {},
    });

    const result = (await handlers.get_incident({
      identifier: "INC0012345",
    })) as any;

    expect(snClient.get).toHaveBeenCalledWith("/api/now/table/incident", {
      params: {
        sysparm_query: "number=INC0012345",
        sysparm_limit: 1,
      },
    });
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/incident.do?sys_id=${incSysId}`
    );
  });

  it("get_incident returns VALIDATION_ERROR for invalid identifier", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.get_incident({
      identifier: "bad-id",
    })) as any;

    expect(result).toEqual({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message:
          "Invalid identifier. Provide an incident number (INC...) or a 32-character sys_id.",
      },
    });
    expect(snClient.get).not.toHaveBeenCalled();
  });

  it("create_incident sets caller_id to ctx.userSysId and returns self_link", async () => {
    const { handlers, snClient } = setup();
    const newSysId = "fedcba9876543210fedcba9876543210";

    snClient.post.mockResolvedValue({
      data: {
        result: {
          sys_id: newSysId,
          number: "INC0099999",
          short_description: "New issue",
          caller_id: userSysId,
        },
      },
      headers: {},
    });

    const result = (await handlers.create_incident({
      short_description: "New issue",
      impact: 2,
      urgency: 2,
    })) as any;

    expect(snClient.post).toHaveBeenCalledWith("/api/now/table/incident", {
      short_description: "New issue",
      caller_id: userSysId,
      impact: 2,
      urgency: 2,
      priority: 3,
    });
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/incident.do?sys_id=${newSysId}`
    );
  });

  it("update_incident resolves number then patches and returns self_link", async () => {
    const { handlers, snClient } = setup();
    const incSysId = "aabbccddaabbccddaabbccddaabbccdd";

    // First call: number lookup
    snClient.get.mockResolvedValueOnce({
      data: { result: [{ sys_id: incSysId }] },
      headers: {},
    });

    // Second call: patch
    snClient.patch.mockResolvedValue({
      data: {
        result: {
          sys_id: incSysId,
          number: "INC0010001",
          state: "In Progress",
        },
      },
      headers: {},
    });

    const result = (await handlers.update_incident({
      identifier: "INC0010001",
      fields: { state: "In Progress" },
    })) as any;

    expect(snClient.get).toHaveBeenCalledWith("/api/now/table/incident", {
      params: {
        sysparm_query: "number=INC0010001",
        sysparm_limit: 1,
        sysparm_fields: "sys_id",
      },
    });
    expect(snClient.patch).toHaveBeenCalledWith(
      `/api/now/table/incident/${incSysId}`,
      { state: "In Progress" }
    );
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/incident.do?sys_id=${incSysId}`
    );
  });

  it("search_incidents builds query with all filter options", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [] },
      headers: { "x-total-count": "0" },
    });

    await handlers.search_incidents({
      query: "VPN",
      state: "New",
      priority: "1",
      assigned_to_me: true,
      assignment_group: "Network",
      limit: 5,
      offset: 10,
    });

    const call = snClient.get.mock.calls[0];
    const query = call[1].params.sysparm_query;
    expect(query).toContain("short_descriptionLIKEVPN");
    expect(query).toContain("state=New");
    expect(query).toContain("priority=1");
    expect(query).toContain(`assigned_to=${userSysId}`);
    expect(query).toContain("assignment_groupLIKENetwork");
  });

  it("get_incident resolves by sys_id directly", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get.mockResolvedValue({
      data: { result: { sys_id: sysId, number: "INC0010001" } },
      headers: {},
    });

    const result = (await handlers.get_incident({ identifier: sysId })) as any;

    expect(snClient.get).toHaveBeenCalledWith(
      `/api/now/table/incident/${sysId}`,
      { params: {} }
    );
    expect(result.success).toBe(true);
  });

  it("get_incident returns NOT_FOUND when no match", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [] },
      headers: {},
    });

    const result = (await handlers.get_incident({ identifier: "INC9999999" })) as any;
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("create_incident includes optional fields and computes priority", async () => {
    const { handlers, snClient } = setup();

    snClient.post.mockResolvedValue({
      data: { result: { sys_id: "0123456789abcdef0123456789abcdef" } },
      headers: {},
    });

    await handlers.create_incident({
      short_description: "Test",
      description: "Full details",
      impact: 1,
      urgency: 2,
      category: "Software",
      subcategory: "Email",
      assignment_group: "IT",
      cmdb_ci: "Mail Server",
    });

    const body = snClient.post.mock.calls[0][1];
    expect(body.description).toBe("Full details");
    expect(body.category).toBe("Software");
    expect(body.subcategory).toBe("Email");
    expect(body.assignment_group).toBe("IT");
    expect(body.cmdb_ci).toBe("Mail Server");
    expect(body.priority).toBe(2);
  });

  it("update_incident returns VALIDATION_ERROR for invalid identifier", async () => {
    const { handlers } = setup();

    const result = (await handlers.update_incident({
      identifier: "bad",
      fields: { state: "Closed" },
    })) as any;

    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("update_incident returns NOT_FOUND when number lookup fails", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({ data: { result: [] }, headers: {} });

    const result = (await handlers.update_incident({
      identifier: "INC0099999",
      fields: { state: "Closed" },
    })) as any;

    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("add_work_note uses comments field for comment type", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.patch.mockResolvedValue({
      data: { result: { sys_id: sysId } },
      headers: {},
    });

    const result = (await handlers.add_work_note({
      identifier: sysId,
      note: "Customer update",
      type: "comment",
    })) as any;

    expect(snClient.patch).toHaveBeenCalledWith(
      `/api/now/table/incident/${sysId}`,
      { comments: "Customer update" }
    );
    expect(result.data.message).toBe("Comment added successfully");
  });

  it("add_work_note returns VALIDATION_ERROR for invalid identifier", async () => {
    const { handlers } = setup();

    const result = (await handlers.add_work_note({
      identifier: "bad",
      note: "test",
      type: "work_note",
    })) as any;

    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("add_work_note returns NOT_FOUND when number lookup fails", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({ data: { result: [] }, headers: {} });

    const result = (await handlers.add_work_note({
      identifier: "INC9999999",
      note: "test",
      type: "work_note",
    })) as any;

    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("add_work_note resolves number then patches and returns self_link", async () => {
    const { handlers, snClient } = setup();
    const incSysId = "11223344556677881122334455667788";

    // Number lookup
    snClient.get.mockResolvedValueOnce({
      data: { result: [{ sys_id: incSysId }] },
      headers: {},
    });

    // Patch
    snClient.patch.mockResolvedValue({
      data: {
        result: { sys_id: incSysId, work_notes: "Investigating now" },
      },
      headers: {},
    });

    const result = (await handlers.add_work_note({
      identifier: "INC0010002",
      note: "Investigating now",
      type: "work_note",
    })) as any;

    expect(snClient.patch).toHaveBeenCalledWith(
      `/api/now/table/incident/${incSysId}`,
      { work_notes: "Investigating now" }
    );
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/incident.do?sys_id=${incSysId}`
    );
    expect(result.data.message).toBe("Work note added successfully");
  });
});

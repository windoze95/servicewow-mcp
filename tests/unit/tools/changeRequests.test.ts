import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerChangeRequestTools } from "../../../src/tools/changeRequests.js";
import type { ToolContext } from "../../../src/tools/registry.js";

type WrappedHandler<T = unknown> = (args: T) => Promise<unknown>;

describe("registerChangeRequestTools", () => {
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

    registerChangeRequestTools(server as any, wrapHandler);

    return { handlers, snClient, server };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- search_change_requests ---

  it("search_change_requests returns results with self_link", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: {
        result: [
          { sys_id: "chg-sys-id-001", number: "CHG0010001", short_description: "Deploy patch" },
        ],
      },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.search_change_requests({
      query: "Deploy",
      limit: 10,
      offset: 0,
    })) as any;

    expect(snClient.get).toHaveBeenCalledWith("/api/now/table/change_request", {
      params: {
        sysparm_query: "short_descriptionLIKEDeploy^ORDERBYDESCsys_updated_on",
        sysparm_limit: 10,
        sysparm_offset: 0,
        sysparm_fields:
          "sys_id,number,short_description,state,type,priority,impact,urgency,risk,assigned_to,assignment_group,requested_by,category,start_date,end_date,sys_updated_on",
      },
    });
    expect(result.success).toBe(true);
    expect(result.data[0].self_link).toBe(
      "https://example.service-now.com/change_request.do?sys_id=chg-sys-id-001"
    );
    expect(result.metadata).toEqual({
      total_count: 1,
      returned_count: 1,
      offset: 0,
    });
  });

  it("search_change_requests builds query with all filter options", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [] },
      headers: { "x-total-count": "0" },
    });

    await handlers.search_change_requests({
      query: "Network",
      state: "Implement",
      type: "Emergency",
      priority: "1",
      assigned_to_me: true,
      assignment_group: "CAB",
      limit: 5,
      offset: 10,
    });

    const call = snClient.get.mock.calls[0];
    const query = call[1].params.sysparm_query;
    expect(query).toContain("short_descriptionLIKENetwork");
    expect(query).toContain("state=Implement");
    expect(query).toContain("type=Emergency");
    expect(query).toContain("priority=1");
    expect(query).toContain(`assigned_to=${userSysId}`);
    expect(query).toContain("assignment_groupLIKECAB");
  });

  it("search_change_requests escapes encoded query injection characters", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [] },
      headers: { "x-total-count": "0" },
    });

    await handlers.search_change_requests({
      query: "test^NQassigned_to=admin",
      state: "New^active=false",
      type: "Normal,Emergency",
      limit: 10,
      offset: 0,
    });

    const call = snClient.get.mock.calls[0];
    const query = call[1].params.sysparm_query;
    expect(query).toContain("short_descriptionLIKEtest\\^NQassigned_to=admin");
    expect(query).toContain("state=New\\^active=false");
    expect(query).toContain("type=Normal\\,Emergency");
  });

  // --- get_change_request ---

  it("get_change_request resolves by CHG number and returns self_link", async () => {
    const { handlers, snClient } = setup();
    const chgSysId = "0123456789abcdef0123456789abcdef";

    snClient.get.mockResolvedValue({
      data: {
        result: [
          { sys_id: chgSysId, number: "CHG0012345", short_description: "Server upgrade" },
        ],
      },
      headers: {},
    });

    const result = (await handlers.get_change_request({
      identifier: "CHG0012345",
    })) as any;

    expect(snClient.get).toHaveBeenCalledWith("/api/now/table/change_request", {
      params: {
        sysparm_query: "number=CHG0012345",
        sysparm_limit: 1,
      },
    });
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/change_request.do?sys_id=${chgSysId}`
    );
  });

  it("get_change_request resolves by sys_id directly", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get.mockResolvedValue({
      data: { result: { sys_id: sysId, number: "CHG0010001" } },
      headers: {},
    });

    const result = (await handlers.get_change_request({ identifier: sysId })) as any;

    expect(snClient.get).toHaveBeenCalledWith(
      `/api/now/table/change_request/${sysId}`,
      { params: {} }
    );
    expect(result.success).toBe(true);
  });

  it("get_change_request returns VALIDATION_ERROR for invalid identifier", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.get_change_request({
      identifier: "bad-id",
    })) as any;

    expect(result).toEqual({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message:
          "Invalid identifier. Provide a change number (CHG...) or a 32-character sys_id.",
      },
    });
    expect(snClient.get).not.toHaveBeenCalled();
  });

  it("get_change_request returns NOT_FOUND when no match", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [] },
      headers: {},
    });

    const result = (await handlers.get_change_request({ identifier: "CHG9999999" })) as any;
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("NOT_FOUND");
  });

  // --- create_change_request ---

  it("create_change_request sets requested_by to ctx.userSysId and returns self_link", async () => {
    const { handlers, snClient } = setup();
    const newSysId = "fedcba9876543210fedcba9876543210";

    snClient.post.mockResolvedValue({
      data: {
        result: {
          sys_id: newSysId,
          number: "CHG0099999",
          short_description: "New change",
          requested_by: userSysId,
        },
      },
      headers: {},
    });

    const result = (await handlers.create_change_request({
      short_description: "New change",
      impact: 2,
      urgency: 2,
    })) as any;

    expect(snClient.post).toHaveBeenCalledWith("/api/now/table/change_request", {
      short_description: "New change",
      requested_by: userSysId,
      impact: 2,
      urgency: 2,
    });
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/change_request.do?sys_id=${newSysId}`
    );
  });

  it("create_change_request includes optional fields and computes priority", async () => {
    const { handlers, snClient } = setup();

    snClient.post.mockResolvedValue({
      data: { result: { sys_id: "0123456789abcdef0123456789abcdef" } },
      headers: {},
    });

    await handlers.create_change_request({
      short_description: "Test",
      description: "Full details",
      type: "Emergency",
      impact: 1,
      urgency: 2,
      category: "Hardware",
      assignment_group: "CAB",
      cmdb_ci: "App Server",
      start_date: "2026-04-01T08:00:00Z",
      end_date: "2026-04-01T12:00:00Z",
    });

    const body = snClient.post.mock.calls[0][1];
    expect(body.description).toBe("Full details");
    expect(body.type).toBe("Emergency");
    expect(body.category).toBe("Hardware");
    expect(body.assignment_group).toBe("CAB");
    expect(body.cmdb_ci).toBe("App Server");
    expect(body.start_date).toBe("2026-04-01T08:00:00Z");
    expect(body.end_date).toBe("2026-04-01T12:00:00Z");
    expect(body.priority).toBeUndefined();
  });

  // --- update_change_request ---

  it("update_change_request resolves number then patches and returns self_link", async () => {
    const { handlers, snClient } = setup();
    const chgSysId = "aabbccddaabbccddaabbccddaabbccdd";

    // Number lookup
    snClient.get.mockResolvedValueOnce({
      data: { result: [{ sys_id: chgSysId }] },
      headers: {},
    });

    // Patch
    snClient.patch.mockResolvedValue({
      data: {
        result: {
          sys_id: chgSysId,
          number: "CHG0010001",
          state: "Implement",
        },
      },
      headers: {},
    });

    const result = (await handlers.update_change_request({
      identifier: "CHG0010001",
      fields: { state: "Implement" },
    })) as any;

    expect(snClient.get).toHaveBeenCalledWith("/api/now/table/change_request", {
      params: {
        sysparm_query: "number=CHG0010001",
        sysparm_limit: 1,
        sysparm_fields: "sys_id",
      },
    });
    expect(snClient.patch).toHaveBeenCalledWith(
      `/api/now/table/change_request/${chgSysId}`,
      { state: "Implement" }
    );
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/change_request.do?sys_id=${chgSysId}`
    );
  });

  it("update_change_request returns VALIDATION_ERROR for invalid identifier", async () => {
    const { handlers } = setup();

    const result = (await handlers.update_change_request({
      identifier: "bad",
      fields: { state: "Closed" },
    })) as any;

    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("update_change_request returns NOT_FOUND when number lookup fails", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({ data: { result: [] }, headers: {} });

    const result = (await handlers.update_change_request({
      identifier: "CHG0099999",
      fields: { state: "Closed" },
    })) as any;

    expect(result.error.code).toBe("NOT_FOUND");
  });

  it("update_change_request strips readonly fields via sanitizeUpdatePayload", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.patch.mockResolvedValue({
      data: { result: { sys_id: sysId, state: "Review" } },
      headers: {},
    });

    await handlers.update_change_request({
      identifier: sysId,
      fields: { state: "Review", sys_id: "hacked", number: "CHG000", opened_by: "someone" },
    });

    expect(snClient.patch).toHaveBeenCalledWith(
      `/api/now/table/change_request/${sysId}`,
      { state: "Review" }
    );
  });

  // --- get_change_request_approvals ---

  it("get_change_request_approvals returns linked approvals with offset in metadata", async () => {
    const { handlers, snClient } = setup();
    const chgSysId = "0123456789abcdef0123456789abcdef";

    snClient.get.mockResolvedValue({
      data: {
        result: [
          { sys_id: "appr-001", state: "approved", approver: "mgr-001", sysapproval: chgSysId },
        ],
      },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.get_change_request_approvals({
      identifier: chgSysId,
      offset: 0,
    })) as any;

    expect(snClient.get).toHaveBeenCalledWith("/api/now/table/sysapproval_approver", {
      params: {
        sysparm_query: `sysapproval=${chgSysId}^ORDERBYDESCsys_created_on`,
        sysparm_limit: 100,
        sysparm_offset: 0,
        sysparm_fields:
          "sys_id,state,approver,sysapproval,source_table,comments,due_date,sys_created_on,sys_updated_on",
      },
    });
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.metadata.change_request_sys_id).toBe(chgSysId);
    expect(result.metadata.offset).toBe(0);
  });

  it("get_change_request_approvals passes offset to paginator startOffset", async () => {
    const { handlers, snClient } = setup();
    const chgSysId = "0123456789abcdef0123456789abcdef";

    snClient.get.mockResolvedValue({
      data: {
        result: [{ sys_id: "appr-500", state: "requested", approver: "mgr-001", sysapproval: chgSysId }],
      },
      headers: { "x-total-count": "501" },
    });

    const result = (await handlers.get_change_request_approvals({
      identifier: chgSysId,
      offset: 500,
    })) as any;

    expect(snClient.get).toHaveBeenCalledWith("/api/now/table/sysapproval_approver", {
      params: {
        sysparm_query: `sysapproval=${chgSysId}^ORDERBYDESCsys_created_on`,
        sysparm_limit: 100,
        sysparm_offset: 500,
        sysparm_fields:
          "sys_id,state,approver,sysapproval,source_table,comments,due_date,sys_created_on,sys_updated_on",
      },
    });
    expect(result.success).toBe(true);
    expect(result.metadata.offset).toBe(500);
    expect(result.metadata.returned_count).toBe(1);
  });

  it("get_change_request_approvals resolves CHG number", async () => {
    const { handlers, snClient } = setup();
    const chgSysId = "aabbccddaabbccddaabbccddaabbccdd";

    // Number lookup
    snClient.get.mockResolvedValueOnce({
      data: { result: [{ sys_id: chgSysId }] },
      headers: {},
    });

    // Approvals query
    snClient.get.mockResolvedValueOnce({
      data: { result: [] },
      headers: {},
    });

    const result = (await handlers.get_change_request_approvals({
      identifier: "CHG0010001",
    })) as any;

    expect(snClient.get).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.metadata.change_request_sys_id).toBe(chgSysId);
  });

  it("get_change_request_approvals returns NOT_FOUND for unknown CHG", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({ data: { result: [] }, headers: {} });

    const result = (await handlers.get_change_request_approvals({
      identifier: "CHG9999999",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("NOT_FOUND");
  });

  // --- add_change_request_work_note ---

  it("add_change_request_work_note uses work_notes field for work_note type", async () => {
    const { handlers, snClient } = setup();
    const chgSysId = "11223344556677881122334455667788";

    // Number lookup
    snClient.get.mockResolvedValueOnce({
      data: { result: [{ sys_id: chgSysId }] },
      headers: {},
    });

    // Patch
    snClient.patch.mockResolvedValue({
      data: {
        result: { sys_id: chgSysId, work_notes: "Investigating now" },
      },
      headers: {},
    });

    const result = (await handlers.add_change_request_work_note({
      identifier: "CHG0010002",
      note: "Investigating now",
      type: "work_note",
    })) as any;

    expect(snClient.patch).toHaveBeenCalledWith(
      `/api/now/table/change_request/${chgSysId}`,
      { work_notes: "Investigating now" }
    );
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/change_request.do?sys_id=${chgSysId}`
    );
    expect(result.data.message).toBe("Work note added successfully");
  });

  it("add_change_request_work_note uses comments field for comment type", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.patch.mockResolvedValue({
      data: { result: { sys_id: sysId } },
      headers: {},
    });

    const result = (await handlers.add_change_request_work_note({
      identifier: sysId,
      note: "Customer update",
      type: "comment",
    })) as any;

    expect(snClient.patch).toHaveBeenCalledWith(
      `/api/now/table/change_request/${sysId}`,
      { comments: "Customer update" }
    );
    expect(result.data.message).toBe("Comment added successfully");
  });

  it("add_change_request_work_note returns VALIDATION_ERROR for invalid identifier", async () => {
    const { handlers } = setup();

    const result = (await handlers.add_change_request_work_note({
      identifier: "bad",
      note: "test",
      type: "work_note",
    })) as any;

    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("add_change_request_work_note returns NOT_FOUND when number lookup fails", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({ data: { result: [] }, headers: {} });

    const result = (await handlers.add_change_request_work_note({
      identifier: "CHG9999999",
      note: "test",
      type: "work_note",
    })) as any;

    expect(result.error.code).toBe("NOT_FOUND");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerFlowLogTools } from "../../../src/tools/flowLogs.js";
import type { ToolContext } from "../../../src/tools/registry.js";

type WrappedHandler<T = unknown> = (args: T) => Promise<unknown>;

describe("registerFlowLogTools", () => {
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

    registerFlowLogTools(server as never, wrapHandler);

    return { handlers, snClient, server };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("search_flow_executions builds query with name, state, date bounds and returns self_link", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: {
        result: [
          {
            sys_id: "ctx-sys-id-001",
            name: "Create Incident Tasks",
            state: "ERROR",
          },
        ],
      },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.search_flow_executions({
      flow_name: "Create Incident",
      state: "ERROR",
      started_after: "2026-05-01",
      started_before: "2026-05-15",
      limit: 20,
      offset: 0,
    })) as {
      success: boolean;
      data: { sys_id: string; self_link: string }[];
      metadata: { total_count: number; returned_count: number; offset: number };
    };

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sys_flow_context",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query:
            "nameLIKECreate Incident^state=ERROR^started>=2026-05-01 00:00:00^started<=2026-05-15 23:59:59^ORDERBYDESCstarted",
          sysparm_limit: 20,
          sysparm_offset: 0,
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data[0].self_link).toBe(
      "https://example.service-now.com/sys_flow_context.do?sys_id=ctx-sys-id-001"
    );
    expect(result.metadata).toEqual({
      total_count: 1,
      returned_count: 1,
      offset: 0,
    });
  });

  it("search_flow_executions maps errors_only to state=ERROR", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [] },
      headers: { "x-total-count": "0" },
    });

    await handlers.search_flow_executions({
      errors_only: true,
      limit: 20,
      offset: 0,
    });

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sys_flow_context",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: "state=ERROR^ORDERBYDESCstarted",
        }),
      })
    );
  });

  it("search_flow_executions accepts valid reference sys_ids", async () => {
    const { handlers, snClient } = setup();
    const flow = "ed72db164738b6d4718d8a12736d4339";
    const sourceRecord = "5fef879647f4b6d4718d8a12736d43fd";

    snClient.get.mockResolvedValue({
      data: { result: [] },
      headers: { "x-total-count": "0" },
    });

    await handlers.search_flow_executions({
      flow,
      source_record: sourceRecord,
      source_table: "incident",
      limit: 20,
      offset: 0,
    });

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sys_flow_context",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: `flow=${flow}^source_record=${sourceRecord}^source_table=incident^ORDERBYDESCstarted`,
        }),
      })
    );
  });

  it("search_flow_executions rejects errors_only combined with explicit state", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.search_flow_executions({
      errors_only: true,
      state: "COMPLETE",
      limit: 20,
      offset: 0,
    })) as { success: boolean; error: { code: string } };

    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("search_flow_executions rejects an invalid flow sys_id", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.search_flow_executions({
      flow: "not-a-sys-id",
      limit: 20,
      offset: 0,
    })) as { success: boolean; error: { code: string } };

    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("search_flow_executions rejects an invalid date", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.search_flow_executions({
      started_after: "not-a-date",
      limit: 20,
      offset: 0,
    })) as { success: boolean; error: { code: string } };

    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("get_flow_execution returns the context plus its logs and a truncation flag", async () => {
    const { handlers, snClient } = setup();
    const ctxSysId = "0123456789abcdef0123456789abcdef";

    snClient.get
      .mockResolvedValueOnce({
        data: {
          result: {
            sys_id: ctxSysId,
            name: "Create Incident Tasks",
            state: "ERROR",
          },
        },
        headers: {},
      })
      .mockResolvedValueOnce({
        data: {
          result: [
            {
              sys_id: "log-sys-id-001",
              level: "ERROR",
              message: "Step 2 failed: undefined is not an object",
            },
          ],
        },
        headers: { "x-total-count": "5" },
      });

    const result = (await handlers.get_flow_execution({
      sys_id: ctxSysId,
      include_logs: true,
      log_limit: 1,
    })) as {
      success: boolean;
      data: {
        self_link: string;
        logs: { sys_id: string; self_link: string }[];
        log_metadata: {
          total_count: number;
          returned_count: number;
          truncated: boolean;
        };
      };
    };

    expect(snClient.get).toHaveBeenNthCalledWith(
      1,
      `/api/now/table/sys_flow_context/${ctxSysId}`
    );
    expect(snClient.get).toHaveBeenNthCalledWith(
      2,
      "/api/now/table/sys_flow_log",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: `context=${ctxSysId}^ORDERBYsys_created_on`,
          sysparm_limit: 1,
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/sys_flow_context.do?sys_id=${ctxSysId}`
    );
    expect(result.data.logs[0].self_link).toBe(
      "https://example.service-now.com/sys_flow_log.do?sys_id=log-sys-id-001"
    );
    expect(result.data.log_metadata).toEqual({
      total_count: 5,
      returned_count: 1,
      truncated: true,
    });
  });

  it("get_flow_execution skips the log fetch when include_logs is false", async () => {
    const { handlers, snClient } = setup();
    const ctxSysId = "0123456789abcdef0123456789abcdef";

    snClient.get.mockResolvedValue({
      data: { result: { sys_id: ctxSysId, name: "Create Incident Tasks" } },
      headers: {},
    });

    const result = (await handlers.get_flow_execution({
      sys_id: ctxSysId,
      include_logs: false,
      log_limit: 200,
    })) as { success: boolean; data: Record<string, unknown> };

    expect(snClient.get).toHaveBeenCalledTimes(1);
    expect(snClient.get).toHaveBeenCalledWith(
      `/api/now/table/sys_flow_context/${ctxSysId}`
    );
    expect(result.success).toBe(true);
    expect(result.data.logs).toBeUndefined();
    expect(result.data.log_metadata).toBeUndefined();
  });

  it("get_flow_execution rejects an invalid sys_id", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.get_flow_execution({
      sys_id: "not-a-sys-id",
      include_logs: true,
      log_limit: 200,
    })) as { success: boolean; error: { code: string } };

    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

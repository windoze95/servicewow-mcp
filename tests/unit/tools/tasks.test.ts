import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerTaskTools } from "../../../src/tools/tasks.js";
import type { ToolContext } from "../../../src/tools/registry.js";

type WrappedHandler<T = unknown> = (args: T) => Promise<unknown>;

describe("registerTaskTools", () => {
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

    registerTaskTools(server as any, wrapHandler);

    return { handlers, snClient, server };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns validation error for invalid approval sys_id", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.approve_or_reject({
      sys_id: "bad-id",
      action: "approved",
    })) as any;

    expect(result).toEqual({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid sys_id format",
      },
    });
    expect(snClient.get).not.toHaveBeenCalled();
    expect(snClient.patch).not.toHaveBeenCalled();
  });

  it("returns forbidden when approval does not belong to authenticated user", async () => {
    const { handlers, snClient } = setup();
    const approvalId = "0123456789abcdef0123456789abcdef";

    snClient.get.mockResolvedValue({ data: { result: [] }, headers: {} });

    const result = (await handlers.approve_or_reject({
      sys_id: approvalId,
      action: "rejected",
    })) as any;

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sysapproval_approver",
      {
        params: {
          sysparm_query: `sys_id=${approvalId}^approver=${userSysId}`,
          sysparm_limit: 1,
          sysparm_fields: "sys_id",
        },
      }
    );
    expect(result).toEqual({
      success: false,
      error: {
        code: "FORBIDDEN",
        message:
          "Approval not found or does not belong to the authenticated user",
      },
    });
  });

  it("approves request with optional comments", async () => {
    const { handlers, snClient } = setup();
    const approvalId = "fedcba9876543210fedcba9876543210";

    snClient.get.mockResolvedValue({
      data: { result: [{ sys_id: approvalId }] },
      headers: {},
    });
    snClient.patch.mockResolvedValue({
      data: {
        result: {
          sys_id: approvalId,
          state: "approved",
          comments: "LGTM",
        },
      },
      headers: {},
    });

    const result = (await handlers.approve_or_reject({
      sys_id: approvalId,
      action: "approved",
      comments: "LGTM",
    })) as any;

    expect(snClient.patch).toHaveBeenCalledWith(
      `/api/now/table/sysapproval_approver/${approvalId}`,
      {
        state: "approved",
        comments: "LGTM",
      }
    );
    expect(result).toEqual({
      success: true,
      data: {
        sys_id: approvalId,
        state: "approved",
        comments: "LGTM",
        self_link: `https://example.service-now.com/sysapproval_approver.do?sys_id=${approvalId}`,
      },
      message: "Approval approved successfully",
    });
  });

  it("builds get_my_tasks query scoped to authenticated user", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [{ sys_id: "task-1" }] },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.get_my_tasks({})) as any;

    expect(snClient.get).toHaveBeenCalledWith("/api/now/table/task", {
      params: {
        sysparm_query: `assigned_to=${userSysId}^active=true^ORDERBYDESCsys_updated_on`,
        sysparm_limit: 100,
        sysparm_offset: 0,
        sysparm_fields:
          "sys_id,number,short_description,state,priority,assigned_to,assignment_group,sys_class_name,opened_at,due_date,sys_updated_on",
      },
    });
    expect(result.metadata).toEqual({
      total_count: 1,
    });
  });
});

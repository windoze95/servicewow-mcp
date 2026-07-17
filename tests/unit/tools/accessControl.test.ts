import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerAccessControlTools } from "../../../src/tools/accessControl.js";
import type { ToolContext } from "../../../src/tools/registry.js";

type WrappedHandler<T = unknown> = (args: T) => Promise<unknown>;

describe("registerAccessControlTools", () => {
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

    const snClient = { get: vi.fn(), patch: vi.fn(), post: vi.fn() };

    const ctx: ToolContext = {
      snClient: snClient as unknown as ToolContext["snClient"],
      instanceUrl: "https://example.service-now.com",
      userSysId: "abc123def456abc123def456abc12345",
      userName: "john.doe",
      displayName: "John Doe",
    };

    const wrapHandler = <T>(
      _toolName: string,
      handler: (context: ToolContext, args: T) => Promise<unknown>
    ) => {
      return async (args: T) => handler(ctx, args);
    };

    registerAccessControlTools(server as never, wrapHandler);
    return { handlers, snClient };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("search_acls builds query from name, operation, type, active and orders by name", async () => {
    const { handlers, snClient } = setup();
    snClient.get.mockResolvedValue({
      data: { result: [{ sys_id: "acl-1", name: "incident.state", operation: "write" }] },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.search_acls({
      name: "incident.state",
      operation: "write",
      type: "record",
      active: true,
      limit: 20,
      offset: 0,
    })) as { success: boolean; data: { self_link: string }[] };

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sys_security_acl",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query:
            "nameLIKEincident.state^operation=write^type=record^active=true^ORDERBYname",
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data[0].self_link).toBe(
      "https://example.service-now.com/sys_security_acl.do?sys_id=acl-1"
    );
  });

  it("get_acl fetches the ACL and its roles via sys_security_acl", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get
      .mockResolvedValueOnce({
        data: { result: { sys_id: sysId, name: "incident.state", operation: "write" } },
        headers: {},
      })
      .mockResolvedValueOnce({
        data: { result: [{ sys_id: "aclrole-1", sys_user_role: "itil" }] },
        headers: { "x-total-count": "1" },
      });

    const result = (await handlers.get_acl({
      sys_id: sysId,
      role_limit: 200,
    })) as {
      success: boolean;
      data: {
        self_link: string;
        roles: { sys_id: string; sys_user_role: string; self_link: string }[];
        role_metadata: { total_count: number; truncated: boolean };
      };
    };

    expect(snClient.get).toHaveBeenNthCalledWith(
      1,
      `/api/now/table/sys_security_acl/${sysId}`
    );
    expect(snClient.get).toHaveBeenNthCalledWith(
      2,
      "/api/now/table/sys_security_acl_role",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: `sys_security_acl=${sysId}`,
          sysparm_fields: "sys_id,sys_user_role",
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data.roles[0].sys_user_role).toBe("itil");
    expect(result.data.roles[0].self_link).toBe(
      "https://example.service-now.com/sys_security_acl_role.do?sys_id=aclrole-1"
    );
    expect(result.data.role_metadata).toEqual({
      total_count: 1,
      returned_count: 1,
      truncated: false,
    });
  });

  it("get_acl rejects an invalid sys_id", async () => {
    const { handlers, snClient } = setup();
    const result = (await handlers.get_acl({
      sys_id: "not-valid",
      role_limit: 200,
    })) as { success: boolean; error: { code: string } };
    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

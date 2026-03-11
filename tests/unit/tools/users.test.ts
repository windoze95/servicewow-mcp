import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerUserTools } from "../../../src/tools/users.js";
import type { ToolContext } from "../../../src/tools/registry.js";

type WrappedHandler<T = unknown> = (args: T) => Promise<unknown>;

describe("registerUserTools", () => {
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

    registerUserTools(server as any, wrapHandler);

    return { handlers, snClient, server };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lookup_user returns users with sys_user self_link", async () => {
    const { handlers, snClient } = setup();
    const userId = "0123456789abcdef0123456789abcdef";

    snClient.get.mockResolvedValue({
      data: {
        result: [
          { sys_id: userId, name: "Jane Smith", email: "jane@example.com" },
        ],
      },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.lookup_user({
      query: "Jane",
      limit: 10,
    })) as any;

    expect(snClient.get).toHaveBeenCalledWith("/api/now/table/sys_user", {
      params: {
        sysparm_query:
          "nameLIKEJane^ORemail=Jane^ORemployee_number=Jane^ORuser_name=Jane",
        sysparm_limit: 10,
        sysparm_fields:
          "sys_id,user_name,name,first_name,last_name,email,phone,department,title,manager,active,employee_number,location",
      },
    });
    expect(result.success).toBe(true);
    expect(result.data[0].self_link).toBe(
      `https://example.service-now.com/sys_user.do?sys_id=${userId}`
    );
    expect(result.metadata).toEqual({
      total_count: 1,
      returned_count: 1,
    });
  });

  it("lookup_group returns groups with sys_user_group self_link", async () => {
    const { handlers, snClient } = setup();
    const groupId = "fedcba9876543210fedcba9876543210";

    snClient.get.mockResolvedValue({
      data: {
        result: [
          { sys_id: groupId, name: "IT Support", active: "true" },
        ],
      },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.lookup_group({
      query: "IT Support",
      limit: 10,
    })) as any;

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sys_user_group",
      {
        params: {
          sysparm_query: "nameLIKEIT Support^active=true",
          sysparm_limit: 10,
          sysparm_fields:
            "sys_id,name,description,manager,email,active,type",
        },
      }
    );
    expect(result.success).toBe(true);
    expect(result.data[0].self_link).toBe(
      `https://example.service-now.com/sys_user_group.do?sys_id=${groupId}`
    );
    expect(result.metadata).toEqual({
      total_count: 1,
      returned_count: 1,
    });
  });

  it("get_my_profile returns authenticated user with sys_user self_link", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: {
        result: {
          sys_id: userSysId,
          name: "John Doe",
          email: "john.doe@example.com",
        },
      },
      headers: {},
    });

    const result = (await handlers.get_my_profile({})) as any;

    expect(snClient.get).toHaveBeenCalledWith(
      `/api/now/table/sys_user/${userSysId}`,
      {
        params: {
          sysparm_fields:
            "sys_id,user_name,name,first_name,last_name,email,phone,department,title,manager,active,employee_number,location,photo",
        },
      }
    );
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/sys_user.do?sys_id=${userSysId}`
    );
  });
});

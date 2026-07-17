import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerFormRulesTools } from "../../../src/tools/formRules.js";
import type { ToolContext } from "../../../src/tools/registry.js";

type WrappedHandler<T = unknown> = (args: T) => Promise<unknown>;

describe("registerFormRulesTools", () => {
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

    registerFormRulesTools(server as never, wrapHandler);
    return { handlers, snClient };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- UI policies ----------------------------------------------------------

  it("search_ui_policies builds query from table, short_description, active", async () => {
    const { handlers, snClient } = setup();
    snClient.get.mockResolvedValue({
      data: { result: [{ sys_id: "uip-1", short_description: "Major incident" }] },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.search_ui_policies({
      table: "incident",
      short_description: "major",
      active: true,
      limit: 20,
      offset: 0,
    })) as { success: boolean; data: { self_link: string }[] };

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sys_ui_policy",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query:
            "table=incident^short_descriptionLIKEmajor^active=true^ORDERBYDESCsys_updated_on",
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data[0].self_link).toBe(
      "https://example.service-now.com/sys_ui_policy.do?sys_id=uip-1"
    );
  });

  it("get_ui_policy fetches the policy and its actions via ui_policy", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get
      .mockResolvedValueOnce({
        data: { result: { sys_id: sysId, short_description: "MI policy" } },
        headers: {},
      })
      .mockResolvedValueOnce({
        data: {
          result: [
            { sys_id: "act-1", field: "u_major_incident", mandatory: "true" },
          ],
        },
        headers: { "x-total-count": "1" },
      });

    const result = (await handlers.get_ui_policy({
      sys_id: sysId,
      action_limit: 200,
    })) as {
      success: boolean;
      data: {
        self_link: string;
        actions: { sys_id: string; self_link: string }[];
        action_metadata: { total_count: number; truncated: boolean };
      };
    };

    expect(snClient.get).toHaveBeenNthCalledWith(
      1,
      `/api/now/table/sys_ui_policy/${sysId}`
    );
    expect(snClient.get).toHaveBeenNthCalledWith(
      2,
      "/api/now/table/sys_ui_policy_action",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: `ui_policy=${sysId}`,
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data.actions[0].self_link).toBe(
      "https://example.service-now.com/sys_ui_policy_action.do?sys_id=act-1"
    );
    expect(result.data.action_metadata).toEqual({
      total_count: 1,
      returned_count: 1,
      truncated: false,
    });
  });

  it("get_ui_policy rejects an invalid sys_id", async () => {
    const { handlers, snClient } = setup();
    const result = (await handlers.get_ui_policy({
      sys_id: "nope",
      action_limit: 200,
    })) as { success: boolean; error: { code: string } };
    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  // ---- Client scripts -------------------------------------------------------

  it("search_client_scripts builds query from table, name, type, active, script_contains", async () => {
    const { handlers, snClient } = setup();
    snClient.get.mockResolvedValue({
      data: { result: [{ sys_id: "cs-1", name: "Set MI" }] },
      headers: { "x-total-count": "1" },
    });

    await handlers.search_client_scripts({
      table: "incident",
      name: "MI",
      type: "onChange",
      active: true,
      script_contains: "u_major_incident",
      limit: 20,
      offset: 0,
    });

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sys_script_client",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query:
            "table=incident^nameLIKEMI^type=onChange^active=true^scriptLIKEu_major_incident^ORDERBYDESCsys_updated_on",
        }),
      })
    );
  });

  it("get_client_script returns the full record with self_link", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";
    snClient.get.mockResolvedValue({
      data: { result: { sys_id: sysId, script: "g_form.setValue('x', true);" } },
      headers: {},
    });

    const result = (await handlers.get_client_script({ sys_id: sysId })) as {
      success: boolean;
      data: { self_link: string; script: string };
    };

    expect(snClient.get).toHaveBeenCalledWith(
      `/api/now/table/sys_script_client/${sysId}`
    );
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/sys_script_client.do?sys_id=${sysId}`
    );
  });

  it("get_client_script rejects an invalid sys_id", async () => {
    const { handlers, snClient } = setup();
    const result = (await handlers.get_client_script({ sys_id: "bad" })) as {
      success: boolean;
      error: { code: string };
    };
    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  // ---- Data policies --------------------------------------------------------

  it("search_data_policies queries sys_data_policy2 with table/active filters", async () => {
    const { handlers, snClient } = setup();
    snClient.get.mockResolvedValue({
      data: { result: [{ sys_id: "dp-1" }] },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.search_data_policies({
      table: "incident",
      active: true,
      limit: 20,
      offset: 0,
    })) as { success: boolean; data: { self_link: string }[] };

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sys_data_policy2",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: "model_table=incident^active=true^ORDERBYDESCsys_updated_on",
        }),
      })
    );
    expect(result.data[0].self_link).toBe(
      "https://example.service-now.com/sys_data_policy2.do?sys_id=dp-1"
    );
  });

  it("get_data_policy fetches the policy and its rules via policy", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get
      .mockResolvedValueOnce({
        data: { result: { sys_id: sysId, table: "incident" } },
        headers: {},
      })
      .mockResolvedValueOnce({
        data: { result: [{ sys_id: "rule-1", field: "state", mandatory: "true" }] },
        headers: { "x-total-count": "1" },
      });

    const result = (await handlers.get_data_policy({
      sys_id: sysId,
      rule_limit: 200,
    })) as {
      success: boolean;
      data: { rules: { self_link: string }[]; rule_metadata: { total_count: number } };
    };

    expect(snClient.get).toHaveBeenNthCalledWith(
      1,
      `/api/now/table/sys_data_policy2/${sysId}`
    );
    expect(snClient.get).toHaveBeenNthCalledWith(
      2,
      "/api/now/table/sys_data_policy_rule",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: `sys_data_policy=${sysId}`,
        }),
      })
    );
    expect(result.data.rules[0].self_link).toBe(
      "https://example.service-now.com/sys_data_policy_rule.do?sys_id=rule-1"
    );
    expect(result.data.rule_metadata.total_count).toBe(1);
  });

  it("get_data_policy rejects an invalid sys_id", async () => {
    const { handlers, snClient } = setup();
    const result = (await handlers.get_data_policy({
      sys_id: "bad",
      rule_limit: 200,
    })) as { success: boolean; error: { code: string } };
    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

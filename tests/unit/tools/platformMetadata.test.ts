import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerPlatformMetadataTools } from "../../../src/tools/platformMetadata.js";
import type { ToolContext } from "../../../src/tools/registry.js";

type WrappedHandler<T = unknown> = (args: T) => Promise<unknown>;

describe("registerPlatformMetadataTools", () => {
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
      _toolName: string,
      handler: (context: ToolContext, args: T) => Promise<unknown>
    ) => {
      return async (args: T) => handler(ctx, args);
    };

    registerPlatformMetadataTools(server as never, wrapHandler);

    return { handlers, snClient, server };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- search_business_rules ------------------------------------------------

  it("search_business_rules builds query from table, name, when, active, and script_contains", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [{ sys_id: "br-001", name: "Set major incident" }] },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.search_business_rules({
      table: "incident",
      name: "major",
      when: "after",
      active: true,
      script_contains: "u_major_incident",
      limit: 20,
      offset: 0,
    })) as {
      success: boolean;
      data: { sys_id: string; self_link: string }[];
      metadata: { total_count: number; returned_count: number; offset: number };
    };

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sys_script",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query:
            "collection=incident^nameLIKEmajor^when=after^active=true^scriptLIKEu_major_incident^ORDERBYDESCsys_updated_on",
          sysparm_limit: 20,
          sysparm_offset: 0,
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data[0].self_link).toBe(
      "https://example.service-now.com/sys_script.do?sys_id=br-001"
    );
    expect(result.metadata).toEqual({
      total_count: 1,
      returned_count: 1,
      offset: 0,
    });
  });

  it("search_business_rules encodes active=false", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [] },
      headers: { "x-total-count": "0" },
    });

    await handlers.search_business_rules({ active: false, limit: 20, offset: 0 });

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sys_script",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: "active=false^ORDERBYDESCsys_updated_on",
        }),
      })
    );
  });

  it("search_business_rules ORs condition_contains across condition + filter_condition as the trailing group", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [] },
      headers: { "x-total-count": "0" },
    });

    await handlers.search_business_rules({
      table: "incident",
      script_contains: "abc",
      condition_contains: "u_major_incident",
      limit: 20,
      offset: 0,
    });

    // collection + scriptLIKE are ANDed; the condition/filter_condition OR group
    // is contiguous and trails just before ORDERBY so the leading filters stay
    // ANDed: collection=incident AND scriptLIKEabc AND (conditionLIKE.. OR filter_conditionLIKE..)
    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sys_script",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query:
            "collection=incident^scriptLIKEabc^conditionLIKEu_major_incident^ORfilter_conditionLIKEu_major_incident^ORDERBYDESCsys_updated_on",
        }),
      })
    );
  });

  // ---- get_business_rule ----------------------------------------------------

  it("get_business_rule returns the full record with a self_link", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get.mockResolvedValue({
      data: {
        result: {
          sys_id: sysId,
          name: "Set major incident",
          script: "current.u_major_incident = true;",
        },
      },
      headers: {},
    });

    const result = (await handlers.get_business_rule({ sys_id: sysId })) as {
      success: boolean;
      data: { sys_id: string; self_link: string; script: string };
    };

    expect(snClient.get).toHaveBeenCalledWith(
      `/api/now/table/sys_script/${sysId}`
    );
    expect(result.success).toBe(true);
    expect(result.data.script).toBe("current.u_major_incident = true;");
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/sys_script.do?sys_id=${sysId}`
    );
  });

  it("get_business_rule rejects an invalid sys_id", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.get_business_rule({
      sys_id: "not-a-sys-id",
    })) as { success: boolean; error: { code: string } };

    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  // ---- get_list_view --------------------------------------------------------

  it("get_list_view requires either sys_id or table", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.get_list_view({
      include_personal: false,
      include_columns: true,
      column_limit: 200,
      limit: 20,
    })) as { success: boolean; error: { code: string } };

    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("get_list_view by table excludes personal lists and fetches ordered columns", async () => {
    const { handlers, snClient } = setup();

    snClient.get
      .mockResolvedValueOnce({
        data: { result: [{ sys_id: "list-001", name: "incident" }] },
        headers: { "x-total-count": "1" },
      })
      .mockResolvedValueOnce({
        data: {
          result: [
            { sys_id: "el-001", element: "number", position: "0" },
            { sys_id: "el-002", element: "short_description", position: "1" },
          ],
        },
        headers: { "x-total-count": "2" },
      });

    const result = (await handlers.get_list_view({
      table: "incident",
      include_personal: false,
      include_columns: true,
      column_limit: 200,
      limit: 20,
    })) as {
      success: boolean;
      data: {
        sys_id: string;
        self_link: string;
        columns: { element: string; self_link: string }[];
        column_metadata: { total_count: number; truncated: boolean };
      }[];
      metadata: { total_count: number; returned_count: number };
    };

    expect(snClient.get).toHaveBeenNthCalledWith(
      1,
      "/api/now/table/sys_ui_list",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: "name=incident^sys_userISEMPTY^ORDERBYview",
        }),
      })
    );
    expect(snClient.get).toHaveBeenNthCalledWith(
      2,
      "/api/now/table/sys_ui_list_element",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: "list_id=list-001^ORDERBYposition",
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data[0].self_link).toBe(
      "https://example.service-now.com/sys_ui_list.do?sys_id=list-001"
    );
    expect(result.data[0].columns).toHaveLength(2);
    expect(result.data[0].columns[0].self_link).toBe(
      "https://example.service-now.com/sys_ui_list_element.do?sys_id=el-001"
    );
    expect(result.data[0].column_metadata).toEqual({
      total_count: 2,
      returned_count: 2,
      truncated: false,
    });
    expect(result.metadata).toEqual({ total_count: 1, returned_count: 1 });
  });

  it("get_list_view with include_personal omits the sys_userISEMPTY filter", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [] },
      headers: { "x-total-count": "0" },
    });

    await handlers.get_list_view({
      table: "incident",
      include_personal: true,
      include_columns: false,
      column_limit: 200,
      limit: 20,
    });

    expect(snClient.get).toHaveBeenCalledTimes(1);
    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sys_ui_list",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: "name=incident^ORDERBYview",
        }),
      })
    );
  });

  it("get_list_view by sys_id fetches the single layout and its columns", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get
      .mockResolvedValueOnce({
        data: { result: { sys_id: sysId, name: "incident" } },
        headers: {},
      })
      .mockResolvedValueOnce({
        data: { result: [{ sys_id: "el-001", element: "number", position: "0" }] },
        headers: { "x-total-count": "1" },
      });

    const result = (await handlers.get_list_view({
      sys_id: sysId,
      include_personal: false,
      include_columns: true,
      column_limit: 200,
      limit: 20,
    })) as {
      success: boolean;
      data: { sys_id: string; columns: unknown[] }[];
      metadata: { total_count: number };
    };

    expect(snClient.get).toHaveBeenNthCalledWith(
      1,
      `/api/now/table/sys_ui_list/${sysId}`
    );
    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].columns).toHaveLength(1);
    expect(result.metadata.total_count).toBe(1);
  });

  it("get_list_view rejects an invalid sys_id", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.get_list_view({
      sys_id: "not-a-sys-id",
      include_personal: false,
      include_columns: true,
      column_limit: 200,
      limit: 20,
    })) as { success: boolean; error: { code: string } };

    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  // ---- search_navigator_modules ---------------------------------------------

  it("search_navigator_modules builds query from title, table, and active and surfaces the filter", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: {
        result: [
          {
            sys_id: "mod-001",
            title: "Major Incidents",
            name: "incident",
            filter: "u_major_incident=true",
          },
        ],
      },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.search_navigator_modules({
      title: "Major Incident",
      table: "incident",
      active: true,
      limit: 20,
      offset: 0,
    })) as {
      success: boolean;
      data: { sys_id: string; filter: string; self_link: string }[];
    };

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sys_app_module",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query:
            "titleLIKEMajor Incident^name=incident^active=true^ORDERBYtitle",
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data[0].filter).toBe("u_major_incident=true");
    expect(result.data[0].self_link).toBe(
      "https://example.service-now.com/sys_app_module.do?sys_id=mod-001"
    );
  });

  // ---- search_flow_definitions ----------------------------------------------

  it("search_flow_definitions builds query from name, active, and type", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [{ sys_id: "flow-001", name: "Outage created from MIM" }] },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.search_flow_definitions({
      name: "Outage created from MIM",
      active: true,
      type: "flow",
      limit: 20,
      offset: 0,
    })) as { success: boolean; data: { self_link: string }[] };

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sys_hub_flow",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query:
            "nameLIKEOutage created from MIM^active=true^type=flow^ORDERBYDESCsys_updated_on",
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data[0].self_link).toBe(
      "https://example.service-now.com/sys_hub_flow.do?sys_id=flow-001"
    );
  });

  // ---- get_flow_definition --------------------------------------------------

  it("get_flow_definition rejects an invalid sys_id", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.get_flow_definition({
      sys_id: "not-a-sys-id",
      include_components: true,
      component_limit: 200,
    })) as { success: boolean; error: { code: string } };

    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("get_flow_definition returns header, triggers, and actions from the base tables", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get
      .mockResolvedValueOnce({
        data: { result: { sys_id: sysId, name: "Outage created from MIM" } },
        headers: {},
      })
      .mockResolvedValueOnce({
        data: { result: [{ sys_id: "trg-001", order: "0" }] },
        headers: { "x-total-count": "1" },
      })
      .mockResolvedValueOnce({
        data: {
          result: [
            { sys_id: "act-001", order: "1" },
            { sys_id: "act-002", order: "2" },
          ],
        },
        headers: { "x-total-count": "2" },
      });

    const result = (await handlers.get_flow_definition({
      sys_id: sysId,
      include_components: true,
      component_limit: 200,
    })) as {
      success: boolean;
      data: {
        self_link: string;
        triggers: { sys_id: string; self_link: string }[];
        actions: { sys_id: string; self_link: string }[];
        component_metadata: {
          triggers: { table: string; total_count: number };
          actions: { table: string; total_count: number; truncated: boolean };
        };
      };
    };

    // header, then base trigger table, then base action table — no v2 calls
    expect(snClient.get).toHaveBeenCalledTimes(3);
    expect(snClient.get).toHaveBeenNthCalledWith(
      2,
      "/api/now/table/sys_hub_trigger_instance",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: `flow=${sysId}^ORDERBYorder`,
        }),
      })
    );
    expect(snClient.get).toHaveBeenNthCalledWith(
      3,
      "/api/now/table/sys_hub_action_instance",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: `flow=${sysId}^ORDERBYorder`,
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/sys_hub_flow.do?sys_id=${sysId}`
    );
    expect(result.data.triggers[0].self_link).toBe(
      "https://example.service-now.com/sys_hub_trigger_instance.do?sys_id=trg-001"
    );
    expect(result.data.actions).toHaveLength(2);
    expect(result.data.component_metadata.triggers.table).toBe(
      "sys_hub_trigger_instance"
    );
    expect(result.data.component_metadata.actions).toEqual({
      table: "sys_hub_action_instance",
      total_count: 2,
      returned_count: 2,
      truncated: false,
    });
  });

  it("get_flow_definition falls back to the *_v2 tables when the base tables are empty", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get
      // header
      .mockResolvedValueOnce({
        data: { result: { sys_id: sysId, name: "Outage created from MIM" } },
        headers: {},
      })
      // base trigger table — empty
      .mockResolvedValueOnce({
        data: { result: [] },
        headers: { "x-total-count": "0" },
      })
      // v2 trigger table — has rows
      .mockResolvedValueOnce({
        data: { result: [{ sys_id: "trg-v2-001", order: "0" }] },
        headers: { "x-total-count": "1" },
      })
      // base action table — empty
      .mockResolvedValueOnce({
        data: { result: [] },
        headers: { "x-total-count": "0" },
      })
      // v2 action table — has rows
      .mockResolvedValueOnce({
        data: { result: [{ sys_id: "act-v2-001", order: "1" }] },
        headers: { "x-total-count": "1" },
      });

    const result = (await handlers.get_flow_definition({
      sys_id: sysId,
      include_components: true,
      component_limit: 200,
    })) as {
      success: boolean;
      data: {
        triggers: { self_link: string }[];
        component_metadata: { triggers: { table: string }; actions: { table: string } };
      };
    };

    expect(snClient.get).toHaveBeenCalledTimes(5);
    expect(snClient.get).toHaveBeenNthCalledWith(
      3,
      "/api/now/table/sys_hub_trigger_instance_v2",
      expect.anything()
    );
    expect(result.data.component_metadata.triggers.table).toBe(
      "sys_hub_trigger_instance_v2"
    );
    expect(result.data.component_metadata.actions.table).toBe(
      "sys_hub_action_instance_v2"
    );
    expect(result.data.triggers[0].self_link).toBe(
      "https://example.service-now.com/sys_hub_trigger_instance_v2.do?sys_id=trg-v2-001"
    );
  });

  it("get_flow_definition tolerates a missing *_v2 table and returns empty components", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get
      .mockResolvedValueOnce({
        data: { result: { sys_id: sysId, name: "Outage created from MIM" } },
        headers: {},
      })
      // base trigger empty, then v2 trigger lookup throws (table absent)
      .mockResolvedValueOnce({ data: { result: [] }, headers: { "x-total-count": "0" } })
      .mockRejectedValueOnce({ statusCode: 400, message: "invalid table" })
      // base action empty, then v2 action lookup throws
      .mockResolvedValueOnce({ data: { result: [] }, headers: { "x-total-count": "0" } })
      .mockRejectedValueOnce({ statusCode: 400, message: "invalid table" });

    const result = (await handlers.get_flow_definition({
      sys_id: sysId,
      include_components: true,
      component_limit: 200,
    })) as {
      success: boolean;
      data: {
        triggers: unknown[];
        actions: unknown[];
        component_metadata: { triggers: { table: string; total_count: number } };
      };
    };

    expect(result.success).toBe(true);
    expect(result.data.triggers).toEqual([]);
    expect(result.data.actions).toEqual([]);
    // falls back to the (empty) base result rather than throwing
    expect(result.data.component_metadata.triggers).toEqual({
      table: "sys_hub_trigger_instance",
      total_count: 0,
      returned_count: 0,
      truncated: false,
    });
  });

  it("get_flow_definition rethrows a non-missing-table error (e.g. 403) from the *_v2 lookup", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get
      .mockResolvedValueOnce({
        data: { result: { sys_id: sysId, name: "Outage created from MIM" } },
        headers: {},
      })
      // base trigger empty, then the v2 trigger lookup fails with a 403 (ACL)
      .mockResolvedValueOnce({ data: { result: [] }, headers: { "x-total-count": "0" } })
      .mockRejectedValueOnce({ statusCode: 403, message: "Insufficient permissions" });

    // The ACL error must surface, not be masked as "no components".
    await expect(
      handlers.get_flow_definition({
        sys_id: sysId,
        include_components: true,
        component_limit: 200,
      })
    ).rejects.toMatchObject({ statusCode: 403 });

    // header + base trigger + v2 trigger (which threw) — short-circuits there
    expect(snClient.get).toHaveBeenCalledTimes(3);
  });

  it("get_flow_definition with include_components=false fetches only the header", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get.mockResolvedValue({
      data: { result: { sys_id: sysId, name: "Outage created from MIM" } },
      headers: {},
    });

    const result = (await handlers.get_flow_definition({
      sys_id: sysId,
      include_components: false,
      component_limit: 200,
    })) as { success: boolean; data: Record<string, unknown> };

    expect(snClient.get).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.data.triggers).toBeUndefined();
    expect(result.data.actions).toBeUndefined();
    expect(result.data.component_metadata).toBeUndefined();
  });

  // ---- get_flow_action_inputs -----------------------------------------------

  it("get_flow_action_inputs rejects an invalid sys_id", async () => {
    const { handlers, snClient } = setup();
    const result = (await handlers.get_flow_action_inputs({
      sys_id: "nope",
      limit: 200,
    })) as { success: boolean; error: { code: string } };
    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("get_flow_action_inputs returns sys_variable_value rows and the base action instance", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get
      // sys_variable_value rows (keyed by document_key)
      .mockResolvedValueOnce({
        data: {
          result: [
            { sys_id: "vv-1", variable: "Table", value: "cmdb_ci_outage" },
            { sys_id: "vv-2", variable: "Field values", value: "u_major_incident=true" },
          ],
        },
        headers: { "x-total-count": "2" },
      })
      // action instance found in the base table
      .mockResolvedValueOnce({
        data: { result: { sys_id: sysId, action_type: "Create Record" } },
        headers: {},
      });

    const result = (await handlers.get_flow_action_inputs({
      sys_id: sysId,
      limit: 200,
    })) as {
      success: boolean;
      data: {
        action_instance: { table: string; self_link: string } | null;
        input_values: { sys_id: string; self_link: string }[];
        metadata: {
          input_values: { total_count: number; truncated: boolean };
          action_instance_found: boolean;
          action_instance_table: string | null;
        };
      };
    };

    expect(snClient.get).toHaveBeenNthCalledWith(
      1,
      "/api/now/table/sys_variable_value",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: `document_key=${sysId}^ORDERBYsys_created_on`,
          sysparm_fields: "sys_id,document,document_key,variable,value",
        }),
      })
    );
    expect(snClient.get).toHaveBeenNthCalledWith(
      2,
      `/api/now/table/sys_hub_action_instance/${sysId}`
    );
    expect(result.success).toBe(true);
    expect(result.data.input_values).toHaveLength(2);
    expect(result.data.input_values[0].self_link).toBe(
      "https://example.service-now.com/sys_variable_value.do?sys_id=vv-1"
    );
    expect(result.data.action_instance?.table).toBe("sys_hub_action_instance");
    expect(result.data.metadata.action_instance_found).toBe(true);
    expect(result.data.metadata.action_instance_table).toBe(
      "sys_hub_action_instance"
    );
    expect(result.data.metadata.input_values.total_count).toBe(2);
  });

  it("get_flow_action_inputs falls back to the *_v2 action instance on a base 404", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get
      .mockResolvedValueOnce({ data: { result: [] }, headers: { "x-total-count": "0" } })
      // base action instance: 404 (record lives in the v2 table)
      .mockRejectedValueOnce({ statusCode: 404, message: "Record not found" })
      // v2 action instance: found, carries the encoded `values` field
      .mockResolvedValueOnce({
        data: { result: { sys_id: sysId, values: "<encoded>" } },
        headers: {},
      });

    const result = (await handlers.get_flow_action_inputs({
      sys_id: sysId,
      limit: 200,
    })) as {
      success: boolean;
      data: {
        action_instance: { table: string } | null;
        metadata: { action_instance_table: string | null };
      };
    };

    expect(snClient.get).toHaveBeenNthCalledWith(
      3,
      `/api/now/table/sys_hub_action_instance_v2/${sysId}`
    );
    expect(result.data.action_instance?.table).toBe("sys_hub_action_instance_v2");
    expect(result.data.metadata.action_instance_table).toBe(
      "sys_hub_action_instance_v2"
    );
  });

  it("get_flow_action_inputs rethrows a non-404/400 error (e.g. 403) from the instance fetch", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get
      .mockResolvedValueOnce({ data: { result: [] }, headers: { "x-total-count": "0" } })
      .mockRejectedValueOnce({ statusCode: 403, message: "Insufficient permissions" });

    await expect(
      handlers.get_flow_action_inputs({ sys_id: sysId, limit: 200 })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("get_flow_action_inputs returns a null action_instance when neither table has it", async () => {
    const { handlers, snClient } = setup();
    const sysId = "0123456789abcdef0123456789abcdef";

    snClient.get
      .mockResolvedValueOnce({
        data: { result: [{ sys_id: "vv-1", variable: "Table", value: "x" }] },
        headers: { "x-total-count": "1" },
      })
      .mockRejectedValueOnce({ statusCode: 404, message: "Record not found" })
      .mockRejectedValueOnce({ statusCode: 404, message: "Record not found" });

    const result = (await handlers.get_flow_action_inputs({
      sys_id: sysId,
      limit: 200,
    })) as {
      success: boolean;
      data: {
        action_instance: unknown;
        input_values: unknown[];
        metadata: { action_instance_found: boolean; action_instance_table: string | null };
      };
    };

    expect(result.success).toBe(true);
    expect(result.data.action_instance).toBeNull();
    expect(result.data.metadata.action_instance_found).toBe(false);
    expect(result.data.metadata.action_instance_table).toBeNull();
    // the variable-value rows are still returned even when the instance is absent
    expect(result.data.input_values).toHaveLength(1);
  });
});

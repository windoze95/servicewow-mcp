import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerCatalogAdminTools } from "../../../src/tools/catalogAdmin.js";
import type { ToolContext } from "../../../src/tools/registry.js";

type WrappedHandler<T = unknown> = (args: T) => Promise<unknown>;

describe("registerCatalogAdminTools", () => {
  const userSysId = "abc123def456abc123def456abc12345";
  const validSysId = "0123456789abcdef0123456789abcdef";

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

    registerCatalogAdminTools(server as any, wrapHandler);

    return { handlers, snClient, server };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers all 11 tools", () => {
    const { server } = setup();
    expect(server.tool).toHaveBeenCalledTimes(11);
    const names = server.tool.mock.calls.map((c: unknown[]) => c[0]);
    expect(names).toEqual([
      "create_catalog_item",
      "update_catalog_item",
      "create_catalog_variable",
      "update_catalog_variable",
      "list_catalog_variables",
      "create_variable_choice",
      "create_variable_set",
      "attach_variable_set",
      "create_catalog_client_script",
      "create_catalog_ui_policy",
      "create_catalog_ui_policy_action",
    ]);
  });

  // --- create_catalog_item ---

  it("create_catalog_item posts to sc_cat_item and returns self_link", async () => {
    const { handlers, snClient } = setup();

    snClient.post.mockResolvedValue({
      data: {
        result: {
          sys_id: validSysId,
          name: "VPN Access",
          short_description: "Request VPN",
        },
      },
    });

    const result = (await handlers.create_catalog_item({
      name: "VPN Access",
      short_description: "Request VPN",
    })) as any;

    expect(snClient.post).toHaveBeenCalledWith("/api/now/table/sc_cat_item", {
      name: "VPN Access",
      short_description: "Request VPN",
    });
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/sc_cat_item.do?sys_id=${validSysId}`
    );
  });

  it("create_catalog_item includes optional fields", async () => {
    const { handlers, snClient } = setup();

    snClient.post.mockResolvedValue({
      data: { result: { sys_id: validSysId } },
    });

    await handlers.create_catalog_item({
      name: "Test",
      short_description: "Test item",
      description: "<p>Full</p>",
      category: "cat-id",
      sc_catalogs: "catalog-1,catalog-2",
      group: "group-id",
      active: false,
      no_cart: true,
      no_quantity: true,
      workflow: "wf-id",
    });

    const body = snClient.post.mock.calls[0][1];
    expect(body.description).toBe("<p>Full</p>");
    expect(body.category).toBe("cat-id");
    expect(body.sc_catalogs).toBe("catalog-1,catalog-2");
    expect(body.group).toBe("group-id");
    expect(body.active).toBe(false);
    expect(body.no_cart).toBe(true);
    expect(body.no_quantity).toBe(true);
    expect(body.workflow).toBe("wf-id");
  });

  // --- update_catalog_item ---

  it("update_catalog_item patches and returns self_link", async () => {
    const { handlers, snClient } = setup();

    snClient.patch.mockResolvedValue({
      data: { result: { sys_id: validSysId, name: "Updated" } },
    });

    const result = (await handlers.update_catalog_item({
      sys_id: validSysId,
      fields: { name: "Updated" },
    })) as any;

    expect(snClient.patch).toHaveBeenCalledWith(
      `/api/now/table/sc_cat_item/${validSysId}`,
      { name: "Updated" }
    );
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/sc_cat_item.do?sys_id=${validSysId}`
    );
  });

  it("update_catalog_item strips readonly fields", async () => {
    const { handlers, snClient } = setup();

    snClient.patch.mockResolvedValue({
      data: { result: { sys_id: validSysId } },
    });

    await handlers.update_catalog_item({
      sys_id: validSysId,
      fields: { name: "New Name", sys_id: "hacked", sys_created_on: "x" },
    });

    expect(snClient.patch).toHaveBeenCalledWith(
      `/api/now/table/sc_cat_item/${validSysId}`,
      { name: "New Name" }
    );
  });

  it("update_catalog_item returns VALIDATION_ERROR for invalid sys_id", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.update_catalog_item({
      sys_id: "bad-id",
      fields: { name: "Test" },
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(snClient.patch).not.toHaveBeenCalled();
  });

  // --- create_catalog_variable ---

  it("create_catalog_variable maps type enum to numeric code", async () => {
    const { handlers, snClient } = setup();

    snClient.post.mockResolvedValue({
      data: { result: { sys_id: validSysId, name: "urgency_level" } },
    });

    const result = (await handlers.create_catalog_variable({
      cat_item: validSysId,
      name: "urgency_level",
      question_text: "Urgency Level",
      type: "select_box",
      mandatory: true,
      order: 100,
    })) as any;

    const body = snClient.post.mock.calls[0][1];
    expect(body.type).toBe(5); // select_box = 5
    expect(body.cat_item).toBe(validSysId);
    expect(body.mandatory).toBe(true);
    expect(body.order).toBe(100);
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/item_option_new.do?sys_id=${validSysId}`
    );
  });

  it("create_catalog_variable includes optional reference fields", async () => {
    const { handlers, snClient } = setup();

    snClient.post.mockResolvedValue({
      data: { result: { sys_id: validSysId } },
    });

    await handlers.create_catalog_variable({
      cat_item: validSysId,
      name: "assigned_user",
      question_text: "Assigned User",
      type: "reference",
      reference: "sys_user",
      reference_qual: "active=true",
      help_text: "Select a user",
      hidden: false,
      read_only: false,
      default_value: "",
    });

    const body = snClient.post.mock.calls[0][1];
    expect(body.type).toBe(8); // reference = 8
    expect(body.reference).toBe("sys_user");
    expect(body.reference_qual).toBe("active=true");
    expect(body.help_text).toBe("Select a user");
    expect(body.hidden).toBe(false);
    expect(body.read_only).toBe(false);
    expect(body.default_value).toBe("");
  });

  it("create_catalog_variable returns VALIDATION_ERROR for invalid cat_item", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.create_catalog_variable({
      cat_item: "bad",
      name: "test",
      question_text: "Test",
      type: "single_line_text",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(snClient.post).not.toHaveBeenCalled();
  });

  // --- update_catalog_variable ---

  it("update_catalog_variable patches and returns self_link", async () => {
    const { handlers, snClient } = setup();

    snClient.patch.mockResolvedValue({
      data: { result: { sys_id: validSysId, question_text: "Updated" } },
    });

    const result = (await handlers.update_catalog_variable({
      sys_id: validSysId,
      fields: { question_text: "Updated" },
    })) as any;

    expect(snClient.patch).toHaveBeenCalledWith(
      `/api/now/table/item_option_new/${validSysId}`,
      { question_text: "Updated" }
    );
    expect(result.success).toBe(true);
    expect(result.data.self_link).toContain("item_option_new.do");
  });

  it("update_catalog_variable returns VALIDATION_ERROR for invalid sys_id", async () => {
    const { handlers } = setup();

    const result = (await handlers.update_catalog_variable({
      sys_id: "nope",
      fields: { mandatory: true },
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  // --- list_catalog_variables ---

  it("list_catalog_variables returns direct variables ordered by order", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: {
        result: [
          { sys_id: "var-001", name: "field_a", order: "100" },
          { sys_id: "var-002", name: "field_b", order: "200" },
        ],
      },
    });

    const result = (await handlers.list_catalog_variables({
      cat_item: validSysId,
      include_set_variables: false,
      limit: 50,
    })) as any;

    expect(snClient.get).toHaveBeenCalledWith("/api/now/table/item_option_new", {
      params: {
        sysparm_query: `cat_item=${validSysId}^ORDERBYorder`,
        sysparm_limit: 50,
        sysparm_fields:
          "sys_id,name,question_text,type,mandatory,order,default_value,reference,help_text,hidden,read_only,cat_item,variable_set",
      },
    });
    expect(result.success).toBe(true);
    expect(result.data.variables).toHaveLength(2);
    expect(result.data.variables[0].self_link).toContain("item_option_new.do");
    expect(result.metadata.variable_count).toBe(2);
  });

  it("list_catalog_variables includes set variables when requested", async () => {
    const { handlers, snClient } = setup();

    // Direct variables
    snClient.get.mockResolvedValueOnce({
      data: { result: [{ sys_id: "var-001", name: "direct_var" }] },
    });

    // Variable set links
    snClient.get.mockResolvedValueOnce({
      data: {
        result: [
          { sys_id: "link-001", variable_set: { value: "set-aaa" } },
        ],
      },
    });

    // Variables in the set
    snClient.get.mockResolvedValueOnce({
      data: {
        result: [{ sys_id: "var-set-001", name: "set_var" }],
      },
    });

    const result = (await handlers.list_catalog_variables({
      cat_item: validSysId,
      include_set_variables: true,
      limit: 50,
    })) as any;

    expect(snClient.get).toHaveBeenCalledTimes(3);
    expect(result.data.variables).toHaveLength(1);
    expect(result.data.set_variables).toHaveLength(1);
    expect(result.metadata.set_variable_count).toBe(1);
  });

  it("list_catalog_variables handles no attached sets gracefully", async () => {
    const { handlers, snClient } = setup();

    // Direct variables
    snClient.get.mockResolvedValueOnce({
      data: { result: [] },
    });

    // No variable set links
    snClient.get.mockResolvedValueOnce({
      data: { result: [] },
    });

    const result = (await handlers.list_catalog_variables({
      cat_item: validSysId,
      include_set_variables: true,
      limit: 50,
    })) as any;

    expect(snClient.get).toHaveBeenCalledTimes(2);
    expect(result.data.variables).toHaveLength(0);
    expect(result.data.set_variables).toHaveLength(0);
  });

  it("list_catalog_variables returns VALIDATION_ERROR for invalid cat_item", async () => {
    const { handlers } = setup();

    const result = (await handlers.list_catalog_variables({
      cat_item: "bad",
      include_set_variables: false,
      limit: 50,
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  // --- create_variable_choice ---

  it("create_variable_choice posts to question_choice and returns self_link", async () => {
    const { handlers, snClient } = setup();

    snClient.post.mockResolvedValue({
      data: {
        result: { sys_id: validSysId, text: "High", value: "high" },
      },
    });

    const result = (await handlers.create_variable_choice({
      question: validSysId,
      text: "High",
      value: "high",
      order: 100,
    })) as any;

    expect(snClient.post).toHaveBeenCalledWith(
      "/api/now/table/question_choice",
      { question: validSysId, text: "High", value: "high", order: 100 }
    );
    expect(result.success).toBe(true);
    expect(result.data.self_link).toContain("question_choice.do");
  });

  it("create_variable_choice returns VALIDATION_ERROR for invalid question sys_id", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.create_variable_choice({
      question: "bad",
      text: "High",
      value: "high",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(snClient.post).not.toHaveBeenCalled();
  });

  // --- create_variable_set ---

  it("create_variable_set posts with mapped type", async () => {
    const { handlers, snClient } = setup();

    snClient.post.mockResolvedValue({
      data: {
        result: { sys_id: validSysId, title: "Contact Info" },
      },
    });

    const result = (await handlers.create_variable_set({
      title: "Contact Info",
      internal_name: "contact_info",
      type: "one_to_one",
      description: "Standard contact fields",
      order: 100,
    })) as any;

    const body = snClient.post.mock.calls[0][1];
    expect(body.type).toBe("true"); // one_to_one maps to "true"
    expect(body.title).toBe("Contact Info");
    expect(body.internal_name).toBe("contact_info");
    expect(body.description).toBe("Standard contact fields");
    expect(body.order).toBe(100);
    expect(result.success).toBe(true);
    expect(result.data.self_link).toContain("item_option_new_set.do");
  });

  it("create_variable_set maps one_to_many type", async () => {
    const { handlers, snClient } = setup();

    snClient.post.mockResolvedValue({
      data: { result: { sys_id: validSysId } },
    });

    await handlers.create_variable_set({
      title: "Multi Row",
      internal_name: "multi",
      type: "one_to_many",
    });

    expect(snClient.post.mock.calls[0][1].type).toBe("false");
  });

  // --- attach_variable_set ---

  it("attach_variable_set posts to io_set_item", async () => {
    const { handlers, snClient } = setup();
    const setSysId = "aabbccddaabbccddaabbccddaabbccdd";

    snClient.post.mockResolvedValue({
      data: { result: { sys_id: validSysId } },
    });

    const result = (await handlers.attach_variable_set({
      sc_cat_item: validSysId,
      variable_set: setSysId,
      order: 200,
    })) as any;

    expect(snClient.post).toHaveBeenCalledWith("/api/now/table/io_set_item", {
      sc_cat_item: validSysId,
      variable_set: setSysId,
      order: 200,
    });
    expect(result.success).toBe(true);
    expect(result.data.self_link).toContain("io_set_item.do");
  });

  it("attach_variable_set returns VALIDATION_ERROR for invalid sc_cat_item", async () => {
    const { handlers } = setup();
    const setSysId = "aabbccddaabbccddaabbccddaabbccdd";

    const result = (await handlers.attach_variable_set({
      sc_cat_item: "bad",
      variable_set: setSysId,
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("attach_variable_set returns VALIDATION_ERROR for invalid variable_set", async () => {
    const { handlers } = setup();

    const result = (await handlers.attach_variable_set({
      sc_cat_item: validSysId,
      variable_set: "bad",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  // --- create_catalog_client_script ---

  it("create_catalog_client_script posts to catalog_script_client", async () => {
    const { handlers, snClient } = setup();

    snClient.post.mockResolvedValue({
      data: {
        result: { sys_id: validSysId, name: "Show warning" },
      },
    });

    const result = (await handlers.create_catalog_client_script({
      name: "Show warning",
      cat_item: validSysId,
      type: "onChange",
      script: "function onChange(control, oldValue, newValue) {}",
      cat_variable: "IO:abc123",
      ui_type: "All",
      active: true,
      applies_catalog: true,
      applies_req_item: false,
    })) as any;

    const body = snClient.post.mock.calls[0][1];
    expect(body.name).toBe("Show warning");
    expect(body.cat_item).toBe(validSysId);
    expect(body.type).toBe("onChange");
    expect(body.script).toBe(
      "function onChange(control, oldValue, newValue) {}"
    );
    expect(body.cat_variable).toBe("IO:abc123");
    expect(result.success).toBe(true);
    expect(result.data.self_link).toContain("catalog_script_client.do");
  });

  it("create_catalog_client_script supports variable set target", async () => {
    const { handlers, snClient } = setup();
    const vsSysId = "aabbccddaabbccddaabbccddaabbccdd";

    snClient.post.mockResolvedValue({
      data: { result: { sys_id: validSysId } },
    });

    await handlers.create_catalog_client_script({
      name: "Set script",
      type: "onLoad",
      script: "function onLoad() {}",
      applies_to: "A Variable Set",
      variable_set: vsSysId,
    });

    const body = snClient.post.mock.calls[0][1];
    expect(body.applies_to).toBe("A Variable Set");
    expect(body.variable_set).toBe(vsSysId);
    expect(body.cat_item).toBeUndefined();
  });

  it("create_catalog_client_script returns VALIDATION_ERROR for invalid cat_item", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.create_catalog_client_script({
      name: "Bad",
      cat_item: "bad-id",
      type: "onLoad",
      script: "x",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(snClient.post).not.toHaveBeenCalled();
  });

  it("create_catalog_client_script returns VALIDATION_ERROR for invalid variable_set", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.create_catalog_client_script({
      name: "Bad",
      type: "onLoad",
      script: "x",
      applies_to: "A Variable Set",
      variable_set: "bad-id",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(snClient.post).not.toHaveBeenCalled();
  });

  it("create_catalog_client_script requires cat_item when targeting a catalog item", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.create_catalog_client_script({
      name: "No target",
      type: "onLoad",
      script: "function onLoad() {}",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("cat_item is required");
    expect(snClient.post).not.toHaveBeenCalled();
  });

  it("create_catalog_client_script requires variable_set when targeting a variable set", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.create_catalog_client_script({
      name: "No target",
      type: "onLoad",
      script: "function onLoad() {}",
      applies_to: "A Variable Set",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("variable_set is required");
    expect(snClient.post).not.toHaveBeenCalled();
  });

  it("create_catalog_client_script requires cat_variable for onChange scripts", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.create_catalog_client_script({
      name: "Missing trigger",
      cat_item: validSysId,
      type: "onChange",
      script: "function onChange() {}",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("cat_variable is required");
    expect(snClient.post).not.toHaveBeenCalled();
  });

  // --- create_catalog_ui_policy ---

  it("create_catalog_ui_policy posts to catalog_ui_policy", async () => {
    const { handlers, snClient } = setup();

    snClient.post.mockResolvedValue({
      data: {
        result: { sys_id: validSysId, short_description: "Show details" },
      },
    });

    const result = (await handlers.create_catalog_ui_policy({
      short_description: "Show details",
      catalog_item: validSysId,
      catalog_conditions: "IO:varA=yes^EQ",
      on_load: true,
      reverse_if_false: true,
      order: 200,
      active: true,
    })) as any;

    const body = snClient.post.mock.calls[0][1];
    expect(body.short_description).toBe("Show details");
    expect(body.catalog_item).toBe(validSysId);
    expect(body.catalog_conditions).toBe("IO:varA=yes^EQ");
    expect(body.on_load).toBe(true);
    expect(body.reverse_if_false).toBe(true);
    expect(body.order).toBe(200);
    expect(result.success).toBe(true);
    expect(result.data.self_link).toContain("catalog_ui_policy.do");
  });

  it("create_catalog_ui_policy supports script fields", async () => {
    const { handlers, snClient } = setup();

    snClient.post.mockResolvedValue({
      data: { result: { sys_id: validSysId } },
    });

    await handlers.create_catalog_ui_policy({
      short_description: "Scripted policy",
      catalog_item: validSysId,
      catalog_conditions: "IO:varA=yes",
      run_scripts: true,
      script_true: "alert('yes')",
      script_false: "alert('no')",
      ui_type: "Both",
    });

    const body = snClient.post.mock.calls[0][1];
    expect(body.run_scripts).toBe(true);
    expect(body.script_true).toBe("alert('yes')");
    expect(body.script_false).toBe("alert('no')");
    expect(body.ui_type).toBe("Both");
  });

  it("create_catalog_ui_policy returns VALIDATION_ERROR for invalid catalog_item", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.create_catalog_ui_policy({
      short_description: "Bad",
      catalog_item: "bad-id",
      catalog_conditions: "x",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(snClient.post).not.toHaveBeenCalled();
  });

  it("create_catalog_ui_policy returns VALIDATION_ERROR for invalid variable_set", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.create_catalog_ui_policy({
      short_description: "Bad",
      catalog_conditions: "x",
      applies_to: "A Variable Set",
      variable_set: "bad-id",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(snClient.post).not.toHaveBeenCalled();
  });

  it("create_catalog_ui_policy requires catalog_item when targeting a catalog item", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.create_catalog_ui_policy({
      short_description: "No target",
      catalog_conditions: "IO:varA=yes^EQ",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("catalog_item is required");
    expect(snClient.post).not.toHaveBeenCalled();
  });

  it("create_catalog_ui_policy requires variable_set when targeting a variable set", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.create_catalog_ui_policy({
      short_description: "No target",
      catalog_conditions: "IO:varA=yes^EQ",
      applies_to: "A Variable Set",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("variable_set is required");
    expect(snClient.post).not.toHaveBeenCalled();
  });

  // --- create_catalog_ui_policy_action ---

  it("create_catalog_ui_policy_action posts to catalog_ui_policy_action", async () => {
    const { handlers, snClient } = setup();

    snClient.post.mockResolvedValue({
      data: {
        result: {
          sys_id: validSysId,
          ui_policy: validSysId,
          catalog_variable: "IO:var123",
        },
      },
    });

    const result = (await handlers.create_catalog_ui_policy_action({
      ui_policy: validSysId,
      catalog_variable: "IO:var123",
      visible: "true",
      mandatory: "false",
      disabled: "Leave alone",
      cleared: false,
    })) as any;

    const body = snClient.post.mock.calls[0][1];
    expect(body.ui_policy).toBe(validSysId);
    expect(body.catalog_variable).toBe("IO:var123");
    expect(body.visible).toBe("true");
    expect(body.mandatory).toBe("false");
    expect(body.disabled).toBe("Leave alone");
    expect(body.cleared).toBe(false);
    expect(result.success).toBe(true);
    expect(result.data.self_link).toContain("catalog_ui_policy_action.do");
  });

  it("create_catalog_ui_policy_action returns VALIDATION_ERROR for invalid ui_policy", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.create_catalog_ui_policy_action({
      ui_policy: "bad",
      catalog_variable: "IO:var123",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(snClient.post).not.toHaveBeenCalled();
  });
});

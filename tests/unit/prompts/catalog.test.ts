import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerCatalogPrompts } from "../../../src/prompts/catalog.js";

type PromptHandler = () => { messages: { role: string; content: { type: string; text: string } }[] };

describe("registerCatalogPrompts", () => {
  function setup() {
    const handlers: Record<string, PromptHandler> = {};

    const server = {
      prompt: vi.fn(
        (name: string, _description: string, handler: PromptHandler) => {
          handlers[name] = handler;
        }
      ),
    };

    registerCatalogPrompts(server as any);

    return { handlers, server };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers exactly 4 prompts", () => {
    const { server } = setup();
    expect(server.prompt).toHaveBeenCalledTimes(4);
  });

  it("registers prompts with expected names", () => {
    const { server } = setup();
    const names = server.prompt.mock.calls.map((c: unknown[]) => c[0]);
    expect(names).toEqual([
      "build_catalog_form",
      "configure_catalog_ui_policy",
      "configure_catalog_client_script",
      "build_catalog_variable_set",
    ]);
  });

  it("each prompt has a description string", () => {
    const { server } = setup();
    for (const call of server.prompt.mock.calls) {
      expect(typeof call[1]).toBe("string");
      expect((call[1] as string).length).toBeGreaterThan(0);
    }
  });

  describe("build_catalog_form", () => {
    it("returns messages with user role and text content", () => {
      const { handlers } = setup();
      const result = handlers.build_catalog_form();

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content.type).toBe("text");
      expect(typeof result.messages[0].content.text).toBe("string");
    });

    it("mentions key tools and concepts", () => {
      const { handlers } = setup();
      const text = handlers.build_catalog_form().messages[0].content.text;

      expect(text).toContain("create_catalog_item");
      expect(text).toContain("create_catalog_variable");
      expect(text).toContain("create_variable_choice");
      expect(text).toContain("container_start");
      expect(text).toContain("container_split");
      expect(text).toContain("container_end");
      expect(text).toContain("select_box");
      expect(text).toContain("list_catalog_variables");
    });

    it("includes the variable type reference table", () => {
      const { handlers } = setup();
      const text = handlers.build_catalog_form().messages[0].content.text;

      expect(text).toContain("yes_no");
      expect(text).toContain("reference");
      expect(text).toContain("list_collector");
      expect(text).toContain("attachment");
    });
  });

  describe("configure_catalog_ui_policy", () => {
    it("returns messages with user role and text content", () => {
      const { handlers } = setup();
      const result = handlers.configure_catalog_ui_policy();

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content.type).toBe("text");
    });

    it("mentions key tools and IO: format", () => {
      const { handlers } = setup();
      const text = handlers.configure_catalog_ui_policy().messages[0].content.text;

      expect(text).toContain("create_catalog_ui_policy");
      expect(text).toContain("create_catalog_ui_policy_action");
      expect(text).toContain("IO:");
      expect(text).toContain("reverse_if_false");
      expect(text).toContain("catalog_conditions");
      expect(text).toContain('"Leave alone"');
    });
  });

  describe("configure_catalog_client_script", () => {
    it("returns messages with user role and text content", () => {
      const { handlers } = setup();
      const result = handlers.configure_catalog_client_script();

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content.type).toBe("text");
    });

    it("mentions key tools and script types", () => {
      const { handlers } = setup();
      const text = handlers.configure_catalog_client_script().messages[0].content.text;

      expect(text).toContain("create_catalog_client_script");
      expect(text).toContain("onChange");
      expect(text).toContain("onLoad");
      expect(text).toContain("onSubmit");
      expect(text).toContain("IO:");
      expect(text).toContain("g_form");
    });

    it("includes g_form API reference", () => {
      const { handlers } = setup();
      const text = handlers.configure_catalog_client_script().messages[0].content.text;

      expect(text).toContain("setValue");
      expect(text).toContain("setVisible");
      expect(text).toContain("setMandatory");
      expect(text).toContain("addInfoMessage");
    });
  });

  describe("build_catalog_variable_set", () => {
    it("returns messages with user role and text content", () => {
      const { handlers } = setup();
      const result = handlers.build_catalog_variable_set();

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content.type).toBe("text");
    });

    it("mentions key tools and concepts", () => {
      const { handlers } = setup();
      const text = handlers.build_catalog_variable_set().messages[0].content.text;

      expect(text).toContain("create_variable_set");
      expect(text).toContain("attach_variable_set");
      expect(text).toContain("one_to_one");
      expect(text).toContain("one_to_many");
      expect(text).toContain("list_catalog_variables");
      expect(text).toContain("include_set_variables");
    });
  });
});

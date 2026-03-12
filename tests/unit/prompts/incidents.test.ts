import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerIncidentPrompts } from "../../../src/prompts/incidents.js";

type PromptHandler = () => { messages: { role: string; content: { type: string; text: string } }[] };

describe("registerIncidentPrompts", () => {
  function setup() {
    const handlers: Record<string, PromptHandler> = {};

    const server = {
      prompt: vi.fn(
        (name: string, _description: string, handler: PromptHandler) => {
          handlers[name] = handler;
        }
      ),
    };

    registerIncidentPrompts(server as any);

    return { handlers, server };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers exactly 1 prompt", () => {
    const { server } = setup();
    expect(server.prompt).toHaveBeenCalledTimes(1);
  });

  it("registers prompt with expected name", () => {
    const { server } = setup();
    const names = server.prompt.mock.calls.map((c: unknown[]) => c[0]);
    expect(names).toEqual(["incident_triage"]);
  });

  it("each prompt has a description string", () => {
    const { server } = setup();
    for (const call of server.prompt.mock.calls) {
      expect(typeof call[1]).toBe("string");
      expect((call[1] as string).length).toBeGreaterThan(0);
    }
  });

  describe("incident_triage", () => {
    it("returns messages with user role and text content", () => {
      const { handlers } = setup();
      const result = handlers.incident_triage();

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content.type).toBe("text");
      expect(typeof result.messages[0].content.text).toBe("string");
    });

    it("mentions key tools", () => {
      const { handlers } = setup();
      const text = handlers.incident_triage().messages[0].content.text;

      expect(text).toContain("search_incidents");
      expect(text).toContain("create_incident");
      expect(text).toContain("update_incident");
      expect(text).toContain("lookup_group");
      expect(text).toContain("add_work_note");
    });

    it("mentions priority matrix concepts", () => {
      const { handlers } = setup();
      const text = handlers.incident_triage().messages[0].content.text;

      expect(text).toContain("Impact");
      expect(text).toContain("Urgency");
      expect(text).toContain("P1");
      expect(text).toContain("P2");
    });

    it("mentions category examples", () => {
      const { handlers } = setup();
      const text = handlers.incident_triage().messages[0].content.text;

      expect(text).toContain("Hardware");
      expect(text).toContain("Software");
      expect(text).toContain("Network");
    });
  });
});

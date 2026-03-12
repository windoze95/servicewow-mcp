import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerChangeRequestPrompts } from "../../../src/prompts/changeRequests.js";

type PromptHandler = () => { messages: { role: string; content: { type: string; text: string } }[] };

describe("registerChangeRequestPrompts", () => {
  function setup() {
    const handlers: Record<string, PromptHandler> = {};

    const server = {
      prompt: vi.fn(
        (name: string, _description: string, handler: PromptHandler) => {
          handlers[name] = handler;
        }
      ),
    };

    registerChangeRequestPrompts(server as any);

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
    expect(names).toEqual(["change_request_planning"]);
  });

  it("each prompt has a description string", () => {
    const { server } = setup();
    for (const call of server.prompt.mock.calls) {
      expect(typeof call[1]).toBe("string");
      expect((call[1] as string).length).toBeGreaterThan(0);
    }
  });

  describe("change_request_planning", () => {
    it("returns messages with user role and text content", () => {
      const { handlers } = setup();
      const result = handlers.change_request_planning();

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content.type).toBe("text");
      expect(typeof result.messages[0].content.text).toBe("string");
    });

    it("mentions key tools", () => {
      const { handlers } = setup();
      const text = handlers.change_request_planning().messages[0].content.text;

      expect(text).toContain("create_change_request");
      expect(text).toContain("update_change_request");
      expect(text).toContain("search_change_requests");
      expect(text).toContain("add_change_request_work_note");
      expect(text).toContain("get_change_request_approvals");
    });

    it("mentions change types", () => {
      const { handlers } = setup();
      const text = handlers.change_request_planning().messages[0].content.text;

      expect(text).toContain("Normal");
      expect(text).toContain("Standard");
      expect(text).toContain("Emergency");
    });

    it("mentions lifecycle states", () => {
      const { handlers } = setup();
      const text = handlers.change_request_planning().messages[0].content.text;

      expect(text).toContain("New");
      expect(text).toContain("Assess");
      expect(text).toContain("Authorize");
      expect(text).toContain("Scheduled");
      expect(text).toContain("Implement");
      expect(text).toContain("Review");
      expect(text).toContain("Closed");
    });
  });
});

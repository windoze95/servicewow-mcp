import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerKnowledgePrompts } from "../../../src/prompts/knowledge.js";

type PromptHandler = () => { messages: { role: string; content: { type: string; text: string } }[] };

describe("registerKnowledgePrompts", () => {
  function setup() {
    const handlers: Record<string, PromptHandler> = {};

    const server = {
      prompt: vi.fn(
        (name: string, _description: string, handler: PromptHandler) => {
          handlers[name] = handler;
        }
      ),
    };

    registerKnowledgePrompts(server as any);

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
    expect(names).toEqual(["knowledge_article_authoring"]);
  });

  it("each prompt has a description string", () => {
    const { server } = setup();
    for (const call of server.prompt.mock.calls) {
      expect(typeof call[1]).toBe("string");
      expect((call[1] as string).length).toBeGreaterThan(0);
    }
  });

  describe("knowledge_article_authoring", () => {
    it("returns messages with user role and text content", () => {
      const { handlers } = setup();
      const result = handlers.knowledge_article_authoring();

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[0].content.type).toBe("text");
      expect(typeof result.messages[0].content.text).toBe("string");
    });

    it("mentions key tools", () => {
      const { handlers } = setup();
      const text = handlers.knowledge_article_authoring().messages[0].content.text;

      expect(text).toContain("search_knowledge");
      expect(text).toContain("get_article");
    });

    it("mentions article types", () => {
      const { handlers } = setup();
      const text = handlers.knowledge_article_authoring().messages[0].content.text;

      expect(text).toContain("How-To");
      expect(text).toContain("Troubleshooting");
      expect(text).toContain("FAQ");
    });

    it("mentions the article lifecycle", () => {
      const { handlers } = setup();
      const text = handlers.knowledge_article_authoring().messages[0].content.text;

      expect(text).toContain("Draft");
      expect(text).toContain("Review");
      expect(text).toContain("Published");
    });
  });
});

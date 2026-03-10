import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "../../../src/tools/registry.js";
import { registerAllTools } from "../../../src/tools/registry.js";

const mocks = vi.hoisted(() => ({
  registerUserTools: vi.fn(),
  registerIncidentTools: vi.fn(),
  registerKnowledgeTools: vi.fn(),
  registerTaskTools: vi.fn(),
  registerCatalogTools: vi.fn(),
  registerUpdateSetTools: vi.fn(),
  checkLimit: vi.fn(),
  ensureFreshToken: vi.fn(),
  createToolError: vi.fn(),
  handleToolError: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock("../../../src/tools/users.js", () => ({
  registerUserTools: mocks.registerUserTools,
}));

vi.mock("../../../src/tools/incidents.js", () => ({
  registerIncidentTools: mocks.registerIncidentTools,
}));

vi.mock("../../../src/tools/knowledge.js", () => ({
  registerKnowledgeTools: mocks.registerKnowledgeTools,
}));

vi.mock("../../../src/tools/tasks.js", () => ({
  registerTaskTools: mocks.registerTaskTools,
}));

vi.mock("../../../src/tools/catalog.js", () => ({
  registerCatalogTools: mocks.registerCatalogTools,
}));

vi.mock("../../../src/tools/updateSets.js", () => ({
  registerUpdateSetTools: mocks.registerUpdateSetTools,
}));

vi.mock("../../../src/middleware/rateLimiter.js", () => ({
  RateLimiter: class {
    async checkLimit(userSysId: string) {
      return mocks.checkLimit(userSysId);
    }
  },
}));

vi.mock("../../../src/auth/tokenRefresh.js", () => {
  class AuthRequiredError extends Error {
    public readonly code = "AUTH_REQUIRED";

    constructor(public readonly userSysId?: string) {
      super("Authentication required");
      this.name = "AuthRequiredError";
    }
  }

  return {
    TokenRefresher: class {
      async ensureFreshToken(userSysId: string) {
        return mocks.ensureFreshToken(userSysId);
      }
    },
    AuthRequiredError,
  };
});

vi.mock("../../../src/servicenow/client.js", () => ({
  ServiceNowClient: class {
    constructor(
      public readonly instanceUrl: string,
      public readonly accessToken: string
    ) {}
  },
}));

vi.mock("../../../src/middleware/errorHandler.js", () => ({
  createToolError: mocks.createToolError,
  handleToolError: mocks.handleToolError,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    info: mocks.loggerInfo,
  },
}));

type WrapHandler = <T>(
  handler: (ctx: ToolContext, args: T) => Promise<unknown>
) => (args: T) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>;

describe("registerAllTools", () => {
  const tokenStore = {
    getUserForSession: vi.fn(),
  };

  const config = {
    OAUTH_REDIRECT_URI: "http://localhost:3001/oauth/callback",
    RATE_LIMIT_PER_USER: 60,
    SERVICENOW_INSTANCE_URL: "https://example.service-now.com",
  };

  const resolvedToken = {
    access_token: "access-token",
    refresh_token: "refresh-token",
    expires_at: 1_900_000_000,
    user_sys_id: "abc123def456abc123def456abc12345",
    user_name: "john.doe",
    display_name: "John Doe",
  };

  let capturedWrap: WrapHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedWrap = undefined as unknown as WrapHandler;

    mocks.registerUserTools.mockImplementation((_server: unknown, wrap: WrapHandler) => {
      capturedWrap = wrap;
    });
    mocks.registerIncidentTools.mockImplementation(() => {});
    mocks.registerKnowledgeTools.mockImplementation(() => {});
    mocks.registerTaskTools.mockImplementation(() => {});
    mocks.registerCatalogTools.mockImplementation(() => {});
    mocks.registerUpdateSetTools.mockImplementation(() => {});

    mocks.checkLimit.mockResolvedValue(true);
    mocks.ensureFreshToken.mockResolvedValue(resolvedToken);
    mocks.createToolError.mockImplementation(
      (code: string, message: string, details?: unknown) => ({
        success: false,
        error: {
          code,
          message,
          details,
          reference_id: "ref-1",
        },
      })
    );
    mocks.handleToolError.mockReturnValue({
      success: false,
      error: {
        code: "UNEXPECTED_ERROR",
        message: "normalized error",
        reference_id: "ref-2",
      },
    });
  });

  it("returns AUTH_REQUIRED with auth_url when session has no user mapping", async () => {
    tokenStore.getUserForSession.mockResolvedValue(null);

    registerAllTools(
      {} as any,
      () => "session-123",
      config as any,
      {} as any,
      tokenStore as any
    );

    const handler = vi.fn(async () => ({ success: true }));
    const wrapped = capturedWrap(handler);
    const response = await wrapped({} as Record<string, never>);

    expect(handler).not.toHaveBeenCalled();
    expect(response.isError).toBe(true);

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.error.code).toBe("AUTH_REQUIRED");
    expect(parsed.error.details.auth_url).toBe(
      "http://localhost:3001/oauth/authorize?session_id=session-123"
    );
  });

  it("passes through known toolError payloads from handlers", async () => {
    tokenStore.getUserForSession.mockResolvedValue("abc123def456abc123def456abc12345");

    registerAllTools(
      {} as any,
      () => "session-123",
      config as any,
      {} as any,
      tokenStore as any
    );

    const knownToolError = {
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Bad input",
        reference_id: "custom-ref",
      },
    };

    const wrapped = capturedWrap(async () => {
      throw Object.assign(new Error("Validation failed"), {
        toolError: knownToolError,
      });
    });

    const response = await wrapped({} as Record<string, never>);

    expect(response.isError).toBe(true);
    expect(JSON.parse(response.content[0].text)).toEqual(knownToolError);
    expect(mocks.handleToolError).not.toHaveBeenCalled();
  });

  it("normalizes unexpected errors using handleToolError", async () => {
    tokenStore.getUserForSession.mockResolvedValue("abc123def456abc123def456abc12345");

    registerAllTools(
      {} as any,
      () => "session-123",
      config as any,
      {} as any,
      tokenStore as any
    );

    const boom = new Error("Boom");
    const wrapped = capturedWrap(async () => {
      throw boom;
    });

    const response = await wrapped({} as Record<string, never>);

    expect(response.isError).toBe(true);
    expect(JSON.parse(response.content[0].text)).toEqual({
      success: false,
      error: {
        code: "UNEXPECTED_ERROR",
        message: "normalized error",
        reference_id: "ref-2",
      },
    });
    expect(mocks.handleToolError).toHaveBeenCalledWith(boom);
  });
});

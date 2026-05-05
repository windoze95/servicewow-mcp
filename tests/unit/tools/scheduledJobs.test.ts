import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerScheduledJobTools } from "../../../src/tools/scheduledJobs.js";
import type { ToolContext } from "../../../src/tools/registry.js";

type WrappedHandler<T = unknown> = (args: T) => Promise<unknown>;

describe("registerScheduledJobTools", () => {
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

    registerScheduledJobTools(server as never, wrapHandler);

    return { handlers, snClient, server };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("search_scheduled_jobs builds query with name and script_contains and returns self_link", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: {
        result: [
          {
            sys_id: "job-sys-id-001",
            name: "Monthly Site Openings",
            active: "true",
            run_type: "monthly",
            sys_class_name: "sysauto_script",
          },
        ],
      },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.search_scheduled_jobs({
      name: "Monthly",
      script_contains: "Open Site Openings",
      active: true,
      limit: 20,
      offset: 0,
    })) as {
      success: boolean;
      data: { sys_id: string; self_link: string }[];
      metadata: { total_count: number; returned_count: number; offset: number };
    };

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sysauto",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query:
            "nameLIKEMonthly^scriptLIKEOpen Site Openings^active=true^ORDERBYDESCsys_updated_on",
          sysparm_limit: 20,
          sysparm_offset: 0,
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data[0].self_link).toBe(
      "https://example.service-now.com/sysauto_script.do?sys_id=job-sys-id-001"
    );
    expect(result.metadata).toEqual({
      total_count: 1,
      returned_count: 1,
      offset: 0,
    });
  });

  it("search_scheduled_jobs accepts run_as as a valid sys_id", async () => {
    const { handlers, snClient } = setup();
    const runAs = "ed72db164738b6d4718d8a12736d4339";

    snClient.get.mockResolvedValue({
      data: { result: [] },
      headers: { "x-total-count": "0" },
    });

    await handlers.search_scheduled_jobs({
      run_as: runAs,
      limit: 20,
      offset: 0,
    });

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sysauto",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: `run_as=${runAs}^ORDERBYDESCsys_updated_on`,
        }),
      })
    );
  });

  it("search_scheduled_jobs filters by sys_class_name and uses class for self_link", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: {
        result: [
          {
            sys_id: "tmpl-sys-id-001",
            name: "Monthly Review Reminder: Open Site Openings",
            sys_class_name: "sysauto_template",
          },
        ],
      },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.search_scheduled_jobs({
      sys_class_name: "sysauto_template",
      limit: 20,
      offset: 0,
    })) as {
      success: boolean;
      data: { sys_id: string; self_link: string }[];
    };

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/sysauto",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query:
            "sys_class_name=sysauto_template^ORDERBYDESCsys_updated_on",
        }),
      })
    );
    expect(result.data[0].self_link).toBe(
      "https://example.service-now.com/sysauto_template.do?sys_id=tmpl-sys-id-001"
    );
  });

  it("search_scheduled_jobs rejects invalid run_as", async () => {
    const { handlers } = setup();

    const result = (await handlers.search_scheduled_jobs({
      run_as: "not-a-sys-id",
      limit: 20,
      offset: 0,
    })) as { success: boolean; error: { code: string } };

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  it("get_scheduled_job fetches by sys_id and returns self_link", async () => {
    const { handlers, snClient } = setup();
    const jobSysId = "0123456789abcdef0123456789abcdef";

    snClient.get.mockResolvedValue({
      data: {
        result: {
          sys_id: jobSysId,
          name: "PDI Monthly Reminder",
          script: "// create incident",
          sys_class_name: "sysauto_script",
        },
      },
      headers: {},
    });

    const result = (await handlers.get_scheduled_job({
      sys_id: jobSysId,
    })) as { success: boolean; data: { self_link: string } };

    expect(snClient.get).toHaveBeenCalledWith(
      `/api/now/table/sysauto/${jobSysId}`
    );
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/sysauto_script.do?sys_id=${jobSysId}`
    );
  });

  it("get_scheduled_job builds self_link from sys_class_name for record generators", async () => {
    const { handlers, snClient } = setup();
    const jobSysId = "5fef879647f4b6d4718d8a12736d43fd";

    snClient.get.mockResolvedValue({
      data: {
        result: {
          sys_id: jobSysId,
          name: "Monthly Review Reminder: Open Site Openings",
          sys_class_name: "sysauto_template",
        },
      },
      headers: {},
    });

    const result = (await handlers.get_scheduled_job({
      sys_id: jobSysId,
    })) as { success: boolean; data: { self_link: string } };

    expect(snClient.get).toHaveBeenCalledWith(
      `/api/now/table/sysauto/${jobSysId}`
    );
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/sysauto_template.do?sys_id=${jobSysId}`
    );
  });

  it("get_scheduled_job rejects invalid sys_id", async () => {
    const { handlers } = setup();

    const result = (await handlers.get_scheduled_job({
      sys_id: "not-a-sys-id",
    })) as { success: boolean; error: { code: string } };

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

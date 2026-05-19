import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCmdbTools } from "../../../src/tools/cmdb.js";
import type { ToolContext } from "../../../src/tools/registry.js";

type WrappedHandler<T = unknown> = (args: T) => Promise<unknown>;

describe("registerCmdbTools", () => {
  const sysId = "0123456789abcdef0123456789abcdef";

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
      userSysId: "abc123def456abc123def456abc12345",
      userName: "john.doe",
      displayName: "John Doe",
    };

    const wrapHandler = <T>(
      handler: (context: ToolContext, args: T) => Promise<unknown>
    ) => {
      return async (args: T) => handler(ctx, args);
    };

    registerCmdbTools(server as never, wrapHandler);

    return { handlers, snClient, server };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- search_cis -----------------------------------------------------------

  it("search_cis builds a query from every filter and links to the subclass", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: {
        result: [
          { sys_id: "ci-1", name: "host01", sys_class_name: "cmdb_ci_server" },
        ],
      },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.search_cis({
      name: "host",
      sys_class_name: "cmdb_ci_server",
      discovery_source: "SCCM",
      install_status: "1",
      last_discovered_after: "2026-01-01",
      last_discovered_before: "2026-03-01",
      limit: 20,
      offset: 0,
    })) as {
      success: boolean;
      data: { self_link: string }[];
      metadata: { total_count: number; returned_count: number; offset: number };
    };

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/cmdb_ci",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query:
            "nameLIKEhost^sys_class_name=cmdb_ci_server^discovery_source=SCCM^install_status=1^last_discovered>=2026-01-01 00:00:00^last_discovered<=2026-03-01 23:59:59^ORDERBYDESCsys_updated_on",
          sysparm_limit: 20,
          sysparm_offset: 0,
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data[0].self_link).toBe(
      "https://example.service-now.com/cmdb_ci_server.do?sys_id=ci-1"
    );
    expect(result.metadata).toEqual({
      total_count: 1,
      returned_count: 1,
      offset: 0,
    });
  });

  it("search_cis with no filters orders only, and falls back to cmdb_ci for self_link", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [{ sys_id: "ci-2", name: "orphan" }] },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.search_cis({
      limit: 20,
      offset: 0,
    })) as { data: { self_link: string }[] };

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/cmdb_ci",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: "ORDERBYDESCsys_updated_on",
        }),
      })
    );
    expect(result.data[0].self_link).toBe(
      "https://example.service-now.com/cmdb_ci.do?sys_id=ci-2"
    );
  });

  it("search_cis rejects an invalid last_discovered_after date", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.search_cis({
      last_discovered_after: "not-a-date",
      limit: 20,
      offset: 0,
    })) as { success: boolean; error: { code: string; message: string } };

    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("last_discovered_after");
  });

  it("search_cis rejects an invalid last_discovered_before date", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.search_cis({
      last_discovered_before: "2026-13-99",
      limit: 20,
      offset: 0,
    })) as { success: boolean; error: { code: string; message: string } };

    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.message).toContain("last_discovered_before");
  });

  // --- get_ci ---------------------------------------------------------------

  it("get_ci fetches the full record and links to its subclass", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: {
        result: {
          sys_id: sysId,
          name: "db-prod-01",
          sys_class_name: "cmdb_ci_db_instance",
        },
      },
      headers: {},
    });

    const result = (await handlers.get_ci({ sys_id: sysId })) as {
      success: boolean;
      data: { self_link: string };
    };

    expect(snClient.get).toHaveBeenCalledWith(
      `/api/now/table/cmdb_ci/${sysId}`
    );
    expect(result.success).toBe(true);
    expect(result.data.self_link).toBe(
      `https://example.service-now.com/cmdb_ci_db_instance.do?sys_id=${sysId}`
    );
  });

  it("get_ci rejects an invalid sys_id", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.get_ci({ sys_id: "not-a-sys-id" })) as {
      success: boolean;
      error: { code: string };
    };

    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  // --- get_ci_relationships -------------------------------------------------

  it("get_ci_relationships fetches both directions with truncation flags", async () => {
    const { handlers, snClient } = setup();

    snClient.get
      .mockResolvedValueOnce({
        data: { result: [{ sys_id: "rel-p1" }] },
        headers: { "x-total-count": "3" },
      })
      .mockResolvedValueOnce({
        data: { result: [{ sys_id: "rel-c1" }] },
        headers: { "x-total-count": "1" },
      });

    const result = (await handlers.get_ci_relationships({
      sys_id: sysId,
      limit: 200,
    })) as {
      success: boolean;
      data: {
        ci_sys_id: string;
        parent_of: { sys_id: string; self_link: string }[];
        child_of: { sys_id: string; self_link: string }[];
        metadata: {
          parent_of: { total_count: number; truncated: boolean };
          child_of: { total_count: number; truncated: boolean };
        };
      };
    };

    expect(snClient.get).toHaveBeenNthCalledWith(
      1,
      "/api/now/table/cmdb_rel_ci",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: `parent=${sysId}^ORDERBYDESCsys_updated_on`,
          sysparm_limit: 200,
        }),
      })
    );
    expect(snClient.get).toHaveBeenNthCalledWith(
      2,
      "/api/now/table/cmdb_rel_ci",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: `child=${sysId}^ORDERBYDESCsys_updated_on`,
        }),
      })
    );
    expect(result.data.ci_sys_id).toBe(sysId);
    expect(result.data.parent_of[0].self_link).toBe(
      "https://example.service-now.com/cmdb_rel_ci.do?sys_id=rel-p1"
    );
    expect(result.data.child_of[0].self_link).toBe(
      "https://example.service-now.com/cmdb_rel_ci.do?sys_id=rel-c1"
    );
    expect(result.data.metadata.parent_of).toEqual({
      total_count: 3,
      returned_count: 1,
      truncated: true,
    });
    expect(result.data.metadata.child_of).toEqual({
      total_count: 1,
      returned_count: 1,
      truncated: false,
    });
  });

  it("get_ci_relationships rejects an invalid sys_id", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.get_ci_relationships({
      sys_id: "nope",
      limit: 200,
    })) as { success: boolean; error: { code: string } };

    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });

  // --- count_cis_by_class ---------------------------------------------------

  it("count_cis_by_class parses, filters, sorts and totals the aggregate", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: {
        result: [
          {
            stats: { count: "5" },
            groupby_fields: [
              {
                field: "sys_class_name",
                value: "cmdb_ci_server",
                display_value: "Server",
              },
            ],
          },
          {
            stats: { count: "12" },
            groupby_fields: [
              {
                field: "sys_class_name",
                value: "cmdb_ci_appl",
                display_value: "Application",
              },
            ],
          },
          {
            stats: { count: "9" },
            groupby_fields: [
              { field: "sys_class_name", value: "", display_value: "" },
            ],
          },
        ],
      },
      headers: {},
    });

    const result = (await handlers.count_cis_by_class({})) as {
      success: boolean;
      data: {
        classes: { sys_class_name: string; label: string; count: number }[];
        metadata: { class_count: number; total_cis: number };
      };
    };

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/stats/cmdb_ci",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_group_by: "sys_class_name",
          sysparm_count: true,
        }),
      })
    );
    expect(result.data.classes).toEqual([
      { sys_class_name: "cmdb_ci_appl", label: "Application", count: 12 },
      { sys_class_name: "cmdb_ci_server", label: "Server", count: 5 },
    ]);
    expect(result.data.metadata).toEqual({ class_count: 2, total_cis: 17 });
  });

  it("count_cis_by_class tolerates a single-object result and a missing count", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: {
        result: {
          groupby_fields: [
            { field: "sys_class_name", value: "cmdb_ci" },
          ],
        },
      },
      headers: {},
    });

    const result = (await handlers.count_cis_by_class({})) as {
      data: {
        classes: { sys_class_name: string; label: string; count: number }[];
        metadata: { class_count: number; total_cis: number };
      };
    };

    expect(result.data.classes).toEqual([
      { sys_class_name: "cmdb_ci", label: "cmdb_ci", count: 0 },
    ]);
    expect(result.data.metadata).toEqual({ class_count: 1, total_cis: 0 });
  });

  it("count_cis_by_class handles an empty aggregate result", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: undefined },
      headers: {},
    });

    const result = (await handlers.count_cis_by_class({})) as {
      data: {
        classes: unknown[];
        metadata: { class_count: number; total_cis: number };
      };
    };

    expect(result.data.classes).toEqual([]);
    expect(result.data.metadata).toEqual({ class_count: 0, total_cis: 0 });
  });

  // --- find_stale_cis -------------------------------------------------------

  it("find_stale_cis not_recently_discovered builds a UTC cutoff query", async () => {
    const { handlers, snClient } = setup();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-19T12:00:00.000Z"));

    snClient.get.mockResolvedValue({
      data: { result: [{ sys_id: "ci-stale", sys_class_name: "cmdb_ci_server" }] },
      headers: { "x-total-count": "1" },
    });

    const result = (await handlers.find_stale_cis({
      reason: "not_recently_discovered",
      stale_after_days: 30,
      sys_class_name: "cmdb_ci_server",
      limit: 20,
      offset: 0,
    })) as {
      success: boolean;
      metadata: { reason: string; stale_after_days: number };
    };

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/cmdb_ci",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query:
            "sys_class_name=cmdb_ci_server^last_discovered<2026-04-19 12:00:00^ORDERBYDESCsys_updated_on",
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.metadata.reason).toBe("not_recently_discovered");
    expect(result.metadata.stale_after_days).toBe(30);
  });

  it("find_stale_cis retired_but_operational queries the contradiction", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [] },
      headers: { "x-total-count": "0" },
    });

    const result = (await handlers.find_stale_cis({
      reason: "retired_but_operational",
      stale_after_days: 90,
      limit: 20,
      offset: 0,
    })) as { metadata: Record<string, unknown> };

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/cmdb_ci",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query:
            "install_status=7^operational_status=1^ORDERBYDESCsys_updated_on",
        }),
      })
    );
    expect(result.metadata.reason).toBe("retired_but_operational");
    expect(result.metadata.stale_after_days).toBeUndefined();
  });

  it("find_stale_cis missing_assignment_group queries an empty group", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValue({
      data: { result: [] },
      headers: { "x-total-count": "0" },
    });

    await handlers.find_stale_cis({
      reason: "missing_assignment_group",
      stale_after_days: 90,
      limit: 20,
      offset: 0,
    });

    expect(snClient.get).toHaveBeenCalledWith(
      "/api/now/table/cmdb_ci",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query:
            "assignment_groupISEMPTY^ORDERBYDESCsys_updated_on",
        }),
      })
    );
  });

  // --- get_ci_ticket_references --------------------------------------------

  it("get_ci_ticket_references counts each ticket type and samples them", async () => {
    const { handlers, snClient } = setup();

    snClient.get
      .mockResolvedValueOnce({
        data: {
          result: {
            sys_id: sysId,
            name: "host01",
            sys_class_name: "cmdb_ci_server",
          },
        },
        headers: {},
      })
      .mockResolvedValueOnce({
        data: { result: [{ sys_id: "inc1", number: "INC0001" }] },
        headers: { "x-total-count": "4" },
      })
      .mockResolvedValueOnce({
        data: { result: [] },
        headers: { "x-total-count": "0" },
      })
      .mockResolvedValueOnce({
        data: { result: [{ sys_id: "prb1", number: "PRB0001" }] },
        headers: { "x-total-count": "2" },
      });

    const result = (await handlers.get_ci_ticket_references({
      sys_id: sysId,
      sample_limit: 5,
    })) as {
      success: boolean;
      data: {
        ci: { self_link: string };
        references: Record<
          string,
          { count: number; returned: number; sample: { self_link: string }[] }
        >;
        metadata: { total_references: number };
      };
    };

    expect(snClient.get).toHaveBeenNthCalledWith(
      1,
      `/api/now/table/cmdb_ci/${sysId}`,
      expect.objectContaining({
        params: { sysparm_fields: "sys_id,name,sys_class_name" },
      })
    );
    expect(snClient.get).toHaveBeenNthCalledWith(
      2,
      "/api/now/table/incident",
      expect.objectContaining({
        params: expect.objectContaining({
          sysparm_query: `cmdb_ci=${sysId}^ORDERBYDESCsys_updated_on`,
          sysparm_limit: 5,
        }),
      })
    );
    expect(result.success).toBe(true);
    expect(result.data.ci.self_link).toBe(
      `https://example.service-now.com/cmdb_ci_server.do?sys_id=${sysId}`
    );
    expect(result.data.references.incidents.count).toBe(4);
    expect(result.data.references.incidents.returned).toBe(1);
    expect(result.data.references.incidents.sample[0].self_link).toBe(
      "https://example.service-now.com/incident.do?sys_id=inc1"
    );
    expect(result.data.references.changes.count).toBe(0);
    expect(result.data.references.problems.count).toBe(2);
    expect(result.data.references.problems.sample[0].self_link).toBe(
      "https://example.service-now.com/problem.do?sys_id=prb1"
    );
    expect(result.data.metadata.total_references).toBe(6);
  });

  it("get_ci_ticket_references with sample_limit 0 still returns counts", async () => {
    const { handlers, snClient } = setup();

    snClient.get
      .mockResolvedValueOnce({
        data: { result: { sys_id: sysId, name: "host01" } },
        headers: {},
      })
      .mockResolvedValueOnce({
        data: { result: [] },
        headers: { "x-total-count": "7" },
      })
      .mockResolvedValueOnce({
        data: { result: [] },
        headers: { "x-total-count": "0" },
      })
      .mockResolvedValueOnce({
        data: { result: [] },
        headers: { "x-total-count": "0" },
      });

    const result = (await handlers.get_ci_ticket_references({
      sys_id: sysId,
      sample_limit: 0,
    })) as {
      data: {
        references: Record<
          string,
          { count: number; returned: number; sample: unknown[] }
        >;
        metadata: { total_references: number };
      };
    };

    expect(snClient.get).toHaveBeenNthCalledWith(
      2,
      "/api/now/table/incident",
      expect.objectContaining({
        params: expect.objectContaining({ sysparm_limit: 0 }),
      })
    );
    expect(result.data.references.incidents).toEqual({
      count: 7,
      returned: 0,
      sample: [],
    });
    expect(result.data.metadata.total_references).toBe(7);
  });

  it("get_ci_ticket_references rejects an invalid sys_id", async () => {
    const { handlers, snClient } = setup();

    const result = (await handlers.get_ci_ticket_references({
      sys_id: "bad",
      sample_limit: 5,
    })) as { success: boolean; error: { code: string } };

    expect(snClient.get).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
  });
});

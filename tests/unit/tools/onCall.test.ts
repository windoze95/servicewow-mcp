import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerOnCallTools } from "../../../src/tools/onCall.js";
import type { ToolContext } from "../../../src/tools/registry.js";

type WrappedHandler<T = unknown> = (args: T) => Promise<unknown>;

const ROTA_ID = "05fe10b447457e98718d8a12736d43d0";
const GROUP_ID = "f16fce0a4fcd255057a8847221ad48dc";
const SCHEDULE_ID = "cdfe10b447457e98718d8a12736d43d0";
const USER_ID = "aaaa10b447457e98718d8a12736d43d0";

describe("registerOnCallTools", () => {
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
      userSysId: USER_ID,
      userName: "john.doe",
      displayName: "John Doe",
    };

    const wrapHandler = <T>(
      _toolName: string,
      handler: (context: ToolContext, args: T) => Promise<unknown>
    ) => {
      return async (args: T) => handler(ctx, args);
    };

    registerOnCallTools(server as never, wrapHandler);

    return { handlers, snClient, server };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers all on-call tools", () => {
    const { handlers } = setup();
    expect(Object.keys(handlers).sort()).toEqual([
      "get_on_call_escalation_policy",
      "get_on_call_schedule",
      "get_on_call_shift",
      "get_user_notification_devices",
      "list_notify_numbers",
      "search_on_call_shifts",
      "search_on_call_trigger_rules",
      "who_is_on_call",
    ]);
  });

  describe("search_on_call_shifts", () => {
    it("builds query with group, name, and active and returns self_link", async () => {
      const { handlers, snClient } = setup();

      snClient.get.mockResolvedValue({
        data: {
          result: [
            {
              sys_id: ROTA_ID,
              name: "Network Weekend",
              active: "true",
            },
          ],
        },
        headers: { "x-total-count": "1" },
      });

      const result = (await handlers.search_on_call_shifts({
        group: GROUP_ID,
        name: "Network",
        active: true,
        limit: 20,
        offset: 0,
      })) as {
        success: boolean;
        data: { self_link: string }[];
        metadata: { total_count: number };
      };

      expect(snClient.get).toHaveBeenCalledWith(
        "/api/now/table/cmn_rota",
        expect.objectContaining({
          params: expect.objectContaining({
            sysparm_query: `group=${GROUP_ID}^nameLIKENetwork^active=true^ORDERBYgroup^ORDERBYname`,
            sysparm_limit: 20,
            sysparm_offset: 0,
          }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.data[0].self_link).toBe(
        `https://example.service-now.com/cmn_rota.do?sys_id=${ROTA_ID}`
      );
      expect(result.metadata.total_count).toBe(1);
    });

    it("rejects an invalid group sys_id", async () => {
      const { handlers, snClient } = setup();

      const result = (await handlers.search_on_call_shifts({
        group: "not-a-sys-id",
        limit: 20,
        offset: 0,
      })) as { success: boolean; error: { code: string } };

      expect(snClient.get).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("get_on_call_shift", () => {
    it("expands rosters with members and spans grouped by roster", async () => {
      const { handlers, snClient } = setup();
      const rosterA = "b1fe10b447457e98718d8a12736d43d1";
      const rosterB = "b2fe10b447457e98718d8a12736d43d2";

      snClient.get.mockImplementation(async (path: string) => {
        if (path === `/api/now/table/cmn_rota/${ROTA_ID}`) {
          return {
            data: { result: { sys_id: ROTA_ID, name: "Weekend" } },
            headers: {},
          };
        }
        if (path === "/api/now/table/cmn_rota_roster") {
          return {
            data: {
              result: [
                { sys_id: rosterA, name: "Primary", order: "100" },
                { sys_id: rosterB, name: "Secondary", order: "200" },
              ],
            },
            headers: { "x-total-count": "2" },
          };
        }
        if (path === "/api/now/table/cmn_rota_member") {
          return {
            data: {
              result: [
                // display=all shape: references carry value + display_value.
                {
                  sys_id: "m1fe10b447457e98718d8a12736d43d1",
                  roster: { value: rosterA, display_value: "Primary" },
                  member: { value: USER_ID, display_value: "John Doe" },
                },
                // display=true shape (no value key): the sys_id must be
                // recovered from the reference link.
                {
                  sys_id: "m2fe10b447457e98718d8a12736d43d2",
                  roster: {
                    display_value: "Secondary",
                    link: `https://example.service-now.com/api/now/table/cmn_rota_roster/${rosterB}`,
                  },
                  member: { value: USER_ID, display_value: "John Doe" },
                },
              ],
            },
            headers: { "x-total-count": "2" },
          };
        }
        if (path === "/api/now/table/roster_schedule_span") {
          return {
            data: {
              result: [
                {
                  sys_id: "s1fe10b447457e98718d8a12736d43d1",
                  roster: { value: rosterA, display_value: "Primary" },
                  type: "on_call",
                },
              ],
            },
            headers: { "x-total-count": "1" },
          };
        }
        throw new Error(`Unexpected path: ${path}`);
      });

      const result = (await handlers.get_on_call_shift({
        sys_id: ROTA_ID,
        member_limit: 200,
        span_limit: 200,
      })) as {
        success: boolean;
        data: {
          shift: { self_link: string };
          rosters: {
            sys_id: string;
            members: { sys_id: string }[];
            schedule_spans: { sys_id: string }[];
          }[];
          metadata: { members: { total_count: number } };
        };
      };

      expect(snClient.get).toHaveBeenCalledWith(
        "/api/now/table/cmn_rota_member",
        expect.objectContaining({
          params: expect.objectContaining({
            sysparm_query: `roster.rota=${ROTA_ID}^ORDERBYroster^ORDERBYorder`,
            sysparm_display_value: "all",
          }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.data.rosters).toHaveLength(2);
      expect(result.data.rosters[0].members).toHaveLength(1);
      expect(result.data.rosters[0].schedule_spans).toHaveLength(1);
      expect(result.data.rosters[1].members).toHaveLength(1);
      expect(result.data.rosters[1].schedule_spans).toHaveLength(0);
      expect(result.data.metadata.members.total_count).toBe(2);
    });

    it("rejects an invalid sys_id", async () => {
      const { handlers, snClient } = setup();

      const result = (await handlers.get_on_call_shift({
        sys_id: "nope",
        member_limit: 200,
        span_limit: 200,
      })) as { success: boolean; error: { code: string } };

      expect(snClient.get).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("get_on_call_schedule", () => {
    it("fetches schedule, spans, and child schedules", async () => {
      const { handlers, snClient } = setup();

      snClient.get.mockImplementation(async (path: string) => {
        if (path === `/api/now/table/cmn_schedule/${SCHEDULE_ID}`) {
          return {
            data: {
              result: {
                sys_id: SCHEDULE_ID,
                name: "Network Weekend",
                time_zone: "US/Central",
              },
            },
            headers: {},
          };
        }
        if (path === "/api/now/table/cmn_schedule_span") {
          return {
            data: {
              result: [
                // display=all wraps even sys_id in {value, display_value};
                // the self_link must be built from the unwrapped value.
                {
                  sys_id: {
                    value: "c1fe10b447457e98718d8a12736d43d1",
                    display_value: "c1fe10b447457e98718d8a12736d43d1",
                  },
                  days_of_week: "17",
                },
              ],
            },
            headers: { "x-total-count": "1" },
          };
        }
        if (path === "/api/now/table/cmn_other_schedule") {
          return {
            data: { result: [] },
            headers: { "x-total-count": "0" },
          };
        }
        throw new Error(`Unexpected path: ${path}`);
      });

      const result = (await handlers.get_on_call_schedule({
        sys_id: SCHEDULE_ID,
        span_limit: 100,
      })) as {
        success: boolean;
        data: {
          schedule: { self_link: string };
          spans: unknown[];
          child_schedules: unknown[];
          metadata: { spans: { truncated: boolean } };
        };
      };

      expect(snClient.get).toHaveBeenCalledWith(
        "/api/now/table/cmn_schedule_span",
        expect.objectContaining({
          params: expect.objectContaining({
            sysparm_query: `schedule=${SCHEDULE_ID}^ORDERBYstart_date_time`,
            sysparm_limit: 100,
            sysparm_display_value: "all",
          }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.data.spans).toHaveLength(1);
      expect(
        (result.data.spans[0] as { self_link: string }).self_link
      ).toBe(
        "https://example.service-now.com/cmn_schedule_span.do?sys_id=c1fe10b447457e98718d8a12736d43d1"
      );
      expect(result.data.child_schedules).toHaveLength(0);
      expect(result.data.metadata.spans.truncated).toBe(false);
    });

    it("rejects an invalid sys_id", async () => {
      const { handlers, snClient } = setup();

      const result = (await handlers.get_on_call_schedule({
        sys_id: "nope",
        span_limit: 100,
      })) as { success: boolean; error: { code: string } };

      expect(snClient.get).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("get_on_call_escalation_policy", () => {
    it("assembles sets with nested steps, preferences, and group preferences", async () => {
      const { handlers, snClient } = setup();
      const setA = "e1fe10b447457e98718d8a12736d43d1";

      snClient.get.mockImplementation(async (path: string, options?: unknown) => {
        void options;
        if (path === `/api/now/table/cmn_rota/${ROTA_ID}`) {
          return {
            data: {
              result: {
                sys_id: ROTA_ID,
                name: "Weekend",
                group: { value: GROUP_ID, display_value: "IT Support" },
              },
            },
            headers: {},
          };
        }
        if (path === "/api/now/table/cmn_rota_escalation_set") {
          return {
            data: {
              result: [{ sys_id: setA, name: "Default", default: "true" }],
            },
            headers: { "x-total-count": "1" },
          };
        }
        if (path === "/api/now/table/cmn_rota_esc_step_def") {
          return {
            data: {
              result: [
                {
                  sys_id: "d1fe10b447457e98718d8a12736d43d1",
                  escalation_set: { value: setA, display_value: "Default" },
                  escalation_level: "1",
                },
                {
                  sys_id: "d2fe10b447457e98718d8a12736d43d2",
                  escalation_set: setA,
                  escalation_level: "2",
                },
              ],
            },
            headers: { "x-total-count": "2" },
          };
        }
        if (path === "/api/now/table/cmn_rota_contact_preference") {
          return {
            data: {
              result: [{ sys_id: "p1fe10b447457e98718d8a12736d43d1" }],
            },
            headers: { "x-total-count": "1" },
          };
        }
        if (path === "/api/now/table/on_call_group_preference") {
          return {
            data: {
              result: [{ sys_id: "g1fe10b447457e98718d8a12736d43d1" }],
            },
            headers: { "x-total-count": "1" },
          };
        }
        if (path === "/api/now/table/on_call_communication_type") {
          return {
            data: {
              result: [{ sys_id: "t1fe10b447457e98718d8a12736d43d1", type: "email" }],
            },
            headers: { "x-total-count": "1" },
          };
        }
        throw new Error(`Unexpected path: ${path}`);
      });

      const result = (await handlers.get_on_call_escalation_policy({
        sys_id: ROTA_ID,
      })) as {
        success: boolean;
        data: {
          escalation_sets: { steps: unknown[] }[];
          contact_preferences: unknown[];
          group_preferences: unknown[];
          communication_types: unknown[];
          metadata: {
            group_preferences: { total_count: number; truncated: boolean };
            communication_types: { total_count: number; truncated: boolean };
          };
        };
      };

      expect(snClient.get).toHaveBeenCalledWith(
        "/api/now/table/cmn_rota_escalation_set",
        expect.objectContaining({
          params: expect.objectContaining({
            sysparm_query: `cmn_rota=${ROTA_ID}^ORDERBYorder`,
          }),
        })
      );
      expect(snClient.get).toHaveBeenCalledWith(
        "/api/now/table/cmn_rota_contact_preference",
        expect.objectContaining({
          params: expect.objectContaining({
            sysparm_query: `cmn_rota=${ROTA_ID}^ORcmn_rota_escalation_set.cmn_rota=${ROTA_ID}`,
          }),
        })
      );
      expect(snClient.get).toHaveBeenCalledWith(
        "/api/now/table/on_call_group_preference",
        expect.objectContaining({
          params: expect.objectContaining({
            sysparm_query: `group=${GROUP_ID}`,
          }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.data.escalation_sets).toHaveLength(1);
      expect(result.data.escalation_sets[0].steps).toHaveLength(2);
      expect(result.data.contact_preferences).toHaveLength(1);
      expect(result.data.group_preferences).toHaveLength(1);
      expect(result.data.communication_types).toHaveLength(1);
      expect(result.data.metadata.group_preferences).toEqual({
        total_count: 1,
        returned_count: 1,
        truncated: false,
      });
      expect(result.data.metadata.communication_types).toEqual({
        total_count: 1,
        returned_count: 1,
        truncated: false,
      });
    });

    it("skips group preferences when the shift has no resolvable group", async () => {
      const { handlers, snClient } = setup();

      snClient.get.mockImplementation(async (path: string) => {
        if (path === `/api/now/table/cmn_rota/${ROTA_ID}`) {
          return {
            data: { result: { sys_id: ROTA_ID, name: "Weekend", group: "" } },
            headers: {},
          };
        }
        return {
          data: { result: [] },
          headers: { "x-total-count": "0" },
        };
      });

      const result = (await handlers.get_on_call_escalation_policy({
        sys_id: ROTA_ID,
      })) as {
        success: boolean;
        data: { group_preferences: unknown[] };
      };

      expect(result.success).toBe(true);
      expect(result.data.group_preferences).toEqual([]);
      expect(snClient.get).not.toHaveBeenCalledWith(
        "/api/now/table/on_call_group_preference",
        expect.anything()
      );
    });
  });

  describe("who_is_on_call", () => {
    it("queries v_on_call filtered by group and flags empty results", async () => {
      const { handlers, snClient } = setup();

      snClient.get.mockResolvedValue({
        data: { result: [] },
        headers: { "x-total-count": "0" },
      });

      const result = (await handlers.who_is_on_call({
        group: GROUP_ID,
        limit: 50,
      })) as {
        success: boolean;
        metadata: { note?: string };
      };

      expect(snClient.get).toHaveBeenCalledWith(
        "/api/now/table/v_on_call",
        expect.objectContaining({
          params: expect.objectContaining({
            sysparm_query: `group=${GROUP_ID}`,
            sysparm_limit: 50,
          }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.metadata.note).toContain("ACLs");
    });

    it("omits sysparm_query and the empty-result note when rows come back", async () => {
      const { handlers, snClient } = setup();

      snClient.get.mockResolvedValue({
        data: { result: [{ sys_id: "v1fe10b447457e98718d8a12736d43d1" }] },
        headers: { "x-total-count": "1" },
      });

      const result = (await handlers.who_is_on_call({
        limit: 50,
      })) as {
        success: boolean;
        data: unknown[];
        metadata: { note?: string };
      };

      const call = snClient.get.mock.calls[0] as [string, { params: Record<string, unknown> }];
      expect(call[0]).toBe("/api/now/table/v_on_call");
      expect(call[1].params).not.toHaveProperty("sysparm_query");
      expect(result.data).toHaveLength(1);
      expect(result.metadata.note).toBeUndefined();
    });

    it("rejects an invalid group sys_id", async () => {
      const { handlers, snClient } = setup();

      const result = (await handlers.who_is_on_call({
        group: "nope",
        limit: 50,
      })) as { success: boolean; error: { code: string } };

      expect(snClient.get).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("get_user_notification_devices", () => {
    it("filters to active devices by default and orders by device order", async () => {
      const { handlers, snClient } = setup();

      snClient.get.mockResolvedValue({
        data: {
          result: [
            {
              sys_id: "n1fe10b447457e98718d8a12736d43d1",
              type: "Email",
              email_address: "john@example.com",
            },
          ],
        },
        headers: { "x-total-count": "1" },
      });

      const result = (await handlers.get_user_notification_devices({
        user: USER_ID,
        include_inactive: false,
        limit: 50,
      })) as {
        success: boolean;
        data: { self_link: string }[];
      };

      expect(snClient.get).toHaveBeenCalledWith(
        "/api/now/table/cmn_notif_device",
        expect.objectContaining({
          params: expect.objectContaining({
            sysparm_query: `user=${USER_ID}^active=true^ORDERBYorder`,
          }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.data[0].self_link).toBe(
        "https://example.service-now.com/cmn_notif_device.do?sys_id=n1fe10b447457e98718d8a12736d43d1"
      );
    });

    it("includes inactive devices when requested", async () => {
      const { handlers, snClient } = setup();

      snClient.get.mockResolvedValue({
        data: { result: [] },
        headers: { "x-total-count": "0" },
      });

      await handlers.get_user_notification_devices({
        user: USER_ID,
        include_inactive: true,
        limit: 50,
      });

      expect(snClient.get).toHaveBeenCalledWith(
        "/api/now/table/cmn_notif_device",
        expect.objectContaining({
          params: expect.objectContaining({
            sysparm_query: `user=${USER_ID}^ORDERBYorder`,
          }),
        })
      );
    });

    it("rejects an invalid user sys_id", async () => {
      const { handlers, snClient } = setup();

      const result = (await handlers.get_user_notification_devices({
        user: "nope",
        include_inactive: false,
        limit: 50,
      })) as { success: boolean; error: { code: string } };

      expect(snClient.get).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("search_on_call_trigger_rules", () => {
    it("builds query from table, group, name, and active with display=all", async () => {
      const { handlers, snClient } = setup();

      snClient.get.mockResolvedValue({
        data: {
          result: [
            {
              sys_id: { value: "r1fe10b447457e98718d8a12736d43d1" },
              name: { value: "Major Incident", display_value: "Major Incident" },
              trigger_workflow: {
                value: "w1fe10b447457e98718d8a12736d43d1",
                display_value: "Assign by Acknowledgement",
              },
            },
          ],
        },
        headers: { "x-total-count": "1" },
      });

      const result = (await handlers.search_on_call_trigger_rules({
        table: "incident",
        group: GROUP_ID,
        name: "Major",
        active: true,
        limit: 20,
        offset: 0,
      })) as {
        success: boolean;
        data: { self_link: string }[];
        metadata: { total_count: number };
      };

      expect(snClient.get).toHaveBeenCalledWith(
        "/api/now/table/trigger_rule",
        expect.objectContaining({
          params: expect.objectContaining({
            sysparm_query: `table=incident^group=${GROUP_ID}^nameLIKEMajor^active=true^ORDERBYDESCsys_updated_on`,
            sysparm_display_value: "all",
          }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.data[0].self_link).toBe(
        "https://example.service-now.com/trigger_rule.do?sys_id=r1fe10b447457e98718d8a12736d43d1"
      );
    });

    it("rejects an invalid group sys_id", async () => {
      const { handlers, snClient } = setup();

      const result = (await handlers.search_on_call_trigger_rules({
        group: "nope",
        limit: 20,
        offset: 0,
      })) as { success: boolean; error: { code: string } };

      expect(snClient.get).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("list_notify_numbers", () => {
    it("lists numbers ordered by number with an optional active filter", async () => {
      const { handlers, snClient } = setup();

      snClient.get.mockResolvedValue({
        data: {
          result: [
            {
              sys_id: { value: "p1fe10b447457e98718d8a12736d43d1" },
              number: { value: "+15550100000", display_value: "+15550100000" },
              active: { value: "false", display_value: "false" },
            },
          ],
        },
        headers: { "x-total-count": "1" },
      });

      const result = (await handlers.list_notify_numbers({
        active: false,
        limit: 50,
      })) as {
        success: boolean;
        data: { self_link: string }[];
      };

      expect(snClient.get).toHaveBeenCalledWith(
        "/api/now/table/notify_number",
        expect.objectContaining({
          params: expect.objectContaining({
            sysparm_query: "active=false^ORDERBYnumber",
            sysparm_display_value: "all",
          }),
        })
      );
      expect(result.success).toBe(true);
      expect(result.data[0].self_link).toBe(
        "https://example.service-now.com/notify_number.do?sys_id=p1fe10b447457e98718d8a12736d43d1"
      );
    });

    it("omits the active filter when not provided", async () => {
      const { handlers, snClient } = setup();

      snClient.get.mockResolvedValue({
        data: { result: [] },
        headers: { "x-total-count": "0" },
      });

      await handlers.list_notify_numbers({ limit: 50 });

      expect(snClient.get).toHaveBeenCalledWith(
        "/api/now/table/notify_number",
        expect.objectContaining({
          params: expect.objectContaining({
            sysparm_query: "ORDERBYnumber",
          }),
        })
      );
    });
  });
});

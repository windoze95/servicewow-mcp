import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerUpdateSetTools } from "../../../src/tools/updateSets.js";
import type { ToolContext } from "../../../src/tools/registry.js";

type WrappedHandler<T = unknown> = (args: T) => Promise<unknown>;

describe("registerUpdateSetTools", () => {
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

    registerUpdateSetTools(server as any, wrapHandler);

    return { handlers, snClient };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("get_current_update_set", () => {
    it("returns update set details when preference exists", async () => {
      const { handlers, snClient } = setup();
      const updateSetId = "0123456789abcdef0123456789abcdef";

      snClient.get
        .mockResolvedValueOnce({
          data: {
            result: [
              {
                sys_id: "pref-1",
                name: "sys_update_set",
                user: userSysId,
                value: updateSetId,
              },
            ],
          },
          headers: {},
        })
        .mockResolvedValueOnce({
          data: {
            result: {
              sys_id: updateSetId,
              name: "My Update Set",
              state: "in progress",
              application: "Global",
              sys_updated_on: "2026-03-17 12:00:00",
            },
          },
          headers: {},
        });

      const result = (await handlers.get_current_update_set({})) as any;

      expect(result.success).toBe(true);
      expect(result.data.current_update_set).toEqual({
        sys_id: updateSetId,
        name: "My Update Set",
        state: "in progress",
        application: "Global",
        self_link: `https://example.service-now.com/sys_update_set.do?sys_id=${updateSetId}`,
      });
      expect(snClient.get).toHaveBeenNthCalledWith(
        1,
        "/api/now/table/sys_user_preference",
        {
          params: {
            sysparm_query: `name=sys_update_set^user=${userSysId}`,
            sysparm_limit: 1,
            sysparm_fields: "sys_id,name,user,value",
          },
        }
      );
      expect(snClient.get).toHaveBeenNthCalledWith(
        2,
        `/api/now/table/sys_update_set/${updateSetId}`,
        {
          params: {
            sysparm_fields: "sys_id,name,state,application,sys_updated_on",
          },
        }
      );
    });

    it("returns null when no preference exists", async () => {
      const { handlers, snClient } = setup();

      snClient.get.mockResolvedValueOnce({
        data: { result: [] },
        headers: {},
      });

      const result = (await handlers.get_current_update_set({})) as any;

      expect(result.success).toBe(true);
      expect(result.data.current_update_set).toBeNull();
      expect(result.data.message).toContain("Default update set");
      expect(snClient.get).toHaveBeenCalledTimes(1);
    });

    it("propagates error when update set lookup fails", async () => {
      const { handlers, snClient } = setup();

      snClient.get
        .mockResolvedValueOnce({
          data: {
            result: [
              {
                sys_id: "pref-1",
                name: "sys_update_set",
                user: userSysId,
                value: "missing12345678901234567890abcdef",
              },
            ],
          },
          headers: {},
        })
        .mockRejectedValueOnce(new Error("Not Found"));

      await expect(
        handlers.get_current_update_set({})
      ).rejects.toThrow("Not Found");
    });
  });

  it("returns NOT_FOUND when no in-progress update set matches identifier", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValueOnce({ data: { result: [] }, headers: {} });

    const result = (await handlers.change_update_set({
      identifier: "No Match",
    })) as any;

    expect(result).toEqual({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "No in-progress update set found for the provided identifier.",
      },
    });
    expect(snClient.patch).not.toHaveBeenCalled();
    expect(snClient.post).not.toHaveBeenCalled();
  });

  it("returns AMBIGUOUS_MATCH when multiple name matches exist", async () => {
    const { handlers, snClient } = setup();

    snClient.get.mockResolvedValueOnce({
      data: {
        result: [
          {
            sys_id: "0123456789abcdef0123456789abcdef",
            name: "Feature Work",
            state: "in progress",
            sys_updated_on: "2026-03-10 10:00:00",
          },
          {
            sys_id: "fedcba9876543210fedcba9876543210",
            name: "Feature Work",
            state: "in progress",
            sys_updated_on: "2026-03-10 09:00:00",
          },
        ],
      },
      headers: {},
    });

    const result = (await handlers.change_update_set({
      identifier: "Feature Work",
    })) as any;

    expect(result.success).toBe(false);
    expect(result.error.code).toBe("AMBIGUOUS_MATCH");
    expect(result.error.details.matches).toHaveLength(2);
    expect(snClient.patch).not.toHaveBeenCalled();
    expect(snClient.post).not.toHaveBeenCalled();
  });

  it("patches existing user preference when changing update set by sys_id", async () => {
    const { handlers, snClient } = setup();
    const targetId = "0123456789abcdef0123456789abcdef";

    snClient.get
      .mockResolvedValueOnce({
        data: {
          result: [
            {
              sys_id: targetId,
              name: "Feature A",
              state: "in progress",
              application: "x_app",
            },
          ],
        },
        headers: {},
      })
      .mockResolvedValueOnce({
        data: {
          result: [
            {
              sys_id: "pref-1",
              name: "sys_update_set",
              user: userSysId,
              value: "old-id",
            },
          ],
        },
        headers: {},
      });
    snClient.patch.mockResolvedValue({ data: { result: {} }, headers: {} });

    const result = (await handlers.change_update_set({
      identifier: targetId,
    })) as any;

    expect(snClient.get).toHaveBeenNthCalledWith(
      1,
      "/api/now/table/sys_update_set",
      {
        params: {
          sysparm_query: `sys_id=${targetId}^state=in progress`,
          sysparm_limit: 1,
          sysparm_fields: "sys_id,name,state,application,sys_updated_on",
        },
      }
    );
    expect(snClient.patch).toHaveBeenCalledWith(
      "/api/now/table/sys_user_preference/pref-1",
      { value: targetId }
    );
    expect(result.success).toBe(true);
    expect(result.data.current_update_set.sys_id).toBe(targetId);
  });

  it("creates user preference when none exists", async () => {
    const { handlers, snClient } = setup();

    snClient.get
      .mockResolvedValueOnce({
        data: {
          result: [
            {
              sys_id: "fedcba9876543210fedcba9876543210",
              name: "Unique Update Set",
              state: "in progress",
              application: "x_app",
            },
          ],
        },
        headers: {},
      })
      .mockResolvedValueOnce({ data: { result: [] }, headers: {} });
    snClient.post.mockResolvedValue({ data: { result: {} }, headers: {} });

    await handlers.change_update_set({ identifier: "Unique Update Set" });

    expect(snClient.post).toHaveBeenCalledWith(
      "/api/now/table/sys_user_preference",
      {
        name: "sys_update_set",
        user: userSysId,
        value: "fedcba9876543210fedcba9876543210",
        type: "string",
      }
    );
  });

  it("does not set preference when create_update_set set_as_current is false", async () => {
    const { handlers, snClient } = setup();

    snClient.post.mockResolvedValueOnce({
      data: {
        result: {
          sys_id: "newset1234567890abcdef1234567890ab",
          name: "New Set",
          state: "in progress",
        },
      },
      headers: {},
    });

    const result = (await handlers.create_update_set({
      name: "New Set",
      description: "desc",
      set_as_current: false,
    })) as any;

    expect(snClient.get).not.toHaveBeenCalled();
    expect(snClient.patch).not.toHaveBeenCalled();
    expect(result).toEqual({
      success: true,
      data: {
        update_set: {
          sys_id: "newset1234567890abcdef1234567890ab",
          name: "New Set",
          state: "in progress",
          self_link: "https://example.service-now.com/sys_update_set.do?sys_id=newset1234567890abcdef1234567890ab",
        },
        set_as_current: false,
      },
    });
  });

  it("updates existing preference when create_update_set set_as_current is true", async () => {
    const { handlers, snClient } = setup();
    const newSetId = "0123456789abcdef0123456789abcdef";

    snClient.post.mockResolvedValueOnce({
      data: {
        result: {
          sys_id: newSetId,
          name: "Current Set",
          state: "in progress",
        },
      },
      headers: {},
    });
    snClient.get.mockResolvedValueOnce({
      data: {
        result: [
          {
            sys_id: "pref-99",
            name: "sys_update_set",
            user: userSysId,
            value: "old-value",
          },
        ],
      },
      headers: {},
    });
    snClient.patch.mockResolvedValueOnce({ data: { result: {} }, headers: {} });

    const result = (await handlers.create_update_set({
      name: "Current Set",
      set_as_current: true,
    })) as any;

    expect(snClient.patch).toHaveBeenCalledWith(
      "/api/now/table/sys_user_preference/pref-99",
      { value: newSetId }
    );
    expect(result.data.set_as_current).toBe(true);
  });
});

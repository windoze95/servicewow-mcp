import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext, WrapHandler } from "./registry.js";
import { buildRecordUrl, refSysId } from "./registry.js";
import type {
  ServiceNowListResponse,
  ServiceNowSingleResponse,
} from "../servicenow/types.js";
import { sanitizeValue } from "../servicenow/queryBuilder.js";
import { validateSysId } from "../utils/validators.js";

// On-Call Scheduling (com.snc.on_call_rotation) data model. A group's on-call
// setup hangs off cmn_rota ("Shift" in the UI): each rota belongs to a group,
// points at a coverage schedule (cmn_schedule), and owns ordered rosters
// (cmn_rota_roster) whose ordered members are cmn_rota_member rows. Member
// rotation calendars are themselves cmn_schedule records (the member's
// `rotation_schedule` reference) whose spans — plus overrides/time-off — live
// in roster_schedule_span (extends cmn_schedule_span, adds a `roster` ref).
// Escalation policy for the 2024 schedule engine lives in
// cmn_rota_escalation_set (joined to the shift via its `cmn_rota` field) with
// ordered cmn_rota_esc_step_def steps; contact methods are
// cmn_rota_contact_preference + on_call_communication_type, and per-group
// settings are on_call_group_preference.
const ROTA_TABLE = "cmn_rota";
const ROSTER_TABLE = "cmn_rota_roster";
const MEMBER_TABLE = "cmn_rota_member";
const ROSTER_SPAN_TABLE = "roster_schedule_span";
const SCHEDULE_TABLE = "cmn_schedule";
const SCHEDULE_SPAN_TABLE = "cmn_schedule_span";
const OTHER_SCHEDULE_TABLE = "cmn_other_schedule";
const ESCALATION_SET_TABLE = "cmn_rota_escalation_set";
const ESCALATION_STEP_TABLE = "cmn_rota_esc_step_def";
const CONTACT_PREFERENCE_TABLE = "cmn_rota_contact_preference";
const COMMUNICATION_TYPE_TABLE = "on_call_communication_type";
const GROUP_PREFERENCE_TABLE = "on_call_group_preference";
const NOTIF_DEVICE_TABLE = "cmn_notif_device";
const WHO_IS_ON_CALL_VIEW = "v_on_call";
// On-Call trigger rules: launch a paging/assignment workflow when a task-table
// condition matches (the wiring between e.g. major incidents and on-call).
const TRIGGER_RULE_TABLE = "trigger_rule";
// Notify (Twilio) provisioned phone numbers used for voice/SMS paging.
const NOTIFY_NUMBER_TABLE = "notify_number";

const ROTA_SUMMARY_FIELDS = [
  "sys_id",
  "name",
  "group",
  "active",
  "schedule",
  "schedule_engine",
  "coverage_interval",
  "coverage_lead_type",
  "send_reminders",
  "reminder_lead_time",
  "use_custom_escalation",
  "catch_all",
  "catch_all_member",
  "catch_all_roster",
  "catch_all_wait_time",
  "override_user_contact_preference",
  "sys_updated_on",
].join(",");

const MEMBER_FIELDS = [
  "sys_id",
  "roster",
  "member",
  "order",
  "from",
  "to",
  "rotation_schedule",
].join(",");

const NOTIF_DEVICE_FIELDS = [
  "sys_id",
  "name",
  "type",
  "user",
  "email_address",
  "phone_number",
  "service_provider",
  "active",
  "primary_email",
  "order",
  "schedule",
  "push_app",
].join(",");

const TRIGGER_RULE_FIELDS = [
  "sys_id",
  "name",
  "table",
  "condition",
  "group",
  "user",
  "active",
  "order",
  "trigger_action",
  "trigger_when",
  "trigger_workflow",
  "description",
  "sys_updated_on",
].join(",");

const NOTIFY_NUMBER_FIELDS = [
  "sys_id",
  "name",
  "label",
  "number",
  "phone_number",
  "short_code",
  "active",
  "notify_group",
  "owner",
  "has_sms_in",
  "has_sms_out",
  "has_voice_in",
  "has_voice_out",
  "sys_updated_on",
].join(",");

interface SysIdRecord {
  sys_id: string;
  [key: string]: unknown;
}

// In sysparm_display_value=all responses even sys_id arrives as a
// {value, display_value} pair, so unwrap it (refSysId) before building the
// UI link.
function withSelfLink(
  ctx: ToolContext,
  table: string,
  record: SysIdRecord
): SysIdRecord & { self_link: string } {
  return {
    ...record,
    self_link: buildRecordUrl(ctx.instanceUrl, table, refSysId(record.sys_id)),
  };
}

function listMetadata(
  headers: Record<string, string>,
  returned: number
): { total_count: number; returned_count: number; truncated: boolean } {
  const totalCount = parseInt(headers["x-total-count"] || "0", 10);
  return {
    total_count: totalCount,
    returned_count: returned,
    truncated: totalCount > returned,
  };
}

function invalidSysId(field: string): {
  success: false;
  error: { code: string; message: string };
} {
  return {
    success: false,
    error: {
      code: "VALIDATION_ERROR",
      message: `${field} must be a 32-character sys_id`,
    },
  };
}

export function registerOnCallTools(
  server: McpServer,
  wrapHandler: WrapHandler
): void {
  // search_on_call_shifts
  server.tool(
    "search_on_call_shifts",
    "Search on-call shifts (cmn_rota — labeled 'Shift' in the UI), the root record of a group's on-call configuration. Filter by group, name, or active flag. Each row summarizes the shift's coverage schedule reference, schedule engine, reminder settings, whether custom escalation is enabled, and its catch-all configuration. Use get_on_call_shift to expand a shift into its rosters and ordered members, and get_on_call_escalation_policy for its escalation design.",
    {
      group: z
        .string()
        .optional()
        .describe("Filter by owning group sys_id (32 hex chars)"),
      name: z
        .string()
        .optional()
        .describe("Filter by shift name (LIKE match)"),
      active: z.boolean().optional().describe("Filter by active flag"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum results"),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Result offset for pagination"),
    },
    wrapHandler("search_on_call_shifts",
      async (
        ctx: ToolContext,
        args: {
          group?: string;
          name?: string;
          active?: boolean;
          limit: number;
          offset: number;
        }
      ) => {
        const queryParts: string[] = [];

        if (args.group) {
          if (!validateSysId(args.group)) {
            return invalidSysId("group");
          }
          queryParts.push(`group=${args.group}`);
        }
        if (args.name) {
          queryParts.push(`nameLIKE${sanitizeValue(args.name)}`);
        }
        if (typeof args.active === "boolean") {
          queryParts.push(`active=${args.active ? "true" : "false"}`);
        }

        queryParts.push("ORDERBYgroup^ORDERBYname");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<SysIdRecord>
        >(`/api/now/table/${ROTA_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields: ROTA_SUMMARY_FIELDS,
          },
        });

        return {
          success: true,
          data: data.result.map((r) => withSelfLink(ctx, ROTA_TABLE, r)),
          metadata: {
            total_count: parseInt(headers["x-total-count"] || "0", 10),
            returned_count: data.result.length,
            offset: args.offset,
          },
        };
      }
    )
  );

  // get_on_call_shift
  server.tool(
    "get_on_call_shift",
    "Get one on-call shift (cmn_rota) by sys_id, expanded into its full rotation structure: the shift record (all fields, including catch-all and reminder settings), its rosters (cmn_rota_roster, in escalation order, with rotation interval/start and the 2024-engine rotation_payload), each roster's ordered members (cmn_rota_member, with their from/to dates and rotation_schedule reference), and any roster schedule spans (roster_schedule_span — where member rotation spans, overrides, and time-off live). Members and spans are fetched with a single dot-walked query each (roster.rota=<sys_id>), so the call stays at four API requests regardless of roster count. NOTE: an empty spans list can mean none exist OR that ACLs hide them from the calling user.",
    {
      sys_id: z
        .string()
        .describe("Shift sys_id (cmn_rota, 32 hex chars)"),
      member_limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(200)
        .describe("Maximum member rows to return across all rosters"),
      span_limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(200)
        .describe(
          "Maximum roster schedule span rows (rotations/overrides/time-off) to return"
        ),
    },
    wrapHandler("get_on_call_shift",
      async (
        ctx: ToolContext,
        args: { sys_id: string; member_limit: number; span_limit: number }
      ) => {
        if (!validateSysId(args.sys_id)) {
          return invalidSysId("sys_id");
        }

        // sysparm_display_value=all overrides the client's `true` default so
        // reference fields carry BOTH the sys_id (needed to group children
        // under their roster) and the display name (needed by humans reading
        // a migration inventory). In plain `true` mode the value key is absent
        // and grouping would silently fail.
        const { data: rotaData } = await ctx.snClient.get<
          ServiceNowSingleResponse<SysIdRecord>
        >(`/api/now/table/${ROTA_TABLE}/${args.sys_id}`, {
          params: { sysparm_display_value: "all" },
        });

        const { data: rosterData, headers: rosterHeaders } =
          await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
            `/api/now/table/${ROSTER_TABLE}`,
            {
              params: {
                sysparm_query: `rota=${args.sys_id}^ORDERBYorder`,
                sysparm_limit: 100,
                sysparm_display_value: "all",
              },
            }
          );

        const { data: memberData, headers: memberHeaders } =
          await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
            `/api/now/table/${MEMBER_TABLE}`,
            {
              params: {
                sysparm_query: `roster.rota=${args.sys_id}^ORDERBYroster^ORDERBYorder`,
                sysparm_limit: args.member_limit,
                sysparm_fields: MEMBER_FIELDS,
                sysparm_display_value: "all",
              },
            }
          );

        const { data: spanData, headers: spanHeaders } =
          await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
            `/api/now/table/${ROSTER_SPAN_TABLE}`,
            {
              params: {
                sysparm_query: `roster.rota=${args.sys_id}^ORDERBYroster^ORDERBYstart_date_time`,
                sysparm_limit: args.span_limit,
                sysparm_display_value: "all",
              },
            }
          );

        const membersByRoster = new Map<string, SysIdRecord[]>();
        for (const member of memberData.result) {
          const rosterId = refSysId(member.roster);
          const bucket = membersByRoster.get(rosterId) ?? [];
          bucket.push(withSelfLink(ctx, MEMBER_TABLE, member));
          membersByRoster.set(rosterId, bucket);
        }

        const spansByRoster = new Map<string, SysIdRecord[]>();
        for (const span of spanData.result) {
          const rosterId = refSysId(span.roster);
          const bucket = spansByRoster.get(rosterId) ?? [];
          bucket.push(withSelfLink(ctx, ROSTER_SPAN_TABLE, span));
          spansByRoster.set(rosterId, bucket);
        }

        const rosters = rosterData.result.map((roster) => {
          const rosterId = refSysId(roster.sys_id);
          return {
            ...withSelfLink(ctx, ROSTER_TABLE, roster),
            members: membersByRoster.get(rosterId) ?? [],
            schedule_spans: spansByRoster.get(rosterId) ?? [],
          };
        });

        return {
          success: true,
          data: {
            shift: withSelfLink(ctx, ROTA_TABLE, rotaData.result),
            rosters,
            metadata: {
              rosters: listMetadata(rosterHeaders, rosterData.result.length),
              members: listMetadata(memberHeaders, memberData.result.length),
              schedule_spans: listMetadata(
                spanHeaders,
                spanData.result.length
              ),
            },
          },
        };
      }
    )
  );

  // get_on_call_schedule
  server.tool(
    "get_on_call_schedule",
    "Get a schedule (cmn_schedule) by sys_id with its entries (cmn_schedule_span: coverage windows with days_of_week, repeat pattern, all_day flag, start/end date-times) and any linked child/excluded schedules (cmn_other_schedule — how holiday calendars are attached). Works for any cmn_schedule: a shift's coverage schedule (cmn_rota.schedule), a member's rotation_schedule, or a standalone business/holiday schedule. Span queries hit the cmn_schedule_span parent table, so extended roster_schedule_span rows are included. Schedules carry a time_zone — flag it when mapping to single-timezone targets.",
    {
      sys_id: z
        .string()
        .describe("Schedule sys_id (cmn_schedule, 32 hex chars)"),
      span_limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(100)
        .describe("Maximum schedule entries to return"),
    },
    wrapHandler("get_on_call_schedule",
      async (ctx: ToolContext, args: { sys_id: string; span_limit: number }) => {
        if (!validateSysId(args.sys_id)) {
          return invalidSysId("sys_id");
        }

        // display=all gives every span both raw values (machine-usable
        // date-times for migration) and display values (human-readable).
        const { data: scheduleData } = await ctx.snClient.get<
          ServiceNowSingleResponse<SysIdRecord>
        >(`/api/now/table/${SCHEDULE_TABLE}/${args.sys_id}`, {
          params: { sysparm_display_value: "all" },
        });

        const { data: spanData, headers: spanHeaders } =
          await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
            `/api/now/table/${SCHEDULE_SPAN_TABLE}`,
            {
              params: {
                sysparm_query: `schedule=${args.sys_id}^ORDERBYstart_date_time`,
                sysparm_limit: args.span_limit,
                sysparm_display_value: "all",
              },
            }
          );

        const { data: childData, headers: childHeaders } =
          await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
            `/api/now/table/${OTHER_SCHEDULE_TABLE}`,
            {
              params: {
                sysparm_query: `schedule=${args.sys_id}`,
                sysparm_limit: 50,
                sysparm_display_value: "all",
              },
            }
          );

        return {
          success: true,
          data: {
            schedule: withSelfLink(ctx, SCHEDULE_TABLE, scheduleData.result),
            spans: spanData.result.map((s) =>
              withSelfLink(ctx, SCHEDULE_SPAN_TABLE, s)
            ),
            child_schedules: childData.result.map((c) =>
              withSelfLink(ctx, OTHER_SCHEDULE_TABLE, c)
            ),
            metadata: {
              spans: listMetadata(spanHeaders, spanData.result.length),
              child_schedules: listMetadata(
                childHeaders,
                childData.result.length
              ),
            },
          },
        };
      }
    )
  );

  // get_on_call_escalation_policy
  server.tool(
    "get_on_call_escalation_policy",
    "Get the complete escalation design for one on-call shift (cmn_rota) by sys_id: the shift's own catch-all/escalation fields, its escalation sets (cmn_rota_escalation_set, ordered, with conditions — the 2024 schedule engine's policy container), each set's ordered steps (cmn_rota_esc_step_def: escalation_level, time_to_next_step, reminders, target rosters/members, group-manager targeting, forced communication channel), the shift's and sets' contact preferences (cmn_rota_contact_preference), the group-level on-call preferences (on_call_group_preference for the shift's group), and the instance's communication types (on_call_communication_type) that steps and preferences reference. This is the full 'who gets paged, how, and after what delay' picture for migration or audit.",
    {
      sys_id: z
        .string()
        .describe("Shift sys_id (cmn_rota, 32 hex chars)"),
    },
    wrapHandler("get_on_call_escalation_policy",
      async (ctx: ToolContext, args: { sys_id: string }) => {
        if (!validateSysId(args.sys_id)) {
          return invalidSysId("sys_id");
        }

        // display=all so references carry sys_id + display name (see
        // get_on_call_shift); the sys_id is required to resolve the shift's
        // group and to group steps under their escalation set.
        const { data: rotaData } = await ctx.snClient.get<
          ServiceNowSingleResponse<SysIdRecord>
        >(`/api/now/table/${ROTA_TABLE}/${args.sys_id}`, {
          params: {
            sysparm_fields: ROTA_SUMMARY_FIELDS,
            sysparm_display_value: "all",
          },
        });

        const { data: setData, headers: setHeaders } = await ctx.snClient.get<
          ServiceNowListResponse<SysIdRecord>
        >(`/api/now/table/${ESCALATION_SET_TABLE}`, {
          params: {
            sysparm_query: `cmn_rota=${args.sys_id}^ORDERBYorder`,
            sysparm_limit: 50,
            sysparm_display_value: "all",
          },
        });

        const { data: stepData, headers: stepHeaders } =
          await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
            `/api/now/table/${ESCALATION_STEP_TABLE}`,
            {
              params: {
                sysparm_query: `escalation_set.cmn_rota=${args.sys_id}^ORDERBYescalation_set^ORDERBYescalation_level`,
                sysparm_limit: 200,
                sysparm_display_value: "all",
              },
            }
          );

        // Contact preferences attach either to the shift directly or to one of
        // its escalation sets; the contiguous ^OR run keeps this a single query.
        const { data: prefData, headers: prefHeaders } =
          await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
            `/api/now/table/${CONTACT_PREFERENCE_TABLE}`,
            {
              params: {
                sysparm_query: `cmn_rota=${args.sys_id}^ORcmn_rota_escalation_set.cmn_rota=${args.sys_id}`,
                sysparm_limit: 100,
                sysparm_display_value: "all",
              },
            }
          );

        // The shift's group drives group-level preferences.
        const groupSysId = refSysId(rotaData.result.group);

        let groupPreferences: SysIdRecord[] = [];
        let groupPrefMetadata = {
          total_count: 0,
          returned_count: 0,
          truncated: false,
        };
        if (validateSysId(groupSysId)) {
          const { data: groupPrefData, headers: groupPrefHeaders } =
            await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
              `/api/now/table/${GROUP_PREFERENCE_TABLE}`,
              {
                params: {
                  sysparm_query: `group=${groupSysId}`,
                  sysparm_limit: 10,
                  sysparm_display_value: "all",
                },
              }
            );
          groupPreferences = groupPrefData.result.map((p) =>
            withSelfLink(ctx, GROUP_PREFERENCE_TABLE, p)
          );
          groupPrefMetadata = listMetadata(
            groupPrefHeaders,
            groupPrefData.result.length
          );
        }

        const { data: commData, headers: commHeaders } =
          await ctx.snClient.get<ServiceNowListResponse<SysIdRecord>>(
            `/api/now/table/${COMMUNICATION_TYPE_TABLE}`,
            {
              params: {
                sysparm_query: "ORDERBYname",
                sysparm_limit: 50,
                sysparm_display_value: "all",
              },
            }
          );

        const stepsBySet = new Map<string, SysIdRecord[]>();
        for (const step of stepData.result) {
          const setId = refSysId(step.escalation_set);
          const bucket = stepsBySet.get(setId) ?? [];
          bucket.push(withSelfLink(ctx, ESCALATION_STEP_TABLE, step));
          stepsBySet.set(setId, bucket);
        }

        const escalationSets = setData.result.map((set) => ({
          ...withSelfLink(ctx, ESCALATION_SET_TABLE, set),
          steps: stepsBySet.get(refSysId(set.sys_id)) ?? [],
        }));

        return {
          success: true,
          data: {
            shift: withSelfLink(ctx, ROTA_TABLE, rotaData.result),
            escalation_sets: escalationSets,
            contact_preferences: prefData.result.map((p) =>
              withSelfLink(ctx, CONTACT_PREFERENCE_TABLE, p)
            ),
            group_preferences: groupPreferences,
            communication_types: commData.result.map((c) =>
              withSelfLink(ctx, COMMUNICATION_TYPE_TABLE, c)
            ),
            metadata: {
              escalation_sets: listMetadata(
                setHeaders,
                setData.result.length
              ),
              escalation_steps: listMetadata(
                stepHeaders,
                stepData.result.length
              ),
              contact_preferences: listMetadata(
                prefHeaders,
                prefData.result.length
              ),
              group_preferences: groupPrefMetadata,
              communication_types: listMetadata(
                commHeaders,
                commData.result.length
              ),
            },
          },
        };
      }
    )
  );

  // who_is_on_call
  server.tool(
    "who_is_on_call",
    "Read the current on-call assignments from the v_on_call database view (group / shift / roster / user rows for right now). Optionally filter to one group. CAVEAT: v_on_call is an OOB view over the on-call tables and its visibility depends on the calling user's roles — an empty result can mean nobody is on call OR that ACLs hide the rows; the response metadata flags this ambiguity. For migration-grade config (schedules, rosters, escalation), use the config tools instead of this live view.",
    {
      group: z
        .string()
        .optional()
        .describe("Filter to one group sys_id (32 hex chars)"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50)
        .describe("Maximum rows"),
    },
    wrapHandler("who_is_on_call",
      async (ctx: ToolContext, args: { group?: string; limit: number }) => {
        const queryParts: string[] = [];
        if (args.group) {
          if (!validateSysId(args.group)) {
            return invalidSysId("group");
          }
          queryParts.push(`group=${args.group}`);
        }

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<SysIdRecord>
        >(`/api/now/table/${WHO_IS_ON_CALL_VIEW}`, {
          params: {
            ...(queryParts.length > 0
              ? { sysparm_query: queryParts.join("^") }
              : {}),
            sysparm_limit: args.limit,
          },
        });

        return {
          success: true,
          data: data.result,
          metadata: {
            total_count: parseInt(headers["x-total-count"] || "0", 10),
            returned_count: data.result.length,
            note:
              data.result.length === 0
                ? "Empty result: either no one is currently on call for this filter, or ACLs hide v_on_call rows from your user. Verify config via search_on_call_shifts before concluding coverage is absent."
                : undefined,
          },
        };
      }
    )
  );

  // get_user_notification_devices
  server.tool(
    "get_user_notification_devices",
    "List a user's notification devices (cmn_notif_device): email, SMS, and voice endpoints plus their service provider, active flag, primary-email marker, and any quiet-hours schedule. This is the per-user contact-method surface that on-call escalation steps and contact preferences deliver to — needed when migrating users to a target platform's per-user notification rules. Returns devices ordered by their configured order.",
    {
      user: z
        .string()
        .describe("User sys_id (32 hex chars)"),
      include_inactive: z
        .boolean()
        .default(false)
        .describe("Also include inactive devices"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50)
        .describe("Maximum devices to return"),
    },
    wrapHandler("get_user_notification_devices",
      async (
        ctx: ToolContext,
        args: { user: string; include_inactive: boolean; limit: number }
      ) => {
        if (!validateSysId(args.user)) {
          return invalidSysId("user");
        }

        const queryParts = [`user=${args.user}`];
        if (!args.include_inactive) {
          queryParts.push("active=true");
        }
        queryParts.push("ORDERBYorder");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<SysIdRecord>
        >(`/api/now/table/${NOTIF_DEVICE_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_fields: NOTIF_DEVICE_FIELDS,
          },
        });

        return {
          success: true,
          data: data.result.map((d) =>
            withSelfLink(ctx, NOTIF_DEVICE_TABLE, d)
          ),
          metadata: {
            total_count: parseInt(headers["x-total-count"] || "0", 10),
            returned_count: data.result.length,
          },
        };
      }
    )
  );

  // search_on_call_trigger_rules
  server.tool(
    "search_on_call_trigger_rules",
    "Search On-Call trigger rules (trigger_rule) — the records that launch an assignment/paging workflow when a condition on a task table matches (e.g. 'when incident major_incident_state becomes proposed, run the assign-by-acknowledgement workflow against a group'). This is where incident-driven paging is wired to on-call outside of business rules and flows. Each row carries the watched table and condition, the target group, the workflow it launches (trigger_workflow — expand it with get_workflow), and the trigger action/when settings. Responses use {value, display_value} pairs so the workflow and group references carry sys_ids.",
    {
      table: z
        .string()
        .optional()
        .describe("Filter by the watched table, e.g. 'incident'"),
      group: z
        .string()
        .optional()
        .describe("Filter by target group sys_id (32 hex chars)"),
      name: z
        .string()
        .optional()
        .describe("Filter by rule name (LIKE match)"),
      active: z.boolean().optional().describe("Filter by active flag"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum results"),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Result offset for pagination"),
    },
    wrapHandler("search_on_call_trigger_rules",
      async (
        ctx: ToolContext,
        args: {
          table?: string;
          group?: string;
          name?: string;
          active?: boolean;
          limit: number;
          offset: number;
        }
      ) => {
        const queryParts: string[] = [];

        if (args.table) {
          queryParts.push(`table=${sanitizeValue(args.table)}`);
        }
        if (args.group) {
          if (!validateSysId(args.group)) {
            return invalidSysId("group");
          }
          queryParts.push(`group=${args.group}`);
        }
        if (args.name) {
          queryParts.push(`nameLIKE${sanitizeValue(args.name)}`);
        }
        if (typeof args.active === "boolean") {
          queryParts.push(`active=${args.active ? "true" : "false"}`);
        }

        queryParts.push("ORDERBYDESCsys_updated_on");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<SysIdRecord>
        >(`/api/now/table/${TRIGGER_RULE_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_offset: args.offset,
            sysparm_fields: TRIGGER_RULE_FIELDS,
            sysparm_display_value: "all",
          },
        });

        return {
          success: true,
          data: data.result.map((r) =>
            withSelfLink(ctx, TRIGGER_RULE_TABLE, r)
          ),
          metadata: {
            total_count: parseInt(headers["x-total-count"] || "0", 10),
            returned_count: data.result.length,
            offset: args.offset,
          },
        };
      }
    )
  );

  // list_notify_numbers
  server.tool(
    "list_notify_numbers",
    "List Notify (Twilio) phone numbers (notify_number): the provisioned SMS/voice numbers used for telephony-based on-call paging, with their capabilities (SMS/voice in/out), active flag, owning group (notify_group — whose workflows handle inbound replies and outbound calls), and owner. Use this to establish whether telephony escalation is provisioned and switched on — an inactive number means voice/SMS paging steps in workflows will not deliver. Responses use {value, display_value} pairs.",
    {
      active: z.boolean().optional().describe("Filter by active flag"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(50)
        .describe("Maximum rows"),
    },
    wrapHandler("list_notify_numbers",
      async (ctx: ToolContext, args: { active?: boolean; limit: number }) => {
        const queryParts: string[] = [];
        if (typeof args.active === "boolean") {
          queryParts.push(`active=${args.active ? "true" : "false"}`);
        }
        queryParts.push("ORDERBYnumber");

        const { data, headers } = await ctx.snClient.get<
          ServiceNowListResponse<SysIdRecord>
        >(`/api/now/table/${NOTIFY_NUMBER_TABLE}`, {
          params: {
            sysparm_query: queryParts.join("^"),
            sysparm_limit: args.limit,
            sysparm_fields: NOTIFY_NUMBER_FIELDS,
            sysparm_display_value: "all",
          },
        });

        return {
          success: true,
          data: data.result.map((r) =>
            withSelfLink(ctx, NOTIFY_NUMBER_TABLE, r)
          ),
          metadata: {
            total_count: parseInt(headers["x-total-count"] || "0", 10),
            returned_count: data.result.length,
          },
        };
      }
    )
  );
}

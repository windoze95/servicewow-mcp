const SYS_ID_REGEX = /^[0-9a-fA-F]{32}$/;
const INCIDENT_NUMBER_REGEX = /^INC\d{7,}$/;
const CHANGE_NUMBER_REGEX = /^CHG\d{7,}$/;
const IO_VARIABLE_REGEX = /^IO:[0-9a-fA-F]{32}$/;
const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_SPACE_REGEX =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
// Require explicit timezone (Z or ±HH:MM/±HHMM); a bare local-time ISO would be
// parsed in the host's timezone and produce different query bounds across
// deployments.
const ISO_8601_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

export function validateSysId(value: string): boolean {
  return SYS_ID_REGEX.test(value);
}

export function validateIncidentNumber(value: string): boolean {
  return INCIDENT_NUMBER_REGEX.test(value);
}

export function validateChangeNumber(value: string): boolean {
  return CHANGE_NUMBER_REGEX.test(value);
}

export function validateIOVariable(value: string): boolean {
  return IO_VARIABLE_REGEX.test(value);
}

// `new Date(...)` silently normalizes calendar overflow (e.g. `2026-04-31`
// becomes May 1 instead of NaN), so reject components that don't round-trip
// through Date.UTC. Validate as UTC fields regardless of timezone — a date
// like April 31 is invalid in any zone.
function validateCalendarComponents(
  y: number,
  m: number,
  d: number,
  h: number,
  mi: number,
  s: number
): boolean {
  const date = new Date(Date.UTC(y, m - 1, d, h, mi, s));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d &&
    date.getUTCHours() === h &&
    date.getUTCMinutes() === mi &&
    date.getUTCSeconds() === s
  );
}

// ServiceNow encoded queries compare date/time fields as UTC strings of the form
// `YYYY-MM-DD HH:MM:SS`. Accept date-only and ISO 8601 inputs and normalize to
// that shape; for date-only inputs the boundary controls whether the time is
// pinned to 00:00:00 (from) or 23:59:59 (to) so a single calendar day at the
// upper bound is fully inclusive. ISO 8601 inputs must include a timezone (Z
// or ±HH:MM) so the resulting UTC bound is independent of the host timezone.
export function normalizeDateBoundary(
  value: string,
  boundary: "from" | "to"
): string | null {
  const dateOnly = DATE_ONLY_REGEX.exec(value);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    if (!validateCalendarComponents(+y, +m, +d, 0, 0, 0)) return null;
    return boundary === "from" ? `${value} 00:00:00` : `${value} 23:59:59`;
  }
  const spaceTime = DATE_TIME_SPACE_REGEX.exec(value);
  if (spaceTime) {
    const [, y, m, d, h, mi, s] = spaceTime;
    if (!validateCalendarComponents(+y, +m, +d, +h, +mi, +s)) return null;
    return value;
  }
  const iso = ISO_8601_REGEX.exec(value);
  if (iso) {
    const [, y, m, d, h, mi, s] = iso;
    // Validate the user-supplied calendar fields before letting Date apply the
    // offset; otherwise an overflow like 2026-04-31T08:30:00+05:00 would shift
    // silently to the next month.
    if (!validateCalendarComponents(+y, +m, +d, +h, +mi, +s)) return null;
    const ms = new Date(value).getTime();
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  }
  return null;
}

export function validateState(state: string): boolean {
  const validStates = [
    "New",
    "In Progress",
    "On Hold",
    "Resolved",
    "Closed",
    "Canceled",
    // Numeric equivalents
    "1", "2", "3", "6", "7", "8",
  ];
  return validStates.includes(state);
}

export const READONLY_FIELDS = new Set([
  "sys_id",
  "sys_created_on",
  "sys_created_by",
  "sys_updated_on",
  "sys_updated_by",
  "sys_mod_count",
  "sys_class_name",
  "sys_domain",
  "sys_domain_path",
  "number",
  "opened_at",
  "opened_by",
  // Identity fields — server-controlled at creation, must not be overwritten
  "caller_id",
  "requested_by",
  // Priority is calculated by ServiceNow from impact/urgency
  "priority",
]);

export function sanitizeUpdatePayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!READONLY_FIELDS.has(key)) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

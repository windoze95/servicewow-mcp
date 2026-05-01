const SYS_ID_REGEX = /^[0-9a-fA-F]{32}$/;
const INCIDENT_NUMBER_REGEX = /^INC\d{7,}$/;
const CHANGE_NUMBER_REGEX = /^CHG\d{7,}$/;
const IO_VARIABLE_REGEX = /^IO:[0-9a-fA-F]{32}$/;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_SPACE_REGEX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const ISO_8601_REGEX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

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

// ServiceNow encoded queries compare date/time fields as UTC strings of the form
// `YYYY-MM-DD HH:MM:SS`. Accept date-only and ISO 8601 inputs and normalize to
// that shape; for date-only inputs the boundary controls whether the time is
// pinned to 00:00:00 (from) or 23:59:59 (to) so a single calendar day at the
// upper bound is fully inclusive.
export function normalizeDateBoundary(
  value: string,
  boundary: "from" | "to"
): string | null {
  if (DATE_ONLY_REGEX.test(value)) {
    if (!Number.isFinite(new Date(`${value}T00:00:00Z`).getTime())) return null;
    return boundary === "from" ? `${value} 00:00:00` : `${value} 23:59:59`;
  }
  if (DATE_TIME_SPACE_REGEX.test(value)) {
    if (!Number.isFinite(new Date(`${value.replace(" ", "T")}Z`).getTime())) {
      return null;
    }
    return value;
  }
  if (ISO_8601_REGEX.test(value)) {
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

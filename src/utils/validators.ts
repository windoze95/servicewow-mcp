const SYS_ID_REGEX = /^[0-9a-fA-F]{32}$/;
const INCIDENT_NUMBER_REGEX = /^INC\d{7,}$/;
const CHANGE_NUMBER_REGEX = /^CHG\d{7,}$/;
const IO_VARIABLE_REGEX = /^IO:[0-9a-fA-F]{32}$/;

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

export function validatePriority(impact: number, urgency: number): number {
  if (impact < 1 || impact > 3 || urgency < 1 || urgency > 3) {
    throw new Error("Impact and urgency must be between 1 and 3");
  }
  return impact + urgency - 1;
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

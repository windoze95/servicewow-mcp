const FIELD_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

export type Operator =
  | "=" | "!=" | "LIKE" | "STARTSWITH" | "ENDSWITH"
  | ">" | ">=" | "<" | "<="
  | "IN" | "NOT IN"
  | "ISEMPTY" | "ISNOTEMPTY"
  | "CONTAINS" | "DOES NOT CONTAIN";

export interface QueryFilter {
  field: string;
  operator: Operator;
  value: string;
}

export function validateFieldName(field: string): boolean {
  return FIELD_NAME_REGEX.test(field);
}

export function sanitizeValue(value: string): string {
  // Escape characters that have special meaning in encoded queries
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\^/g, "\\^")
    .replace(/,/g, "\\,");
}

export function buildEncodedQuery(
  filters: QueryFilter[],
  orderBy?: OrderByClause
): string {
  const parts: string[] = [];

  for (const filter of filters) {
    if (!validateFieldName(filter.field)) {
      throw new Error(
        `Invalid field name: "${filter.field}". Only alphanumeric characters, underscores, and dots are allowed.`
      );
    }

    const sanitizedValue = sanitizeValue(filter.value);

    switch (filter.operator) {
      case "ISEMPTY":
        parts.push(`${filter.field}ISEMPTY`);
        break;
      case "ISNOTEMPTY":
        parts.push(`${filter.field}ISNOTEMPTY`);
        break;
      default:
        parts.push(`${filter.field}${filter.operator}${sanitizedValue}`);
        break;
    }
  }

  const base = parts.join("^");
  if (!orderBy) return base;
  const clause = orderBy.direction === "DESC"
    ? `ORDERBYDESC${orderBy.field}`
    : `ORDERBY${orderBy.field}`;
  return base ? `${base}^${clause}` : clause;
}

export function buildSimpleQuery(
  conditions: Record<string, string>
): string {
  const filters: QueryFilter[] = Object.entries(conditions).map(
    ([field, value]) => ({
      field,
      operator: "=" as Operator,
      value,
    })
  );
  return buildEncodedQuery(filters);
}

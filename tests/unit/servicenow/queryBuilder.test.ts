import { describe, it, expect } from "vitest";
import {
  buildEncodedQuery,
  buildSimpleQuery,
  validateFieldName,
  type QueryFilter,
} from "../../../src/servicenow/queryBuilder.js";

describe("queryBuilder", () => {
  describe("validateFieldName", () => {
    it("should accept valid field names", () => {
      expect(validateFieldName("short_description")).toBe(true);
      expect(validateFieldName("sys_id")).toBe(true);
      expect(validateFieldName("assignment_group")).toBe(true);
      expect(validateFieldName("caller_id.name")).toBe(true);
    });

    it("should reject invalid field names", () => {
      expect(validateFieldName("")).toBe(false);
      expect(validateFieldName("field^name")).toBe(false);
      expect(validateFieldName("field=value")).toBe(false);
      expect(validateFieldName("123field")).toBe(false);
      expect(validateFieldName("field name")).toBe(false);
    });
  });

  describe("buildEncodedQuery", () => {
    it("should build simple equality filters", () => {
      const filters: QueryFilter[] = [
        { field: "state", operator: "=", value: "1" },
        { field: "priority", operator: "=", value: "2" },
      ];

      expect(buildEncodedQuery(filters)).toBe("state=1^priority=2");
    });

    it("should handle LIKE operator", () => {
      const filters: QueryFilter[] = [
        { field: "short_description", operator: "LIKE", value: "network" },
      ];

      expect(buildEncodedQuery(filters)).toBe(
        "short_descriptionLIKEnetwork"
      );
    });

    it("should handle ISEMPTY/ISNOTEMPTY", () => {
      const filters: QueryFilter[] = [
        { field: "assigned_to", operator: "ISNOTEMPTY", value: "" },
      ];

      expect(buildEncodedQuery(filters)).toBe("assigned_toISNOTEMPTY");
    });

    it("should sanitize special characters in values", () => {
      const filters: QueryFilter[] = [
        { field: "short_description", operator: "=", value: "test^value,with=special" },
      ];

      const result = buildEncodedQuery(filters);
      expect(result).toBe("short_description=test\\^value\\,with=special");
    });

    it("should reject invalid field names", () => {
      const filters: QueryFilter[] = [
        { field: "bad^field", operator: "=", value: "test" },
      ];

      expect(() => buildEncodedQuery(filters)).toThrow("Invalid field name");
    });
  });

  describe("buildSimpleQuery", () => {
    it("should build from key-value pairs", () => {
      const result = buildSimpleQuery({
        state: "1",
        active: "true",
      });

      expect(result).toBe("state=1^active=true");
    });
  });
});

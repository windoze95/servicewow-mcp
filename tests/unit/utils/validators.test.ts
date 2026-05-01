import { describe, it, expect } from "vitest";
import {
  validateSysId,
  validateIncidentNumber,
  validateChangeNumber,
  validateIOVariable,
  validateState,
  sanitizeUpdatePayload,
  normalizeDateBoundary,
  READONLY_FIELDS,
} from "../../../src/utils/validators.js";

describe("validators", () => {
  describe("validateSysId", () => {
    it("should accept valid sys_ids", () => {
      expect(validateSysId("abc123def456abc123def456abc12345")).toBe(true);
      expect(validateSysId("0123456789abcdef0123456789abcdef")).toBe(true);
      expect(validateSysId("ABCDEF0123456789abcdef0123456789")).toBe(true);
    });

    it("should reject invalid sys_ids", () => {
      expect(validateSysId("")).toBe(false);
      expect(validateSysId("too_short")).toBe(false);
      expect(validateSysId("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz")).toBe(false);
      expect(validateSysId("abc123def456abc123def456abc1234")).toBe(false); // 31 chars
      expect(validateSysId("abc123def456abc123def456abc123456")).toBe(false); // 33 chars
    });
  });

  describe("validateIncidentNumber", () => {
    it("should accept valid incident numbers", () => {
      expect(validateIncidentNumber("INC0012345")).toBe(true);
      expect(validateIncidentNumber("INC0000001")).toBe(true);
      expect(validateIncidentNumber("INC12345678")).toBe(true);
    });

    it("should reject invalid incident numbers", () => {
      expect(validateIncidentNumber("")).toBe(false);
      expect(validateIncidentNumber("INC")).toBe(false);
      expect(validateIncidentNumber("INC123")).toBe(false); // too few digits
      expect(validateIncidentNumber("CHG0012345")).toBe(false);
      expect(validateIncidentNumber("inc0012345")).toBe(false); // lowercase
    });
  });

  describe("validateChangeNumber", () => {
    it("should accept valid change numbers", () => {
      expect(validateChangeNumber("CHG0012345")).toBe(true);
      expect(validateChangeNumber("CHG0000001")).toBe(true);
      expect(validateChangeNumber("CHG12345678")).toBe(true);
    });

    it("should reject invalid change numbers", () => {
      expect(validateChangeNumber("")).toBe(false);
      expect(validateChangeNumber("CHG")).toBe(false);
      expect(validateChangeNumber("CHG123")).toBe(false);
      expect(validateChangeNumber("INC0012345")).toBe(false);
      expect(validateChangeNumber("chg0012345")).toBe(false);
    });
  });

  describe("validateIOVariable", () => {
    it("should accept valid IO:{sys_id} format", () => {
      expect(validateIOVariable("IO:0123456789abcdef0123456789abcdef")).toBe(true);
      expect(validateIOVariable("IO:ABCDEF0123456789abcdef0123456789")).toBe(true);
    });

    it("should reject invalid IO variable formats", () => {
      expect(validateIOVariable("")).toBe(false);
      expect(validateIOVariable("priority")).toBe(false);
      expect(validateIOVariable("IO:abc123")).toBe(false);
      expect(validateIOVariable("io:0123456789abcdef0123456789abcdef")).toBe(false);
      expect(validateIOVariable("0123456789abcdef0123456789abcdef")).toBe(false);
      expect(validateIOVariable("IO:")).toBe(false);
    });
  });

  describe("validateState", () => {
    it("should accept valid states", () => {
      expect(validateState("New")).toBe(true);
      expect(validateState("In Progress")).toBe(true);
      expect(validateState("Resolved")).toBe(true);
      expect(validateState("1")).toBe(true);
      expect(validateState("2")).toBe(true);
    });

    it("should reject invalid states", () => {
      expect(validateState("")).toBe(false);
      expect(validateState("invalid")).toBe(false);
      expect(validateState("0")).toBe(false);
    });
  });

  describe("sanitizeUpdatePayload", () => {
    it("should strip readonly fields", () => {
      const payload = {
        sys_id: "should_be_removed",
        sys_created_on: "removed",
        number: "removed",
        short_description: "kept",
        state: "kept",
      };

      const sanitized = sanitizeUpdatePayload(payload);
      expect(sanitized).toEqual({
        short_description: "kept",
        state: "kept",
      });
    });

    it("should strip identity fields (caller_id, requested_by)", () => {
      const payload = {
        caller_id: "attacker_sys_id",
        requested_by: "attacker_sys_id",
        short_description: "kept",
      };

      const sanitized = sanitizeUpdatePayload(payload);
      expect(sanitized).toEqual({
        short_description: "kept",
      });
    });

    it("should pass through non-readonly fields", () => {
      const payload = {
        short_description: "update me",
        assignment_group: "new group",
        comments: "a comment",
      };

      const sanitized = sanitizeUpdatePayload(payload);
      expect(sanitized).toEqual(payload);
    });
  });

  describe("normalizeDateBoundary", () => {
    it("expands date-only inputs to start- or end-of-day", () => {
      expect(normalizeDateBoundary("2026-04-01", "from")).toBe("2026-04-01 00:00:00");
      expect(normalizeDateBoundary("2026-04-30", "to")).toBe("2026-04-30 23:59:59");
    });

    it("returns space-separated datetimes unchanged", () => {
      expect(normalizeDateBoundary("2026-04-01 08:30:00", "from")).toBe(
        "2026-04-01 08:30:00"
      );
    });

    it("normalizes ISO 8601 inputs to YYYY-MM-DD HH:MM:SS in UTC", () => {
      expect(normalizeDateBoundary("2026-04-01T08:30:00Z", "from")).toBe(
        "2026-04-01 08:30:00"
      );
      // +05:00 offset → UTC is 5 hours earlier
      expect(normalizeDateBoundary("2026-04-01T08:30:00+05:00", "from")).toBe(
        "2026-04-01 03:30:00"
      );
      // Compact offset form ±HHMM
      expect(normalizeDateBoundary("2026-04-01T08:30:00-0400", "from")).toBe(
        "2026-04-01 12:30:00"
      );
    });

    it("accepts a real leap-year date (2024-02-29)", () => {
      expect(normalizeDateBoundary("2024-02-29", "from")).toBe(
        "2024-02-29 00:00:00"
      );
    });

    it("rejects malformed inputs", () => {
      expect(normalizeDateBoundary("", "from")).toBeNull();
      expect(normalizeDateBoundary("not-a-date", "from")).toBeNull();
      expect(normalizeDateBoundary("2026/04/01", "from")).toBeNull();
      expect(normalizeDateBoundary("2026-13-01", "from")).toBeNull(); // bad month
      expect(normalizeDateBoundary("2026-04-32", "from")).toBeNull(); // bad day
      expect(normalizeDateBoundary("2026-04-01 25:00:00", "from")).toBeNull(); // bad hour
    });

    it("rejects calendar-overflow dates that Date silently normalizes", () => {
      // April has 30 days; new Date('2026-04-31...') would roll to May 1.
      expect(normalizeDateBoundary("2026-04-31", "from")).toBeNull();
      expect(normalizeDateBoundary("2026-04-31 00:00:00", "from")).toBeNull();
      expect(normalizeDateBoundary("2026-04-31T00:00:00Z", "from")).toBeNull();
      // Feb 30 never exists.
      expect(normalizeDateBoundary("2026-02-30", "from")).toBeNull();
      // 2025 is not a leap year.
      expect(normalizeDateBoundary("2025-02-29", "from")).toBeNull();
      // Overflow in an offset-bearing ISO must be rejected before the offset
      // shift is applied.
      expect(normalizeDateBoundary("2026-04-31T08:30:00+05:00", "from")).toBeNull();
    });

    it("rejects ISO 8601 inputs without a timezone", () => {
      // A bare local-time ISO would be parsed in the host's timezone, making
      // results environment-dependent.
      expect(normalizeDateBoundary("2026-04-01T08:30:00", "from")).toBeNull();
      expect(normalizeDateBoundary("2026-04-01T08:30:00.123", "from")).toBeNull();
    });
  });
});

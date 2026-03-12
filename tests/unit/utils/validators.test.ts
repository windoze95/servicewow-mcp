import { describe, it, expect } from "vitest";
import {
  validateSysId,
  validateIncidentNumber,
  validateIOVariable,
  validateState,
  validatePriority,
  sanitizeUpdatePayload,
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

  describe("validatePriority", () => {
    it("should calculate priority correctly", () => {
      expect(validatePriority(1, 1)).toBe(1);
      expect(validatePriority(1, 2)).toBe(2);
      expect(validatePriority(2, 2)).toBe(3);
      expect(validatePriority(3, 3)).toBe(5);
    });

    it("should reject invalid ranges", () => {
      expect(() => validatePriority(0, 1)).toThrow();
      expect(() => validatePriority(1, 4)).toThrow();
      expect(() => validatePriority(4, 1)).toThrow();
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
});

import { v4 as uuidv4 } from "uuid";
import { logger } from "../utils/logger.js";

export interface ToolError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    reference_id: string;
  };
}

export type ErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_EXPIRED"
  | "INSUFFICIENT_PERMISSIONS"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "SN_UNAVAILABLE"
  | "UNEXPECTED_ERROR";

export function createToolError(
  code: ErrorCode,
  message: string,
  details?: unknown
): ToolError {
  const reference_id = uuidv4();
  return {
    success: false,
    error: { code, message, details, reference_id },
  };
}

export function mapServiceNowError(
  statusCode: number,
  responseBody?: unknown
): ToolError {
  switch (statusCode) {
    case 401:
      return createToolError(
        "AUTH_EXPIRED",
        "Your session has expired. Please re-authenticate."
      );
    case 403:
      return createToolError(
        "INSUFFICIENT_PERMISSIONS",
        "You don't have access to this resource. Contact your ServiceNow admin if this is unexpected."
      );
    case 404:
      return createToolError("NOT_FOUND", "The requested record was not found.");
    case 429:
      return createToolError(
        "RATE_LIMITED",
        "Rate limit exceeded. Please wait before retrying."
      );
    default:
      if (statusCode >= 500) {
        return createToolError(
          "SN_UNAVAILABLE",
          "ServiceNow is currently unavailable. Please try again shortly."
        );
      }
      return createToolError(
        "UNEXPECTED_ERROR",
        "An unexpected error occurred.",
        responseBody
      );
  }
}

export function handleToolError(err: unknown): ToolError {
  if (isServiceNowApiError(err)) {
    return mapServiceNowError(err.statusCode, err.responseBody);
  }

  if (err instanceof Error && err.name === "AuthRequiredError") {
    return createToolError(
      "AUTH_REQUIRED",
      "Please authenticate to use this tool."
    );
  }

  const reference_id = uuidv4();
  logger.error({ err, reference_id }, "Unexpected tool error");

  return {
    success: false,
    error: {
      code: "UNEXPECTED_ERROR",
      message: `An unexpected error occurred. Reference ID: ${reference_id}`,
      reference_id,
    },
  };
}

export interface ServiceNowApiError {
  statusCode: number;
  responseBody?: unknown;
}

function isServiceNowApiError(err: unknown): err is ServiceNowApiError {
  return (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    typeof (err as ServiceNowApiError).statusCode === "number"
  );
}

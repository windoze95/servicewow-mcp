import { logger } from "../utils/logger.js";
import type { ServiceNowApiError } from "./client.js";

export interface RetryOptions {
  maxRetries?: number; // default 3
  initialDelayMs?: number; // default 500
  maxDelayMs?: number; // default 30000
  backoffMultiplier?: number; // default 2
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNABORTED",
]);

function isRetryable(error: unknown): boolean {
  // Check ServiceNowApiError statusCode
  const snError = error as ServiceNowApiError;
  if (snError?.statusCode && RETRYABLE_STATUS_CODES.has(snError.statusCode)) {
    return true;
  }
  // Check network error codes
  const code = (error as { code?: string })?.code;
  if (code && RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }
  return false;
}

function calculateDelay(
  attempt: number,
  options: Required<RetryOptions>,
  retryAfterMs?: number
): number {
  const exponentialDelay =
    options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt);
  // Add 0-20% jitter, then clamp to the configured maximum delay.
  const jitter = exponentialDelay * (Math.random() * 0.2);
  const calculatedDelay = Math.min(exponentialDelay + jitter, options.maxDelayMs);
  // Honor Retry-After if present and larger
  if (retryAfterMs !== undefined && retryAfterMs > calculatedDelay) {
    return retryAfterMs;
  }
  return calculatedDelay;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts: Required<RetryOptions> = {
    maxRetries: options?.maxRetries ?? 3,
    initialDelayMs: options?.initialDelayMs ?? 500,
    maxDelayMs: options?.maxDelayMs ?? 30000,
    backoffMultiplier: options?.backoffMultiplier ?? 2,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === opts.maxRetries || !isRetryable(error)) {
        throw error;
      }
      const retryAfterMs = (
        error as ServiceNowApiError & { retryAfterMs?: number }
      )?.retryAfterMs;
      const delay = calculateDelay(attempt, opts, retryAfterMs);
      const statusCode = (error as ServiceNowApiError)?.statusCode;
      const code = (error as { code?: string })?.code;
      logger.warn(
        {
          attempt: attempt + 1,
          maxRetries: opts.maxRetries,
          delayMs: Math.round(delay),
          statusCode,
          errorCode: code,
        },
        "Retrying ServiceNow API call"
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

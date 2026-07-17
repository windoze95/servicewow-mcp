import type { Redis } from "ioredis";
import { logger } from "../utils/logger.js";

const DAY_SECONDS = 86400;
const DEFAULT_RETENTION_DAYS = 400;
export const MAX_SUMMARY_DAYS = 400;

export interface UsageCounts {
  calls: number;
  errors: number;
}

export interface UsageAggregates {
  totals: UsageCounts;
  byTool: Record<string, UsageCounts>;
  byUser: Record<string, UsageCounts>;
  byToolUser: Record<string, Record<string, UsageCounts>>;
}

export interface UsageSummary extends UsageAggregates {
  days: number;
  from: string;
  to: string;
  byDay: Record<string, UsageCounts>;
  /** Cumulative since metrics were first deployed; not limited by retention. */
  allTime: UsageAggregates;
}

function utcDay(offsetDays = 0): string {
  return new Date(Date.now() - offsetDays * DAY_SECONDS * 1000)
    .toISOString()
    .slice(0, 10);
}

// "|" separates tool and user in hash fields, so strip it from inputs
function sanitizeField(value: string): string {
  return value.replaceAll("|", "_");
}

function emptyCounts(): UsageCounts {
  return { calls: 0, errors: 0 };
}

/**
 * Durable usage counters in Redis. Counters survive app redeploys (unlike
 * container logs). Per-day hashes expire after the retention window; the
 * all-time hashes never expire — their size is bounded by tools × users,
 * not by time.
 *
 * Keys: metrics:calls:<YYYY-MM-DD> / metrics:errors:<YYYY-MM-DD> (UTC days)
 * and metrics:total:calls / metrics:total:errors (no TTL), hash fields
 * "<toolName>|<userName>" holding call counts.
 */
export class UsageMetrics {
  constructor(
    private redis: Redis,
    private retentionDays: number = DEFAULT_RETENTION_DAYS
  ) {}

  private dayKey(kind: "calls" | "errors", day: string): string {
    return `metrics:${kind}:${day}`;
  }

  private totalKey(kind: "calls" | "errors"): string {
    return `metrics:total:${kind}`;
  }

  /**
   * Fire-and-forget increment; must never throw or delay a tool call.
   * Only calls that resolved a user context are recorded.
   */
  record(toolName: string, userName: string, ok: boolean): void {
    try {
      const kind = ok ? "calls" : "errors";
      const key = this.dayKey(kind, utcDay());
      const field = `${sanitizeField(toolName)}|${sanitizeField(userName)}`;
      this.redis
        .multi()
        .hincrby(key, field, 1)
        .expire(key, this.retentionDays * DAY_SECONDS, "NX")
        .hincrby(this.totalKey(kind), field, 1)
        .exec()
        .catch((err) => {
          logger.debug({ err }, "Usage metrics increment failed");
        });
    } catch (err) {
      logger.debug({ err }, "Usage metrics increment failed");
    }
  }

  async summary(days: number): Promise<UsageSummary> {
    const window = Math.min(Math.max(Math.trunc(days), 1), MAX_SUMMARY_DAYS);
    const dayList: string[] = [];
    for (let i = 0; i < window; i++) {
      dayList.push(utcDay(i));
    }

    const pipeline = this.redis.pipeline();
    for (const day of dayList) pipeline.hgetall(this.dayKey("calls", day));
    for (const day of dayList) pipeline.hgetall(this.dayKey("errors", day));
    pipeline.hgetall(this.totalKey("calls"));
    pipeline.hgetall(this.totalKey("errors"));
    const results = (await pipeline.exec()) ?? [];

    const summary: UsageSummary = {
      days: window,
      from: dayList[dayList.length - 1],
      to: dayList[0],
      totals: emptyCounts(),
      byTool: {},
      byUser: {},
      byDay: {},
      byToolUser: {},
      allTime: {
        totals: emptyCounts(),
        byTool: {},
        byUser: {},
        byToolUser: {},
      },
    };

    const ingest = (
      target: UsageAggregates,
      fields: Record<string, string>,
      kind: keyof UsageCounts,
      day?: string
    ): void => {
      for (const [field, raw] of Object.entries(fields)) {
        const count = parseInt(raw, 10);
        if (!Number.isFinite(count)) continue;
        const [toolName, userName = "unknown"] = field.split("|");

        target.totals[kind] += count;
        (target.byTool[toolName] ??= emptyCounts())[kind] += count;
        (target.byUser[userName] ??= emptyCounts())[kind] += count;
        ((target.byToolUser[toolName] ??= {})[userName] ??= emptyCounts())[
          kind
        ] += count;
        if (day !== undefined) {
          (summary.byDay[day] ??= emptyCounts())[kind] += count;
        }
      }
    };

    for (let i = 0; i < dayList.length; i++) {
      const [callsErr, calls] = results[i] ?? [null, {}];
      const [errorsErr, errors] = results[dayList.length + i] ?? [null, {}];
      if (!callsErr && calls) {
        ingest(summary, calls as Record<string, string>, "calls", dayList[i]);
      }
      if (!errorsErr && errors) {
        ingest(summary, errors as Record<string, string>, "errors", dayList[i]);
      }
    }

    const [totalCallsErr, totalCalls] = results[dayList.length * 2] ?? [null, {}];
    const [totalErrorsErr, totalErrors] = results[dayList.length * 2 + 1] ?? [null, {}];
    if (!totalCallsErr && totalCalls) {
      ingest(summary.allTime, totalCalls as Record<string, string>, "calls");
    }
    if (!totalErrorsErr && totalErrors) {
      ingest(summary.allTime, totalErrors as Record<string, string>, "errors");
    }

    return summary;
  }
}

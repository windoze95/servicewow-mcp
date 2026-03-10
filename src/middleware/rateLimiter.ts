import type { Redis } from "ioredis";
import { logger } from "../utils/logger.js";

// Token bucket rate limiter using Redis Lua script
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local window = 60

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens = tonumber(data[1])
local last_refill = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  last_refill = now
end

local elapsed = now - last_refill
local refill = math.floor(elapsed * capacity / window)
if refill > 0 then
  tokens = math.min(capacity, tokens + refill)
  last_refill = now
end

if tokens > 0 then
  tokens = tokens - 1
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
  redis.call('EXPIRE', key, window * 2)
  return 1
else
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', last_refill)
  redis.call('EXPIRE', key, window * 2)
  return 0
end
`;

export class RateLimiter {
  constructor(
    private redis: Redis,
    private capacity: number
  ) {}

  async checkLimit(userSysId: string): Promise<boolean> {
    const key = `ratelimit:${userSysId}`;
    const now = Math.floor(Date.now() / 1000);

    try {
      const result = await this.redis.eval(
        RATE_LIMIT_SCRIPT,
        1,
        key,
        this.capacity,
        now
      );
      const allowed = result === 1;

      if (!allowed) {
        logger.warn({ userSysId }, "Rate limit exceeded");
      }

      return allowed;
    } catch (err) {
      logger.error({ err, userSysId }, "Rate limiter error, allowing request");
      return true; // Fail open
    }
  }
}

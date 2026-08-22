import Redis from "ioredis";

const CACHE_ENABLED = process.env.CACHE_ENABLED !== "false";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

let redis: Redis | null = null;

if (CACHE_ENABLED) {
  redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
    lazyConnect: true,
    enableReadyCheck: true,
    connectTimeout: 5_000,
  });

  redis.on("connect", () => {
    console.log("[cache] Redis connected");
  });

  redis.on("ready", () => {
    console.log("[cache] Redis ready");
  });

  redis.on("error", (err) => {
    console.warn("[cache] Redis error — caching disabled for this cycle:", err.message);
  });

  redis.on("close", () => {
    console.log("[cache] Redis connection closed");
  });
}

/** Returns the shared Redis client, or null if caching is disabled. */
export function getRedis(): Redis | null {
  return redis;
}

/** Connect to Redis if caching is enabled. Non-blocking if Redis is down. */
export async function connectRedis(): Promise<void> {
  if (!redis) return;
  try {
    await redis.connect();
  } catch (err) {
    console.warn("[cache] Failed to connect to Redis — running without cache:", err);
    redis = null;
  }
}

/** Disconnect from Redis gracefully. */
export async function disconnectRedis(): Promise<void> {
  if (!redis) return;
  try {
    await redis.quit();
  } catch {
    redis.disconnect();
  }
  redis = null;
}

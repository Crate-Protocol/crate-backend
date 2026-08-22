import { getRedis } from "./redis.js";

const PREFIX = "crate:";

/**
 * Delete all keys matching a pattern using SCAN (non-blocking).
 * Returns the number of keys deleted.
 */
async function deleteByPattern(pattern: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;

  let deleted = 0;
  let cursor = "0";

  try {
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${PREFIX}${pattern}`, "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");
  } catch (err) {
    console.warn("[cache] deleteByPattern failed:", err);
  }

  return deleted;
}

/** Invalidate all sample listing cache entries. */
export async function invalidateSampleCache(): Promise<void> {
  const count = await deleteByPattern("samples:*");
  if (count > 0) {
    console.log(`[cache] invalidated ${count} sample cache entries`);
  }
}

/** Invalidate the platform stats cache. */
export async function invalidateStatsCache(): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(`${PREFIX}stats`);
    console.log("[cache] invalidated stats cache");
  } catch (err) {
    console.warn("[cache] failed to invalidate stats cache:", err);
  }
}

/** Invalidate the earnings cache for a specific address. */
export async function invalidateEarningsCache(address: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;

  try {
    await redis.del(`${PREFIX}earnings:${address}`);
    console.log(`[cache] invalidated earnings cache for ${address}`);
  } catch (err) {
    console.warn("[cache] failed to invalidate earnings cache:", err);
  }
}

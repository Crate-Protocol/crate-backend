import { createHash } from "node:crypto";
import { getRedis } from "./redis.js";

const PREFIX = "crate:";

/**
 * Cache-aside helper. Checks Redis for `key`; on miss, calls `fetcher()`,
 * stores the result with `ttlSeconds`, and returns it. On any Redis error,
 * falls through to `fetcher()` so the API keeps working without cache.
 */
export async function cacheWith<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const redis = getRedis();
  if (!redis) return fetcher();

  const fullKey = `${PREFIX}${key}`;

  try {
    const cached = await redis.get(fullKey);
    if (cached !== null) {
      return JSON.parse(cached) as T;
    }
  } catch (err) {
    console.warn("[cache] GET failed, falling through:", err);
    return fetcher();
  }

  const result = await fetcher();

  try {
    await redis.setex(fullKey, ttlSeconds, JSON.stringify(result));
  } catch (err) {
    console.warn("[cache] SET failed:", err);
  }

  return result;
}

/**
 * Generate an ETag from a cache key. Returns a weak ETag string suitable
 * for the `ETag` response header.
 */
export function etagForKey(key: string): string {
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return `W/"${hash}"`;
}

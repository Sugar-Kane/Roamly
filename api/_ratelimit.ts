import { Redis } from "@upstash/redis";
import { Ratelimit } from "@upstash/ratelimit";

// Shared Upstash-backed rate limiting for the API functions. Each endpoint
// calls limitOrResponse() with its own bucket + per-user (or per-IP) key and
// short-window budget; a non-null return is a ready-to-send 429.
//
// Deliberately fails OPEN: when UPSTASH_REDIS_REST_URL/TOKEN aren't configured
// (or Redis errors mid-request) every call is allowed, so billing/AI/invites
// never break because the limiter is down. The DB-level quotas (monthly AI
// caps, daily invite caps) still stand underneath as the hard backstop.
//
// NOT applied to stripe-webhook (Stripe-signed traffic must never be dropped)
// or the admin-* endpoints (allowlist-gated).

let redis: Redis | null | undefined;
const limiters = new Map<string, Ratelimit>();

function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.log(JSON.stringify({ src: "roamly-api", route: "_ratelimit", outcome: "not_configured" }));
    redis = null;
    return redis;
  }
  redis = new Redis({ url, token });
  return redis;
}

/**
 * Returns null when the request is allowed, or a 429 Response to send back.
 * `key` should identify the caller (user id, else client IP).
 */
export async function limitOrResponse(bucket: string, key: string, limit: number, windowSec: number): Promise<Response | null> {
  const client = getRedis();
  if (!client) return null;
  try {
    const cacheKey = `${bucket}:${limit}:${windowSec}`;
    let limiter = limiters.get(cacheKey);
    if (!limiter) {
      limiter = new Ratelimit({
        redis: client,
        limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
        prefix: `roamly:rl:${bucket}`,
      });
      limiters.set(cacheKey, limiter);
    }
    const { success, reset } = await limiter.limit(key);
    if (success) return null;
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    return new Response(JSON.stringify({ error: "Slow down a moment, then try again." }), {
      status: 429,
      headers: { "content-type": "application/json", "retry-after": String(retryAfter) },
    });
  } catch (error) {
    // Redis hiccup: allow the request rather than blocking real users.
    console.log(JSON.stringify({ src: "roamly-api", route: "_ratelimit", outcome: "error", bucket, message: error instanceof Error ? error.message : "unknown" }));
    return null;
  }
}

/** Best-effort client IP for keys on requests where the user isn't known yet. */
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

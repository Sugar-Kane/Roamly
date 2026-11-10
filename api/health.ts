// Liveness + configuration check for uptime monitoring. Reports only the
// PRESENCE of required env vars (booleans) — never their values.
import { timingSafeEqual } from "node:crypto";

// Public callers get only up/degraded. The per-variable breakdown (which
// secrets are set, whether rate limiting is on) is configuration detail, so it
// needs the cron secret: `Authorization: Bearer $CRON_SECRET`.
function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  if (!secret) return false;
  const a = Buffer.from(given), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<Response> {
  const required = [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_ID",
    "STRIPE_MONTHLY_PRICE_ID",
    "STRIPE_ANNUAL_PRICE_ID",
    "STRIPE_WEBHOOK_SECRET",
    "ANTHROPIC_API_KEY",
    "APP_URL",
  ] as const;

  const env: Record<string, boolean> = {};
  let ok = true;
  for (const key of required) {
    const present = Boolean(process.env[key]);
    env[key] = present;
    if (!present) ok = false;
  }

  // Optional infra: the Upstash rate limiter fails OPEN, so its absence must
  // NOT flip overall status to degraded — but a deploy running with all burst
  // guards disabled should be visible to monitoring, so report presence (both
  // vars are needed for the limiter to engage) and a rate_limiting boolean.
  const optional: Record<string, boolean> = {
    UPSTASH_REDIS_REST_URL: Boolean(process.env.UPSTASH_REDIS_REST_URL),
    UPSTASH_REDIS_REST_TOKEN: Boolean(process.env.UPSTASH_REDIS_REST_TOKEN),
  };
  const rateLimiting = optional.UPSTASH_REDIS_REST_URL && optional.UPSTASH_REDIS_REST_TOKEN;

  const body = authorized(request)
    ? { status: ok ? "ok" : "degraded", time: new Date().toISOString(), env, optional, rateLimiting }
    : { status: ok ? "ok" : "degraded", time: new Date().toISOString() };
  return new Response(
    JSON.stringify(body),
    { status: ok ? 200 : 503, headers: { "content-type": "application/json", "cache-control": "no-store" } }
  );
}

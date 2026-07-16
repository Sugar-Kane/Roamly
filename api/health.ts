// Liveness + configuration check for uptime monitoring. Reports only the
// PRESENCE of required env vars (booleans) — never their values.
export async function GET(): Promise<Response> {
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

  return new Response(
    JSON.stringify({ status: ok ? "ok" : "degraded", time: new Date().toISOString(), env, optional, rateLimiting }),
    { status: ok ? 200 : 503, headers: { "content-type": "application/json", "cache-control": "no-store" } }
  );
}

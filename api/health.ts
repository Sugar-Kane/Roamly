// Liveness + configuration check for uptime monitoring. Reports only the
// PRESENCE of required env vars (booleans) — never their values.
export async function GET(): Promise<Response> {
  const required = [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_PRICE_ID",
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

  return new Response(
    JSON.stringify({ status: ok ? "ok" : "degraded", time: new Date().toISOString(), env }),
    { status: ok ? 200 : 503, headers: { "content-type": "application/json", "cache-control": "no-store" } }
  );
}

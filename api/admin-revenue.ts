import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Admin-only authoritative revenue, read straight from Stripe. This is the
// source of truth that the Revenue page's list-price estimates defer to.
// Admin-verified via the service role + the `admins` allowlist (same idiom as
// api/admin-feedback.ts). Read-only: it never writes to Stripe or the DB.
//
// Body: { start?: ISO, end?: ISO }  (defaults to the last 30 days)
// Returns:
//   { ok, currency, mrr_cents, arr_cents, active_subscriptions, trialing,
//     window: { start, end }, gross_cents, refunds_cents, fees_cents,
//     net_cents, generated_at }
// If Stripe is not configured, responds 503 { configured: false } so the
// client can fall back to its estimates.

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Normalize a recurring price to a monthly amount in the price's currency's
// minor units (cents). Annual plans divide by 12; weekly/daily are scaled to a
// month so mixed billing intervals still sum to a comparable MRR.
function monthlyCents(unitAmount: number, quantity: number, interval: string, intervalCount: number): number {
  const base = unitAmount * quantity;
  const perInterval = intervalCount > 0 ? base / intervalCount : base;
  switch (interval) {
    case "year": return perInterval / 12;
    case "week": return (perInterval * 52) / 12;
    case "day": return (perInterval * 365) / 12;
    case "month":
    default: return perInterval;
  }
}

export async function POST(request: Request): Promise<Response> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Not configured." }, 503);
  if (!stripeSecret) return json({ error: "Stripe is not configured.", configured: false }, 503);

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json({ error: "Missing auth token" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

  const { data: adminRow } = await admin
    .from("admins").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (!adminRow) return json({ error: "You don't have admin access." }, 403);

  let body: { start?: string; end?: string } = {};
  try { body = await request.json(); } catch { /* defaults below */ }
  const end = body.end ? new Date(body.end) : new Date();
  const start = body.start ? new Date(body.start) : new Date(end.getTime() - 30 * 86400000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) {
    return json({ error: "Invalid window." }, 400);
  }

  const stripe = new Stripe(stripeSecret);

  try {
    // --- Recurring revenue: sum active subscriptions' monthly-equivalent value.
    let mrrCents = 0;
    let activeSubs = 0;
    let currency = "usd";
    for await (const sub of stripe.subscriptions.list({ status: "active", limit: 100 })) {
      activeSubs += 1;
      for (const item of sub.items.data) {
        const price = item.price;
        if (!price || price.unit_amount == null || !price.recurring) continue;
        currency = price.currency || currency;
        mrrCents += monthlyCents(price.unit_amount, item.quantity ?? 1, price.recurring.interval, price.recurring.interval_count ?? 1);
      }
    }
    mrrCents = Math.round(mrrCents);

    let trialing = 0;
    for await (const _sub of stripe.subscriptions.list({ status: "trialing", limit: 100 })) trialing += 1;

    // --- Net revenue in the window, from balance transactions (authoritative:
    // gross, fees, and net after Stripe's cut, including refunds).
    let grossCents = 0, refundsCents = 0, feesCents = 0, netCents = 0;
    for await (const tx of stripe.balanceTransactions.list({
      created: { gte: Math.floor(start.getTime() / 1000), lt: Math.floor(end.getTime() / 1000) },
      limit: 100,
    })) {
      currency = tx.currency || currency;
      feesCents += tx.fee;
      netCents += tx.net;
      if (tx.amount >= 0) grossCents += tx.amount;
      else refundsCents += -tx.amount;
    }

    return json({
      ok: true,
      currency,
      mrr_cents: mrrCents,
      arr_cents: mrrCents * 12,
      active_subscriptions: activeSubs,
      trialing,
      window: { start: start.toISOString(), end: end.toISOString() },
      gross_cents: grossCents,
      refunds_cents: refundsCents,
      fees_cents: feesCents,
      net_cents: netCents,
      generated_at: new Date().toISOString(),
    }, 200);
  } catch (err) {
    console.log(JSON.stringify({ src: "roamly-api", route: "admin-revenue", outcome: "stripe_error", message: (err as Error)?.message }));
    return json({ error: "Couldn't reach Stripe." }, 502);
  }
}

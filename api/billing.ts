import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { limitOrResponse } from "./_ratelimit";

// All user-facing Stripe session operations behind one endpoint (Vercel's
// Hobby plan caps a deployment at 12 serverless functions, and these three
// flows shared their env/auth/rate-limit scaffolding anyway):
//
//   { action: "checkout", plan?: "monthly" | "annual", pack?: "small" | "large" }
//     Starts a Stripe Checkout session. A pack switches it to a one-time
//     credit purchase; otherwise the subscription flow for the given plan.
//     Amounts and price ids live server-side only — the client names a pack
//     or plan, never a price.
//
//   { action: "portal" }
//     Opens the Stripe Billing Portal: update card, view invoices, or cancel.
//     Cancelling flows back through api/stripe-webhook, which flips
//     is_premium off automatically.
//
//   { action: "cancel", resume?: boolean }
//     In-app cancel (and undo): sets Stripe's cancel_at_period_end so the
//     user keeps Premium for the time they already paid for. The webhook
//     persists the pending-cancel flag so the UI shows "Premium ends on X".
//
// The webhook itself stays in api/stripe-webhook.ts — its URL is registered
// in the Stripe dashboard and must not move.

// One-time AI-upload credit packs. Inline price_data means no
// Stripe-dashboard Price objects are needed; the existing STRIPE_PRICE_ID
// stays for the subscription alone.
const CREDIT_PACKS = {
  small: { credits: 2, cents: 100, name: "2 Roamly upload credits" },
  large: { credits: 5, cents: 200, name: "5 Roamly upload credits" },
} as const;
type PackId = keyof typeof CREDIT_PACKS;
type PlanId = "monthly" | "annual";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function POST(request: Request): Promise<Response> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const appUrl = process.env.APP_URL;
  if (!stripeSecret || !supabaseUrl || !serviceRoleKey) {
    return json({ error: "Payments are not configured yet." }, 503);
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json({ error: "Missing auth token" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Invalid session" }, 401);
  const user = userData.user;

  let body: { action?: string; pack?: string; plan?: string; resume?: boolean } = {};
  try { body = await request.json(); } catch { /* handled per action below */ }
  const action = body.action;
  if (action !== "checkout" && action !== "portal" && action !== "cancel") {
    return json({ error: "Unknown action" }, 400);
  }

  const stripe = new Stripe(stripeSecret);

  if (action === "checkout") {
    const monthlyPriceId = process.env.STRIPE_MONTHLY_PRICE_ID ?? process.env.STRIPE_PRICE_ID;
    const annualPriceId = process.env.STRIPE_ANNUAL_PRICE_ID;
    if (!monthlyPriceId || !appUrl) return json({ error: "Payments are not configured yet." }, 503);

    // Short-window burst guard (Upstash; no-op until configured). Same bucket
    // names and budgets as the pre-consolidation endpoints.
    const rl = await limitOrResponse("checkout", user.id, 10, 60);
    if (rl) return rl;

    // { pack } switches this to a one-time credit-pack purchase; otherwise
    // the subscription flow for { plan } (default monthly).
    let pack: (typeof CREDIT_PACKS)[PackId] | null = null;
    let packId: PackId | null = null;
    let planId: PlanId = "monthly";
    if (body.pack) {
      if (!(body.pack in CREDIT_PACKS)) return json({ error: "Unknown credit pack." }, 400);
      packId = body.pack as PackId;
      pack = CREDIT_PACKS[packId];
    }
    if (body.plan) {
      if (body.plan !== "monthly" && body.plan !== "annual") return json({ error: "Unknown subscription plan." }, 400);
      planId = body.plan;
    }
    const subscriptionPriceId = planId === "annual" ? annualPriceId : monthlyPriceId;
    if (!pack && !subscriptionPriceId) return json({ error: "That subscription plan is not configured yet." }, 503);

    const { data: profileRow, error: profileError } = await admin
      .from("profiles").select("stripe_customer_id").eq("id", user.id).single();
    if (profileError) return json({ error: "Could not load profile" }, 500);

    // Stripe rejections (archived/wrong-mode price ids, an account that can't
    // take live charges yet) used to escape as opaque 500s. Surface the real
    // message so misconfiguration is diagnosable from the network tab.
    try {
      let customerId = profileRow?.stripe_customer_id as string | null;
      if (!customerId) {
        // Idempotency key on the user id: a double-click that races past the
        // profile check above still yields ONE Stripe customer, not duplicates.
        const customer = await stripe.customers.create(
          { email: user.email ?? undefined, metadata: { supabase_user_id: user.id } },
          { idempotencyKey: `roamly-customer-${user.id}` }
        );
        customerId = customer.id;
        await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
      }

      // Minute-bucketed idempotency: rapid double-clicks reuse one checkout
      // session; a deliberate retry minutes later gets a fresh one.
      const checkoutSession = await stripe.checkout.sessions.create(
        pack
          ? {
              mode: "payment",
              customer: customerId,
              line_items: [{
                quantity: 1,
                price_data: { currency: "usd", unit_amount: pack.cents, product_data: { name: pack.name } },
              }],
              success_url: `${appUrl}/?checkout=success`,
              cancel_url: `${appUrl}/?checkout=cancelled`,
              // The webhook grants exactly metadata.credits, never a client value.
              metadata: { supabase_user_id: user.id, pack_id: packId!, credits: String(pack.credits) },
            }
          : {
              mode: "subscription",
              customer: customerId,
              line_items: [{ price: subscriptionPriceId!, quantity: 1 }],
              success_url: `${appUrl}/?checkout=success`,
              cancel_url: `${appUrl}/?checkout=cancelled`,
              metadata: { supabase_user_id: user.id, plan: planId },
            },
        { idempotencyKey: `roamly-${pack ? `credits-${packId}` : `subscription-${planId}`}-${user.id}-${Math.floor(Date.now() / 60_000)}` }
      );

      return json({ url: checkoutSession.url }, 200);
    } catch (err) {
      const message = (err as { message?: string })?.message ?? "Checkout could not be started.";
      console.log(JSON.stringify({ src: "roamly-api", route: "billing/checkout", outcome: "stripe_error", message }));
      return json({ error: message }, 500);
    }
  }

  if (action === "portal") {
    if (!appUrl) return json({ error: "Payments are not configured yet." }, 503);
    const rl = await limitOrResponse("portal", user.id, 10, 60);
    if (rl) return rl;

    const { data: profileRow } = await admin
      .from("profiles").select("stripe_customer_id").eq("id", user.id).single();
    const customerId = profileRow?.stripe_customer_id as string | null;
    if (!customerId) return json({ error: "No subscription found for this account." }, 404);

    try {
      const portal = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: `${appUrl}/` });
      return json({ url: portal.url }, 200);
    } catch (err) {
      // The most common cause is the Billing Customer Portal not being
      // activated in the Stripe dashboard — surface that clearly.
      const message = (err as { message?: string })?.message ?? "";
      if (/portal|configuration/i.test(message)) {
        return json({ error: "Billing isn't fully set up yet — activate the Stripe Customer Portal in your Stripe dashboard." }, 503);
      }
      return json({ error: "Couldn't open the billing portal — try again." }, 502);
    }
  }

  // action === "cancel" — set (or with resume: true, clear) cancel_at_period_end.
  const rl = await limitOrResponse("cancel-sub", user.id, 5, 60);
  if (rl) return rl;
  const resume = body.resume === true;

  const { data: profileRow } = await admin
    .from("profiles").select("stripe_subscription_id").eq("id", user.id).single();
  const subscriptionId = profileRow?.stripe_subscription_id as string | null;
  if (!subscriptionId) return json({ error: "No subscription found for this account." }, 404);

  try {
    const subscription = await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: !resume });
    const item = subscription.items?.data?.[0] as { current_period_end?: number } | undefined;
    const periodEnd = item?.current_period_end
      ?? (subscription as unknown as { current_period_end?: number }).current_period_end;
    return json({
      cancel_at_period_end: subscription.cancel_at_period_end === true,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    }, 200);
  } catch (err) {
    const message = (err as { message?: string })?.message ?? "";
    // Already-cancelled/missing subscriptions surface as a 404 the client can
    // explain, not a bare failure.
    if (/no such subscription|canceled/i.test(message)) {
      return json({ error: "That subscription is no longer active." }, 404);
    }
    console.log(JSON.stringify({ src: "roamly-api", route: "billing/cancel", outcome: "stripe_error", message }));
    return json({ error: "Couldn't update the subscription. Try again." }, 502);
  }
}

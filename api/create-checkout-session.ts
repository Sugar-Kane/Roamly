import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { limitOrResponse } from "./_ratelimit";

// One-time AI-upload credit packs. Amounts live server-side only — the client
// names a pack, never a price. Inline price_data means no Stripe-dashboard
// Price objects are needed; the existing STRIPE_PRICE_ID stays for the
// subscription alone.
const CREDIT_PACKS = {
  small: { credits: 2, cents: 100, name: "2 Roamly upload credits" },
  large: { credits: 5, cents: 200, name: "5 Roamly upload credits" },
} as const;
type PackId = keyof typeof CREDIT_PACKS;
type PlanId = "monthly" | "annual";

export async function POST(request: Request): Promise<Response> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const monthlyPriceId = process.env.STRIPE_MONTHLY_PRICE_ID ?? process.env.STRIPE_PRICE_ID;
  const annualPriceId = process.env.STRIPE_ANNUAL_PRICE_ID;
  const appUrl = process.env.APP_URL;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecret || !monthlyPriceId || !appUrl || !supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Payments are not configured yet." }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return new Response(JSON.stringify({ error: "Missing auth token" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const stripe = new Stripe(stripeSecret);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: "Invalid session" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const user = userData.user;

  // Short-window burst guard (Upstash; no-op until configured).
  const rl = await limitOrResponse("checkout", user.id, 10, 60);
  if (rl) return rl;

  // Optional body: { pack: "small" | "large" } switches this to a one-time
  // credit-pack purchase. No body (or no pack) → the subscription flow.
  let pack: (typeof CREDIT_PACKS)[PackId] | null = null;
  let packId: PackId | null = null;
  let planId: PlanId = "monthly";
  try {
    const body = (await request.json()) as { pack?: string; plan?: string };
    if (body?.pack) {
      if (!(body.pack in CREDIT_PACKS)) {
        return new Response(JSON.stringify({ error: "Unknown credit pack." }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      packId = body.pack as PackId;
      pack = CREDIT_PACKS[packId];
    }
    if (body?.plan) {
      if (body.plan !== "monthly" && body.plan !== "annual") {
        return new Response(JSON.stringify({ error: "Unknown subscription plan." }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      planId = body.plan;
    }
  } catch { /* no JSON body — subscription flow */ }

  const subscriptionPriceId = planId === "annual" ? annualPriceId : monthlyPriceId;
  if (!pack && !subscriptionPriceId) {
    return new Response(JSON.stringify({ error: "That subscription plan is not configured yet." }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  const { data: profileRow, error: profileError } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();
  if (profileError) {
    return new Response(JSON.stringify({ error: "Could not load profile" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  // Stripe rejections (archived/wrong-mode price ids, an account that can't
  // take live charges yet, a prod_ pasted where a price_ belongs) used to
  // escape as opaque 500s. Surface the real message so misconfiguration is
  // diagnosable from the browser's network tab.
  try {
    let customerId = profileRow?.stripe_customer_id as string | null;
    if (!customerId) {
      // Idempotency key on the user id: a double-click that races past the
      // profile check above still yields ONE Stripe customer, not duplicates.
      const customer = await stripe.customers.create(
        {
          email: user.email ?? undefined,
          metadata: { supabase_user_id: user.id },
        },
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
            metadata: {
              supabase_user_id: user.id,
              pack_id: packId!,
              credits: String(pack.credits),
            },
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

    return new Response(JSON.stringify({ url: checkoutSession.url }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const message = (err as { message?: string })?.message ?? "Checkout could not be started.";
    console.log(JSON.stringify({ src: "roamly-api", route: "create-checkout-session", outcome: "stripe_error", message }));
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}

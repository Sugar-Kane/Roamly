import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request): Promise<Response> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  const appUrl = process.env.APP_URL;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecret || !priceId || !appUrl || !supabaseUrl || !serviceRoleKey) {
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
    {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/?checkout=success`,
      cancel_url: `${appUrl}/?checkout=cancelled`,
      metadata: { supabase_user_id: user.id },
    },
    { idempotencyKey: `roamly-checkout-${user.id}-${Math.floor(Date.now() / 60_000)}` }
  );

  return new Response(JSON.stringify({ url: checkoutSession.url }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { limitOrResponse } from "./_ratelimit";

// Opens the Stripe Billing Portal for the signed-in user: update card, view
// invoices, or cancel. Cancelling flows back through api/stripe-webhook
// (customer.subscription.updated/deleted), which flips is_premium off — so a
// lapsed or cancelled subscription reverts the account to the free tier with
// no manual step. Same auth-verify pattern as create-checkout-session.
export async function POST(request: Request): Promise<Response> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const appUrl = process.env.APP_URL;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (!stripeSecret || !appUrl || !supabaseUrl || !serviceRoleKey) {
    return json({ error: "Payments are not configured yet." }, 503);
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json({ error: "Missing auth token" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

  // Short-window burst guard (Upstash; no-op until configured).
  const rl = await limitOrResponse("portal", userData.user.id, 10, 60);
  if (rl) return rl;

  const { data: profileRow } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userData.user.id)
    .single();
  const customerId = profileRow?.stripe_customer_id as string | null;
  if (!customerId) return json({ error: "No subscription found for this account." }, 404);

  const stripe = new Stripe(stripeSecret);
  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/`,
    });
    return json({ url: portal.url }, 200);
  } catch (err) {
    // The most common cause is the Billing Customer Portal not being activated
    // in the Stripe dashboard — surface that clearly instead of a bare 500.
    const message = (err as { message?: string })?.message ?? "";
    if (/portal|configuration/i.test(message)) {
      return json({ error: "Billing isn't fully set up yet — activate the Stripe Customer Portal in your Stripe dashboard." }, 503);
    }
    return json({ error: "Couldn't open the billing portal — try again." }, 502);
  }
}

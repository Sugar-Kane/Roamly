import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { limitOrResponse } from "./_ratelimit";

// In-app subscription cancel (and undo). Sets Stripe's cancel_at_period_end so
// the user keeps Premium for the time they already paid for; Stripe fires
// customer.subscription.updated, which api/stripe-webhook persists (including
// the pending-cancel flag) so the UI can show "Premium ends on <date>". Pass
// { resume: true } to un-cancel before the period lapses. Same auth-verify
// pattern as create-portal-session.
export async function POST(request: Request): Promise<Response> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (!stripeSecret || !supabaseUrl || !serviceRoleKey) {
    return json({ error: "Payments are not configured yet." }, 503);
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json({ error: "Missing auth token" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

  // Short-window burst guard (Upstash; no-op until configured).
  const rl = await limitOrResponse("cancel-sub", userData.user.id, 5, 60);
  if (rl) return rl;

  let resume = false;
  try {
    const body = (await request.json()) as { resume?: boolean };
    resume = body?.resume === true;
  } catch { /* no body = cancel */ }

  const { data: profileRow } = await admin
    .from("profiles")
    .select("stripe_subscription_id")
    .eq("id", userData.user.id)
    .single();
  const subscriptionId = profileRow?.stripe_subscription_id as string | null;
  if (!subscriptionId) return json({ error: "No subscription found for this account." }, 404);

  const stripe = new Stripe(stripeSecret);
  try {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: !resume,
    });
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
    console.log(JSON.stringify({ src: "roamly-api", route: "cancel-subscription", outcome: "stripe_error", message }));
    return json({ error: "Couldn't update the subscription. Try again." }, 502);
  }
}

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

// Uses the Web Standard Request/Response export style (not the legacy
// VercelRequest/VercelResponse shape) specifically so `await request.text()`
// always returns the raw, unparsed body — required for Stripe signature
// verification. The legacy `request.body` helper auto-parses JSON bodies by
// Content-Type before the handler runs, which would break signature checks.
export async function POST(request: Request): Promise<Response> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!stripeSecret || !webhookSecret || !supabaseUrl || !serviceRoleKey) {
    return new Response(null, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const stripe = new Stripe(stripeSecret);
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch {
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.metadata?.supabase_user_id;
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (userId) {
      await admin.from("profiles").update({ is_premium: true, stripe_subscription_id: subscriptionId ?? null }).eq("id", userId);
    }
  } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const active = subscription.status === "active" || subscription.status === "trialing";
    const { data: matched } = await admin
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", subscription.customer as string)
      .single();
    if (matched) {
      await admin.from("profiles").update({ is_premium: active, stripe_subscription_id: subscription.id }).eq("id", matched.id);
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

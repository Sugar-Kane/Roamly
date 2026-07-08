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

  // Exactly-once processing: Stripe retries deliveries, so record each event
  // id and skip ones we've already handled. If the table doesn't exist yet
  // (migration not applied) we proceed without dedupe — handlers below set
  // absolute state, so a replay is still harmless.
  {
    const { error: dedupeError } = await admin.from("stripe_events").insert({ id: event.id, type: event.type });
    if (dedupeError?.code === "23505") {
      return new Response(JSON.stringify({ received: true, duplicate: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
  }

  // Resolve a Stripe customer id to our profile row.
  const profileForCustomer = async (customerId: string) => {
    const { data } = await admin.from("profiles").select("id").eq("stripe_customer_id", customerId).single();
    return data;
  };

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
    const matched = await profileForCustomer(subscription.customer as string);
    if (matched) {
      await admin.from("profiles").update({ is_premium: active, stripe_subscription_id: subscription.id }).eq("id", matched.id);
    }
  } else if (event.type === "invoice.paid") {
    // Renewal (or recovery after a failed payment) — re-affirm premium. This
    // also self-heals a profile that missed an earlier subscription event.
    const invoice = event.data.object as Stripe.Invoice;
    if (typeof invoice.customer === "string") {
      const matched = await profileForCustomer(invoice.customer);
      if (matched) await admin.from("profiles").update({ is_premium: true }).eq("id", matched.id);
    }
  } else if (event.type === "invoice.payment_failed") {
    // No state change: Stripe retries the charge, and if it ultimately fails
    // the subscription moves to past_due/unpaid, which arrives above as
    // customer.subscription.updated and flips is_premium off. Log for audit.
    const invoice = event.data.object as Stripe.Invoice;
    console.warn("[Roamly] stripe invoice.payment_failed", { customer: invoice.customer, invoice: invoice.id });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

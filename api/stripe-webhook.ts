import Stripe from "stripe";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function apiLog(route: string, outcome: string, fields: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({ src: "roamly-api", route, outcome, time: new Date().toISOString(), ...fields }));
  } catch {
    console.log(`roamly-api ${route} ${outcome}`);
  }
}

type SubscriptionSnapshot = {
  id: string;
  status: string;
  customer: string | { id: string };
  current_period_end?: number;
  items?: { data?: Array<{ price?: { id?: string }; current_period_end?: number }> };
};

function subscriptionFields(subscription: Stripe.Subscription): SubscriptionSnapshot {
  return subscription as unknown as SubscriptionSnapshot;
}

async function profileForCustomer(admin: SupabaseClient, customer: string): Promise<{ id: string } | null> {
  const { data } = await admin.from("profiles").select("id").eq("stripe_customer_id", customer).single();
  return data as { id: string } | null;
}

async function processSubscription(
  admin: SupabaseClient,
  event: Stripe.Event,
  subscription: Stripe.Subscription,
  explicitUserId?: string,
): Promise<string> {
  const snapshot = subscriptionFields(subscription);
  const customerId = typeof snapshot.customer === "string" ? snapshot.customer : snapshot.customer.id;
  const matched = explicitUserId ? { id: explicitUserId } : await profileForCustomer(admin, customerId);
  if (!matched) throw new Error("profile_not_found");
  const firstItem = snapshot.items?.data?.[0];
  const periodEnd = firstItem?.current_period_end ?? snapshot.current_period_end;
  const baseParams = {
    p_event_id: event.id,
    p_event_type: event.type,
    p_user: matched.id,
    p_subscription: snapshot.id,
    p_status: snapshot.status,
    p_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : new Date().toISOString(),
    p_price_id: firstItem?.price?.id ?? null,
  };
  // Stripe does not guarantee webhook ordering; p_event_created lets the RPC
  // ignore an out-of-order status change (e.g. a delayed "active" arriving after
  // a cancel). That parameter only exists after the release-6 migration, so if
  // this code deploys first, fall back to the pre-migration signature — the
  // webhook must never start failing just because the DB hasn't migrated yet.
  let { data, error } = await admin.rpc("process_stripe_subscription_event", {
    ...baseParams,
    p_event_created: new Date(event.created * 1000).toISOString(),
  });
  if (error && (error.code === "PGRST202" || /find the function|does not exist/i.test(error.message))) {
    ({ data, error } = await admin.rpc("process_stripe_subscription_event", baseParams));
  }
  if (error) throw error;
  return String(data);
}

export async function POST(request: Request): Promise<Response> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!stripeSecret || !webhookSecret || !supabaseUrl || !serviceRoleKey) return new Response(null, { status: 503 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const stripe = new Stripe(stripeSecret);
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await request.text(), signature, webhookSecret);
  } catch {
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.supabase_user_id;
      if (!userId) throw new Error("missing_user_metadata");

      if (session.mode === "payment") {
        const credits = Number.parseInt(session.metadata?.credits ?? "", 10);
        const premiumDays = Number.parseInt(session.metadata?.premium_days ?? "", 10);
        if (!Number.isFinite(credits) || !Number.isFinite(premiumDays) || !session.id) throw new Error("invalid_credit_metadata");
        const { data, error } = await admin.rpc("process_stripe_credit_event", {
          p_event_id: event.id,
          p_event_type: event.type,
          p_user: userId,
          p_credits: credits,
          p_premium_days: premiumDays,
          p_external_ref: session.id,
        });
        if (error) throw error;
        apiLog("stripe-webhook", "credits_processed", { event: event.id, outcome: data });
      } else {
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (!subscriptionId) throw new Error("missing_subscription");
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const outcome = await processSubscription(admin, event, subscription, userId);
        apiLog("stripe-webhook", "subscription_checkout_processed", { event: event.id, outcome });
      }
    } else if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const outcome = await processSubscription(admin, event, event.data.object as Stripe.Subscription);
      apiLog("stripe-webhook", "subscription_processed", { event: event.id, outcome });
    } else if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      const rawSubscription = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
      const subscriptionId = typeof rawSubscription === "string" ? rawSubscription : rawSubscription?.id;
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const outcome = await processSubscription(admin, event, subscription);
        apiLog("stripe-webhook", "invoice_subscription_processed", { event: event.id, outcome });
      }
    } else {
      const { error } = await admin.from("stripe_events").insert({ id: event.id, type: event.type });
      if (error && error.code !== "23505") throw error;
      if (event.type === "invoice.payment_failed") {
        const invoice = event.data.object as Stripe.Invoice;
        apiLog("stripe-webhook", "invoice_payment_failed", { customer: String(invoice.customer), invoice: invoice.id });
      }
    }
  } catch (error) {
    apiLog("stripe-webhook", "processing_failed", { event: event.id, type: event.type, message: error instanceof Error ? error.message : "unknown" });
    return new Response("Webhook processing failed", { status: 500 });
  }

  return Response.json({ received: true });
}

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Admin-only destructive action. Stripe is canceled first so a failed Stripe
// request never leaves a paying customer without access. The database revoke
// then removes every current entitlement and writes the existing audit record.
export async function POST(request: Request): Promise<Response> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publishableKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!stripeSecret || !supabaseUrl || !serviceRoleKey || !publishableKey) return json({ error: "Billing administration is not configured." }, 503);

  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return json({ error: "Missing auth token" }, 401);

  const service = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userError } = await service.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Invalid session" }, 401);
  const { data: adminRow } = await service.from("admins").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (!adminRow) return json({ error: "You don't have admin access." }, 403);

  let body: { userId?: string };
  try { body = await request.json(); } catch { return json({ error: "Invalid request body" }, 400); }
  const userId = body.userId?.trim() ?? "";
  if (!UUID.test(userId)) return json({ error: "Invalid user id" }, 400);

  const { data: profile, error: profileError } = await service.from("profiles")
    .select("stripe_customer_id, stripe_subscription_id").eq("id", userId).single();
  if (profileError || !profile) return json({ error: "User not found" }, 404);

  // Revoking Roamly access always proceeds; Stripe cancellation is
  // best-effort. If Stripe can't cancel (stale/test-mode subscription id, key
  // mode mismatch, ownership mismatch), the response carries a warning so the
  // admin knows to check the Stripe dashboard — but access is still revoked.
  let billingCanceled = false;
  let stripeWarning: string | null = null;
  const subscriptionId = profile.stripe_subscription_id as string | null;
  const customerId = profile.stripe_customer_id as string | null;
  if (subscriptionId) {
    const stripe = new Stripe(stripeSecret);
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const subscriptionCustomer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      if (!customerId || subscriptionCustomer !== customerId) {
        stripeWarning = `Subscription ${subscriptionId} belongs to a different Stripe customer — it was NOT canceled. Check the Stripe dashboard.`;
      } else if (subscription.status !== "canceled") {
        await stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
        billingCanceled = true;
      }
    } catch (error) {
      const stripeError = error as { code?: string; statusCode?: number; message?: string };
      if (stripeError.statusCode === 429) return json({ error: "Stripe is rate-limiting requests — try again in a moment. Access was not changed." }, 429);
      if (stripeError.code !== "resource_missing") {
        // Likely a test-mode subscription id against a live key (or vice
        // versa), or a transient Stripe failure. Revoke access anyway.
        stripeWarning = `Stripe could not cancel subscription ${subscriptionId} (${stripeError.message ?? "unknown error"}). If it's still active, cancel it in the Stripe dashboard.`;
      }
      // resource_missing: a stale subscription id — Stripe has nothing left to
      // bill, so the local revoke below is all that's needed.
    }
  }

  const asAdmin = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: revoked, error: revokeError } = await asAdmin.rpc("admin_revoke_premium", {
    p_user: userId,
    p_reason: billingCanceled
      ? "Stripe subscription canceled and access revoked from Roamly admin portal"
      : stripeWarning
        ? "Access revoked from Roamly admin portal; Stripe cancellation failed — see dashboard"
        : "Access revoked from Roamly admin portal; no active Stripe subscription",
  });
  if (revokeError) return json({ error: "Billing was handled, but Roamly access could not be updated. Check the admin audit and Stripe dashboard." }, 500);

  return json({ ok: true, billingCanceled, revoked: Number(revoked ?? 0), ...(stripeWarning ? { stripeWarning } : {}) }, 200);
}

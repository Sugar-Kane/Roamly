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

  let billingCanceled = false;
  const subscriptionId = profile.stripe_subscription_id as string | null;
  const customerId = profile.stripe_customer_id as string | null;
  if (subscriptionId) {
    const stripe = new Stripe(stripeSecret);
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const subscriptionCustomer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      if (!customerId || subscriptionCustomer !== customerId) return json({ error: "Stripe customer ownership check failed." }, 409);
      if (subscription.status !== "canceled") {
        await stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
        billingCanceled = true;
      }
    } catch (error) {
      const stripeError = error as { code?: string; statusCode?: number };
      if (stripeError.code !== "resource_missing") return json({ error: "Stripe could not cancel this subscription. Access was not revoked." }, stripeError.statusCode === 429 ? 429 : 502);
      // A stale subscription id means Stripe has nothing left to bill. Continue
      // with the local access revoke and let the audit trail record the action.
    }
  }

  const asAdmin = createClient(supabaseUrl, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: revoked, error: revokeError } = await asAdmin.rpc("admin_revoke_premium", {
    p_user: userId,
    p_reason: billingCanceled ? "Stripe subscription canceled and access revoked from Roamly admin portal" : "Access revoked from Roamly admin portal; no active Stripe subscription",
  });
  if (revokeError) return json({ error: "Billing was handled, but Roamly access could not be updated. Check the admin audit and Stripe dashboard." }, 500);

  return json({ ok: true, billingCanceled, revoked: Number(revoked ?? 0) }, 200);
}

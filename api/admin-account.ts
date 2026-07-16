import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Admin-only destructive account actions, consolidated behind one endpoint
// (Vercel's Hobby plan caps a deployment at 12 serverless functions, and these
// two flows shared most of their scaffolding anyway):
//
//   { action: "revoke_premium", userId } — cancel Stripe first (best-effort),
//     then revoke every current entitlement via the audited
//     admin_revoke_premium RPC. Access is revoked even when Stripe can't
//     cancel; the response carries a warning so the admin checks the dashboard.
//
//   { action: "delete_user", userId } — PERMANENT deletion: cancel Stripe
//     first so a deleted user can never keep being charged, write the audit
//     record, hard-delete the auth user (every app table cascades), and only
//     report success once Auth confirms the user is actually gone.
export async function POST(request: Request): Promise<Response> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publishableKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!stripeSecret || !supabaseUrl || !serviceRoleKey || !publishableKey) return json({ error: "Account administration is not configured." }, 503);

  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return json({ error: "Missing auth token" }, 401);

  const service = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userError } = await service.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Invalid session" }, 401);
  const { data: adminRow } = await service.from("admins").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (!adminRow) return json({ error: "You don't have admin access." }, 403);

  let body: { action?: string; userId?: string };
  try { body = await request.json(); } catch { return json({ error: "Invalid request body" }, 400); }
  const action = body.action;
  if (action !== "revoke_premium" && action !== "delete_user") return json({ error: "Unknown action" }, 400);
  const userId = body.userId?.trim() ?? "";
  if (!UUID.test(userId)) return json({ error: "Invalid user id" }, 400);
  if (action === "delete_user" && userId === userData.user.id) return json({ error: "You can't delete your own admin account from here." }, 400);

  const { data: profile, error: profileError } = await service.from("profiles")
    .select("email, stripe_customer_id, stripe_subscription_id").eq("id", userId).single();
  if (profileError || !profile) return json({ error: "User not found" }, 404);

  // Both actions cancel Stripe billing first, best-effort: the destructive
  // Roamly-side step proceeds even if Stripe can't cancel (stale/test-mode
  // subscription id, key mode mismatch, ownership mismatch), but the response
  // carries a warning so the admin knows to check the Stripe dashboard.
  // resource_missing means a stale subscription id — nothing left to bill.
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
        stripeWarning = `Subscription ${subscriptionId} belongs to a different Stripe customer and was NOT canceled. Check the Stripe dashboard.`;
      } else if (subscription.status !== "canceled") {
        await stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
        billingCanceled = true;
      }
    } catch (error) {
      const stripeError = error as { code?: string; statusCode?: number; message?: string };
      if (stripeError.statusCode === 429) {
        return json({ error: `Stripe is rate-limiting requests. Try again in a moment; ${action === "delete_user" ? "the account was not deleted" : "access was not changed"}.` }, 429);
      }
      if (stripeError.code !== "resource_missing") {
        stripeWarning = `Stripe could not cancel subscription ${subscriptionId} (${stripeError.message ?? "unknown error"}). If it's still active, cancel it in the Stripe dashboard.`;
      }
    }
  }

  if (action === "revoke_premium") {
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

  // action === "delete_user"
  // Audit before the delete so the record survives even if the row insert
  // would have raced the cascade (admin_audit has no FK to the target).
  await service.from("admin_audit").insert({
    admin_id: userData.user.id,
    action: "delete_user",
    target: userId,
    detail: `Deleted account ${profile.email ?? userId}.${billingCanceled ? " Stripe subscription canceled." : ""}${stripeWarning ? ` ${stripeWarning}` : ""}`.slice(0, 500),
  });

  // Explicitly request a hard delete. Supabase defaults to hard deletion, but
  // passing false makes the security intent unambiguous and guards against a
  // future default change.
  const { error: deleteError } = await service.auth.admin.deleteUser(userId, false);
  if (deleteError) return json({ error: `Couldn't delete the account: ${deleteError.message}` }, 500);

  // Do not report success until Auth confirms the user record is actually gone.
  const { data: verification } = await service.auth.admin.getUserById(userId);
  if (verification?.user) {
    return json({ error: "The account could not be fully removed from authentication. Try again." }, 500);
  }

  return json({ ok: true, billingCanceled, ...(stripeWarning ? { stripeWarning } : {}) }, 200);
}

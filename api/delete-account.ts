import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { limitOrResponse } from "./_ratelimit";
import { apiLog } from "./_log";

// Self-service, PERMANENT account deletion — the user deleting THEIR OWN
// account. Unlike api/admin-delete-user, there is no admin allowlist: the
// bearer token identifies the caller, and the caller can only ever delete
// themselves. Billing is canceled first so a departing user can never keep
// being charged; their avatar objects are swept from storage (DB cascade
// removes rows but not Storage blobs); then the auth user is hard-deleted and
// every app table FKs auth.users(id) ON DELETE CASCADE, so profile, tasks,
// sessions, gamification, friendships, feedback, and events all go with it.
//
// The client enforces a typed "DELETE" confirmation; we require the same token
// in the body as a second guard against an accidental or forged call slipping
// through with just a valid session.
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function POST(request: Request): Promise<Response> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Account management is not configured." }, 503);

  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return json({ error: "Missing auth token" }, 401);

  const service = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userError } = await service.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Invalid session" }, 401);
  const userId = userData.user.id;

  // Tight budget: deletion is irreversible, so a handful of attempts per hour is
  // plenty and blunts any scripted abuse of a stolen token.
  const rl = await limitOrResponse("delete-account", userId, 3, 3600);
  if (rl) return rl;

  let confirm = "";
  try { confirm = ((await request.json()) as { confirm?: string })?.confirm ?? ""; } catch { /* no body */ }
  if (confirm !== "DELETE") return json({ error: "Deletion not confirmed." }, 400);

  const { data: profile } = await service.from("profiles")
    .select("email, stripe_customer_id, stripe_subscription_id").eq("id", userId).single();

  // Cancel billing first, best-effort. Deletion proceeds even if Stripe can't
  // cancel, but we log a warning so a lingering subscription can be caught.
  let billingCanceled = false;
  const subscriptionId = (profile?.stripe_subscription_id as string | null) ?? null;
  const customerId = (profile?.stripe_customer_id as string | null) ?? null;
  if (subscriptionId && stripeSecret) {
    const stripe = new Stripe(stripeSecret);
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const subCustomer = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
      if (customerId && subCustomer === customerId && subscription.status !== "canceled") {
        await stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false });
        billingCanceled = true;
      } else if (!customerId || subCustomer !== customerId) {
        apiLog("delete-account", "stripe_customer_mismatch", { userId, subscriptionId });
      }
    } catch (error) {
      const e = error as { code?: string; statusCode?: number; message?: string };
      if (e.statusCode === 429) return json({ error: "Payment provider is busy. Try again in a moment; your account was not deleted." }, 429);
      if (e.code !== "resource_missing") apiLog("delete-account", "stripe_cancel_failed", { userId, subscriptionId, message: e.message });
    }
  }

  // Sweep avatar objects from Storage. Rows cascade on user delete, but Storage
  // blobs do not — they live under a per-user folder (userId/<uuid>.ext). Best
  // effort: a leftover blob is harmless (its signed URLs die with the account)
  // and must never block the deletion the user asked for.
  try {
    const { data: files } = await service.storage.from("avatars").list(userId);
    if (files && files.length > 0) {
      await service.storage.from("avatars").remove(files.map((f) => `${userId}/${f.name}`));
    }
  } catch (error) {
    apiLog("delete-account", "avatar_sweep_failed", { userId, message: error instanceof Error ? error.message : "unknown" });
  }

  // Hard delete (false = do not soft-delete). Supabase defaults to hard, but
  // passing it makes the intent unambiguous against a future default change.
  const { error: deleteError } = await service.auth.admin.deleteUser(userId, false);
  if (deleteError) {
    apiLog("delete-account", "auth_delete_failed", { userId, message: deleteError.message });
    return json({ error: "Couldn't delete your account. Try again." }, 500);
  }

  // Don't report success until Auth confirms the user is actually gone.
  const { data: verification } = await service.auth.admin.getUserById(userId);
  if (verification?.user) {
    apiLog("delete-account", "verify_still_present", { userId });
    return json({ error: "Your account could not be fully removed. Try again." }, 500);
  }

  apiLog("delete-account", "deleted", { userId, billingCanceled });
  return json({ ok: true, billingCanceled }, 200);
}

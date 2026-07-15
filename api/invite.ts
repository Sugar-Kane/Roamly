import { createClient } from "@supabase/supabase-js";
import { limitOrResponse } from "./_ratelimit";

// Inlined structured logger (kept local so this function bundles standalone).
// Vercel's per-function bundler doesn't reliably trace the shared ./_log
// import, which crashed this endpoint at load with ERR_MODULE_NOT_FOUND.
// Never log secrets, tokens, or message bodies — ids and outcomes only.
function apiLog(route: string, outcome: string, fields: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({ src: "roamly-api", route, outcome, time: new Date().toISOString(), ...fields }));
  } catch {
    console.log(`roamly-api ${route} ${outcome}`);
  }
}

const GENERAL_DAILY_LIMIT = 5;
const ADMIN_DAILY_LIMIT = 50;
// Global ceiling across ALL users per 24h. Signups are open, so without this,
// N throwaway accounts × 5/day each could pump spam through the app's SMTP
// sender. Kept below Gmail's ~500/day cap but high enough that a launch-day
// burst of legitimate invites can't lock every user out for the day.
const GLOBAL_DAILY_LIMIT = 200;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Invite someone to Roamly by email. If they're already a user, this just
// sends a friend request; otherwise it emails them a Supabase Auth invite and
// pre-creates a pending friend request from the inviter, so they're connected
// the moment they sign up.
export async function POST(request: Request): Promise<Response> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const appUrl = process.env.APP_URL;
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return json({ error: "Invites aren't configured yet." }, 503);
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json({ error: "Missing auth token" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Invalid session" }, 401);
  const inviter = userData.user;

  // Short-window burst guard (Upstash; no-op until configured).
  const rl = await limitOrResponse("invite", inviter.id, 5, 60);
  if (rl) return rl;

  let body: { email?: string; name?: string };
  try { body = await request.json(); } catch { return json({ error: "Invalid request body" }, 400); }
  const email = (body.email ?? "").trim().toLowerCase();
  // Optional invitee name — stored on the pre-created profile so friend lists
  // and notifications show a real name instead of "someone".
  const inviteeName = (body.name ?? "").trim().slice(0, 60);
  if (!EMAIL_RE.test(email)) return json({ error: "Enter a valid email address." }, 400);
  if (email === (inviter.email ?? "").toLowerCase()) return json({ error: "That's your own email." }, 400);

  // Inviter must have claimed a username (same bar as the other social features).
  const { data: inviterProfile } = await admin.from("profiles").select("username").eq("id", inviter.id).single();
  if (!inviterProfile?.username) return json({ error: "Pick a username first so friends can recognize you." }, 400);

  // Rate limit: admins get a higher daily cap.
  const { data: adminRow } = await admin.from("admins").select("user_id").eq("user_id", inviter.id).maybeSingle();
  const limit = adminRow ? ADMIN_DAILY_LIMIT : GENERAL_DAILY_LIMIT;
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("invitations")
    .select("id", { count: "exact", head: true })
    .eq("inviter_id", inviter.id)
    .gte("created_at", dayAgo);
  if ((count ?? 0) >= limit) {
    return json({ error: `You've hit today's invite limit (${limit}). Try again tomorrow.` }, 429);
  }
  const { count: globalCount } = await admin
    .from("invitations")
    .select("id", { count: "exact", head: true })
    .gte("created_at", dayAgo);
  if ((globalCount ?? 0) >= GLOBAL_DAILY_LIMIT) {
    return json({ error: "Invites are busy today — try again tomorrow." }, 429);
  }

  // Already a Roamly user?
  const { data: existing } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  let resend = false;
  if (existing?.id) {
    if (existing.id === inviter.id) return json({ error: "That's your own account." }, 400);

    // A previously invited person who never accepted (invited, zero sign-ins)
    // gets a fresh invite: delete the stale placeholder account (cascades its
    // profile + the old pending friendship/notification) and fall through to
    // re-invite below. Anyone who has ever signed in is a real account and is
    // never deleted — they get a friend request instead.
    const { data: authUser } = await admin.auth.admin.getUserById(existing.id);
    const pendingInvitee = !!authUser?.user && !authUser.user.last_sign_in_at && !!authUser.user.invited_at;
    if (pendingInvitee) {
      // Only the inviter who originally created this placeholder may delete and
      // re-invite it. Otherwise a second inviter could wipe someone else's
      // pending account (and their pending friendship) just by targeting the
      // same unaccepted email. A different inviter instead simply pre-creates
      // their own pending friend request so they connect on signup too.
      const { data: priorInvite } = await admin
        .from("invitations")
        .select("id")
        .eq("inviter_id", inviter.id)
        .eq("invited_user_id", existing.id)
        .limit(1)
        .maybeSingle();
      if (!priorInvite) {
        await admin.from("friendships").insert({ requester: inviter.id, addressee: existing.id, status: "pending" });
        await admin.from("notifications").insert({ user_id: existing.id, actor_id: inviter.id, kind: "friend_request" });
        await admin.from("invitations").insert({ inviter_id: inviter.id, email, invited_user_id: existing.id });
        apiLog("invite", "connected_pending", { inviter: inviter.id });
        return json({ status: "invited", note: "connected_pending" }, 200);
      }
      const { error: delErr } = await admin.auth.admin.deleteUser(existing.id);
      if (delErr) {
        console.warn("[Roamly] invite resend: deleteUser failed", delErr.message);
        return json({ error: "Couldn't resend that invite — try again." }, 500);
      }
      resend = true;
    } else {
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
      const { error: frErr } = await userClient.rpc("send_friend_request", { p_target: existing.id });
      if (frErr) {
        if (frErr.message.includes("already_exists")) return json({ status: "friend_request", note: "already_connected" }, 200);
        return json({ error: "Couldn't send that friend request — try again." }, 500);
      }
      // Record the send so friend requests count against the same daily caps as
      // email invites — otherwise this branch is an uncapped notification spammer.
      await admin.from("invitations").insert({ inviter_id: inviter.id, email, invited_user_id: existing.id });
      return json({ status: "friend_request" }, 200);
    }
  }

  // New person: email them a Supabase Auth invite (creates the auth user).
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    email,
    { ...(appUrl ? { redirectTo: appUrl } : {}), ...(inviteeName ? { data: { display_name: inviteeName } } : {}) }
  );
  if (inviteErr || !invited?.user) {
    console.warn("[Roamly] inviteUserByEmail failed", inviteErr?.message);
    // A race where they signed up between our check and now surfaces here.
    if (inviteErr?.message?.toLowerCase().includes("already been registered")) {
      return json({ error: "That person already has an account — search their email to add them." }, 409);
    }
    return json({ error: "Couldn't send the invite email — try again shortly." }, 502);
  }

  // Put the invitee's name on the pre-created profile (the signup trigger only
  // fills id/email) so they don't appear as "someone" before they join.
  if (inviteeName) {
    await admin.from("profiles").update({ display_name: inviteeName }).eq("id", invited.user.id);
  }

  // Pre-create the pending friend request so they're connected on signup, plus
  // a notification, and record the invitation for rate-limiting/audit.
  await admin.from("friendships").insert({ requester: inviter.id, addressee: invited.user.id, status: "pending" });
  await admin.from("notifications").insert({ user_id: invited.user.id, actor_id: inviter.id, kind: "friend_request" });
  await admin.from("invitations").insert({ inviter_id: inviter.id, email, invited_user_id: invited.user.id });

  apiLog("invite", resend ? "resent" : "invited", { inviter: inviter.id });
  return json(resend ? { status: "invited", note: "resent" } : { status: "invited" }, 200);
}

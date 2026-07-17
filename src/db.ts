import { supabase } from "./supabaseClient";
import type { Task } from "./data";
import type { MissedReason, PlannedStudyDraft, PlannedStudySession, StudyEvent } from "./release3";

export type Profile = {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
  avatar_path?: string | null;
  // A short-lived signed URL generated when the profile is fetched. Only the
  // private storage path is persisted in the database.
  avatar_url?: string | null;
  is_premium: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  daily_goal_minutes: number;
  exam_date: string | null;
  // Which exam the countdown is for (PANCE, EOR, USMLE Step 1, custom…).
  // Optional so the client tolerates the pre-migration schema.
  exam_name?: string | null;
  ai_uploads_count: number;
  ai_uploads_period: string | null;
  // Purchased AI-upload credits (never expire; used after the monthly
  // allowance). Optional so the client tolerates the pre-migration schema.
  ai_credits?: number;
  premium_source?: string | null;
  premium_expires_at?: string | null;
  // True while a Stripe subscription is set to lapse at period end. Premium
  // stays active until premium_expires_at; the UI shows "ends on <date>".
  premium_cancel_at_period_end?: boolean;
  // When true, accepted friends can compare stats without a per-friend request.
  // Optional so the client tolerates the pre-migration schema.
  stats_public?: boolean;
  // The user's chosen app theme, synced across devices. Optional so the client
  // tolerates the pre-migration schema.
  theme?: string | null;
};

const AVATAR_BUCKET = "avatars";

export async function updateProfileAvatar(userId: string, file: File, previousPath?: string | null): Promise<{ path?: string; url?: string; error?: string }> {
  if (!supabase) return { error: "Profile pictures aren't available right now." };
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!allowedTypes.has(file.type)) return { error: "Choose a JPG, PNG, or WebP image." };
  if (file.size > 15 * 1024 * 1024) return { error: "Choose an image smaller than 15 MB." };

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(AVATAR_BUCKET).upload(path, file, {
    cacheControl: "31536000",
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) {
    console.warn("[Roamly] avatar upload failed", uploadError.message);
    return { error: "Couldn't upload that picture. Try another image." };
  }

  const { data: signed, error: signedError } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(path, 60 * 60);
  if (signedError) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    return { error: "Couldn't prepare that profile picture." };
  }
  const { error: profileError } = await supabase.from("profiles").update({ avatar_path: path }).eq("id", userId);
  if (profileError) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    console.warn("[Roamly] avatar profile update failed", profileError.message);
    return { error: "Couldn't save that profile picture." };
  }

  if (previousPath && previousPath !== path) void supabase.storage.from(AVATAR_BUCKET).remove([previousPath]);
  return { path, url: signed.signedUrl };
}

export async function removeProfileAvatar(userId: string, currentPath?: string | null): Promise<{ error?: string }> {
  if (!supabase) return { error: "Profile pictures aren't available right now." };
  const { error } = await supabase.from("profiles").update({ avatar_path: null }).eq("id", userId);
  if (error) {
    console.warn("[Roamly] avatar removal failed", error.message);
    return { error: "Couldn't remove that profile picture." };
  }
  if (currentPath) void supabase.storage.from(AVATAR_BUCKET).remove([currentPath]);
  return {};
}

// Change the caller's display name via the validating set_display_name() RPC.
// Returns null on success, or a user-facing message. display_name is not in the
// client UPDATE grant on profiles, so this must go through the definer RPC.
export async function setDisplayName(name: string): Promise<string | null> {
  if (!supabase) return "Accounts aren't available right now.";
  const { error } = await supabase.rpc("set_display_name", { p_name: name });
  if (!error) return null;
  if (error.message.includes("invalid_display_name")) return "Use 1–40 characters.";
  console.warn("[Roamly] setDisplayName failed", error.message);
  return "Couldn't save that name. Try again.";
}

// Self-service account deletion. Calls the server endpoint with the caller's own
// token; the server cancels billing, sweeps avatar storage, and hard-deletes the
// auth user (everything cascades). On success the caller should sign out — the
// session is now attached to a user that no longer exists.
export async function deleteAccount(): Promise<{ ok?: boolean; billingCanceled?: boolean; error?: string }> {
  if (!supabase) return { error: "Not available right now." };
  const { data: auth } = await supabase.auth.getSession();
  const token = auth.session?.access_token;
  if (!token) return { error: "Your session expired. Sign in again." };
  try {
    const response = await fetch("/api/delete-account", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ confirm: "DELETE" }),
    });
    const result = await response.json() as { ok?: boolean; billingCanceled?: boolean; error?: string };
    if (!response.ok) return { error: result.error || "Couldn't delete your account." };
    return result;
  } catch {
    return { error: "Couldn't reach the server. Check your connection and try again." };
  }
}

// Gather everything the app stores about this user into one JSON object, for a
// "download my data" export. Reads only the caller's own rows (RLS enforces
// this regardless); each table is best-effort so one failure never sinks the
// whole export. Ephemeral/telemetry tables (app_events, room heartbeats) are
// intentionally omitted — this is the user's meaningful personal data.
export async function exportAccountData(userId: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
    user_id: userId,
  };
  if (!supabase) return out;

  const pull = async (key: string, run: () => PromiseLike<{ data: unknown }>) => {
    try { out[key] = (await run()).data ?? []; } catch { out[key] = []; }
  };

  const byUser = (table: string) => () => supabase!.from(table).select("*").eq("user_id", userId);

  await pull("profile", async () => await supabase!.from("profiles").select("*").eq("id", userId).maybeSingle());
  await pull("tasks", byUser("tasks"));
  await pull("focus_sessions", byUser("focus_sessions"));
  await pull("study_session_events", byUser("study_session_events"));
  await pull("planned_study_sessions", byUser("planned_study_sessions"));
  await pull("exam_schedules", byUser("exam_schedules"));
  await pull("gamification_state", async () => await supabase!.from("gamification_state").select("*").eq("user_id", userId).maybeSingle());
  await pull("achievements", byUser("user_achievements"));
  await pull("pets", byUser("user_pets"));
  await pull("rewards", byUser("user_rewards"));
  await pull("notifications", byUser("notifications"));
  await pull("feedback", byUser("feedback"));
  await pull("friendships", async () => await supabase!.from("friendships").select("*").or(`requester.eq.${userId},addressee.eq.${userId}`));

  return out;
}

// Persist the user's chosen theme to their profile so it follows them across
// devices. Best-effort with graceful degradation: if the theme column hasn't
// been migrated in yet, the local copy still keeps the choice on this device.
export async function saveThemePreference(userId: string, theme: string) {
  if (!supabase) return;
  const { error } = await supabase.from("profiles").update({ theme }).eq("id", userId);
  if (error && !error.message.includes("theme")) console.warn("[Roamly] saveThemePreference failed", error.message);
}

export type FocusSessionRow = { date: string; minutes: number };

export type ExamSchedule = {
  id: string;
  user_id: string;
  name: string;
  exam_date: string;
  created_at: string;
  updated_at: string;
};

// ---- Admin ----
// All three RPCs are SECURITY DEFINER and gated by is_admin() server-side, so
// the client checks here are only for showing/hiding the admin UI — a
// non-admin calling them directly gets nothing / an error.
export type AdminUser = {
  id: string; email: string | null; username: string | null; display_name: string | null; is_premium: boolean;
  // Release 12: credit balances + entitlement expiry, so admins can see every
  // user's credits. Optional so the UI tolerates a not-yet-migrated backend.
  ai_credits?: number; ai_uploads_count?: number; ai_uploads_period?: string | null; premium_expires_at?: string | null;
};

export async function checkIsAdmin(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc("is_admin");
  if (error) return false; // function not present yet, or not signed in
  return data === true;
}

export async function adminSearchUsers(query: string): Promise<AdminUser[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_search_users", { p_query: query });
  if (error) { console.warn("[Roamly] adminSearchUsers failed", error.message); return []; }
  return (data ?? []) as AdminUser[];
}

// Server-side paginated user listing for the admin Users tab. Filtering,
// sorting, and the total count all happen in Postgres so the client never
// pulls the whole roster. Returns null when the RPC isn't deployed yet, so
// the UI can fall back to the legacy admin_search_users path.
export type AdminUserListRow = AdminUser & {
  created_at?: string | null;
  last_active?: string | null;
  total_count?: number;
};
export type AdminUserPlanFilter = "all" | "premium" | "free" | "admin";
export type AdminUserActivityFilter = "all" | "active" | "inactive";
export type AdminUserSort = "created_at" | "email" | "name" | "credits" | "last_active";

export async function adminListUsers(params: {
  query: string;
  plan: AdminUserPlanFilter;
  activity: AdminUserActivityFilter;
  sort: AdminUserSort;
  dir: "asc" | "desc";
  limit: number;
  offset: number;
}): Promise<{ rows: AdminUserListRow[]; total: number } | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_list_users", {
    p_query: params.query,
    p_plan: params.plan,
    p_activity: params.activity,
    p_sort: params.sort,
    p_dir: params.dir,
    p_limit: params.limit,
    p_offset: params.offset,
  });
  if (error) { console.warn("[Roamly] adminListUsers failed", error.message); return null; }
  const rows = (data ?? []) as AdminUserListRow[];
  return { rows, total: Number(rows[0]?.total_count ?? 0) };
}

// Admins add or remove ONE purchased credit at a time (server-enforced ±1,
// floored at zero, ledgered + audited). Returns the new balance.
export async function adminAdjustCredits(userId: string, delta: 1 | -1): Promise<{ balance?: number; error?: string }> {
  if (!supabase) return { error: "Not available right now." };
  const { data, error } = await supabase.rpc("admin_adjust_credits", { p_user: userId, p_delta: delta });
  if (!error) return { balance: Number(data) };
  if (error.message.includes("not_admin")) return { error: "You don't have admin access." };
  if (error.message.includes("no_credits")) return { error: "That user has no credits to remove." };
  console.warn("[Roamly] adminAdjustCredits failed", error.message);
  return { error: "Couldn't adjust credits. Try again." };
}

export async function adminGrantPremium(userId: string, months: 1 | 12, reason?: string): Promise<{ expiresAt?: string; error?: string }> {
  if (!supabase) return { error: "Not available right now." };
  const { data, error } = await supabase.rpc("admin_grant_premium", { p_user: userId, p_months: months, p_reason: reason?.trim() || null });
  if (!error) return { expiresAt: data as string };
  if (error.message.includes("not_admin")) return { error: "You don't have admin access." };
  console.warn("[Roamly] adminGrantPremium failed", error.message);
  return { error: "Couldn't grant Premium. Try again." };
}

export async function adminRevokePremium(userId: string): Promise<{ revoked?: number; billingCanceled?: boolean; stripeWarning?: string; error?: string }> {
  if (!supabase) return { error: "Not available right now." };
  const { data: auth } = await supabase.auth.getSession();
  const token = auth.session?.access_token;
  if (!token) return { error: "Your session expired. Sign in again." };
  try {
    const response = await fetch("/api/admin-account", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action: "revoke_premium", userId }),
    });
    const result = await response.json() as { revoked?: number; billingCanceled?: boolean; stripeWarning?: string; error?: string };
    if (!response.ok) return { error: result.error || "Couldn't revoke Premium." };
    return result;
  } catch {
    return { error: "Couldn't reach billing administration. Try again." };
  }
}

// ---- Admin analytics + feedback ----
// Same pattern: SECURITY DEFINER RPCs that return nothing unless the caller
// is in the admins table. All return empty fallbacks when the migration
// hasn't been applied yet.
export type AdminOverview = { total_users: number; premium_users: number; active_7d: number; feedback_total: number };
export type AdminEventStat = { name: string; total: number; users: number; phone: number; pc: number };
export type AdminDailyActivity = { day: string; events: number; active_users: number };
export type AdminUsageUser = {
  id: string; email: string | null; username: string | null; display_name: string | null;
  is_premium: boolean; ai_credits: number; total_events: number; last_active: string | null;
  feature_counts: Record<string, number>;
};
export type AdminOverviewToday = { events_today: number; active_users_today: number; focus_minutes_today: number };
export type FeedbackRow = {
  id: string; email: string | null; username: string | null;
  category: string; message: string; repro: string | null;
  page: string | null; device: string | null; platform: string | null; created_at: string;
  status: string; admin_reply: string | null;
  github_issue_number: number | null; github_issue_url: string | null; updated_at: string;
};

export type UserActivityRow = {
  email: string | null; username: string | null; name: string | null;
  event: string; meta: string | null; device: string | null; created_at: string;
};

export async function adminOverview(): Promise<AdminOverview | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_overview");
  if (error) { console.warn("[Roamly] adminOverview failed", error.message); return null; }
  return ((data ?? [])[0] as AdminOverview) ?? null;
}

export async function adminEventStats(days: number): Promise<AdminEventStat[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_event_stats", { p_days: days });
  if (error) { console.warn("[Roamly] adminEventStats failed", error.message); return []; }
  return (data ?? []) as AdminEventStat[];
}

export async function adminDailyActivity(days: number): Promise<AdminDailyActivity[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_daily_activity", { p_days: days });
  if (error) { console.warn("[Roamly] adminDailyActivity failed", error.message); return []; }
  return (data ?? []) as AdminDailyActivity[];
}

export async function adminUsageUsers(days: number): Promise<AdminUsageUser[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_usage_users", { p_days: days });
  if (error) { console.warn("[Roamly] adminUsageUsers failed", error.message); return []; }
  return (data ?? []) as AdminUsageUser[];
}

export async function adminOverviewToday(): Promise<AdminOverviewToday | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_overview_today");
  if (error) { console.warn("[Roamly] adminOverviewToday failed", error.message); return null; }
  return ((data ?? [])[0] as AdminOverviewToday) ?? null;
}

export async function adminEventStatsToday(): Promise<AdminEventStat[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_event_stats_today");
  if (error) { console.warn("[Roamly] adminEventStatsToday failed", error.message); return []; }
  return (data ?? []) as AdminEventStat[];
}

// ---- Admin BI dashboard (Phase 1) ----
// Read-only, UTC-bucketed aggregates from admin_dashboard_aggregates.sql. Every
// RPC is SECURITY DEFINER + is_admin()-gated, so a non-admin gets nothing. All
// return safe fallbacks when the migration isn't deployed yet.
export type AdminPlanScope = "all" | "free" | "premium";
export type AdminDeviceScope = "all" | "phone" | "tablet" | "pc";

export type AdminKpiSummary = {
  total_users: number; premium_users: number; trial_users: number;
  new_users: number; active_users: number; returning_users: number;
  dau: number; wau: number; mau: number;
  focus_minutes: number; focus_sessions_started: number; focus_blocks_done: number;
  tasks_created: number; tasks_completed: number;
  rooms_created: number; room_joins: number; note_uploads: number;
  credit_purchases: number; feedback_count: number; error_count: number;
};
export type AdminActivityDay = {
  day: string; dau: number; new_users: number; returning_users: number;
  focus_minutes: number; sessions_started: number; sessions_completed: number;
  phone_events: number; tablet_events: number; pc_events: number;
};
export type AdminFunnel = {
  signed_up: number; focused: number; created_task: number;
  started_trial: number; converted_paid: number;
};

// A number the RPCs return as bigint text/number — coerce defensively.
function num(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

export async function adminKpiSummary(
  startISO: string, endISO: string, plan: AdminPlanScope = "all", device: AdminDeviceScope = "all",
): Promise<AdminKpiSummary | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_kpi_summary", {
    p_start: startISO, p_end: endISO, p_plan: plan, p_device: device,
  });
  if (error) { console.warn("[Roamly] adminKpiSummary failed", error.message); return null; }
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, num(v)])) as unknown as AdminKpiSummary;
}

export async function adminActiveSeries(
  startISO: string, endISO: string, plan: AdminPlanScope = "all", device: AdminDeviceScope = "all",
): Promise<AdminActivityDay[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_active_series", {
    p_start: startISO, p_end: endISO, p_plan: plan, p_device: device,
  });
  if (error) { console.warn("[Roamly] adminActiveSeries failed", error.message); return []; }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    day: String(r.day),
    dau: num(r.dau), new_users: num(r.new_users), returning_users: num(r.returning_users),
    focus_minutes: num(r.focus_minutes), sessions_started: num(r.sessions_started), sessions_completed: num(r.sessions_completed),
    phone_events: num(r.phone_events), tablet_events: num(r.tablet_events), pc_events: num(r.pc_events),
  }));
}

export async function adminConversionFunnel(startISO: string, endISO: string): Promise<AdminFunnel | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("admin_conversion_funnel", { p_start: startISO, p_end: endISO });
  if (error) { console.warn("[Roamly] adminConversionFunnel failed", error.message); return null; }
  const row = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    signed_up: num(row.signed_up), focused: num(row.focused), created_task: num(row.created_task),
    started_trial: num(row.started_trial), converted_paid: num(row.converted_paid),
  };
}

// ---- Admin BI dashboard (Phase 2: Features + Engagement) ----
export type AdminFeatureStat = {
  name: string; total: number; unique_users: number; free_uses: number; premium_uses: number;
  phone: number; tablet: number; pc: number; last_at: string | null; prev_total: number;
};
export type AdminFeatureTrendPoint = { day: string; uses: number };
export type AdminHeatCell = { dow: number; hour: number; events: number };
export type AdminCohortRow = { cohort_week: string; cohort_size: number; week_offset: number; retained: number };

export async function adminFeatureStats(
  startISO: string, endISO: string, prevStartISO: string, prevEndISO: string,
  plan: AdminPlanScope = "all", device: AdminDeviceScope = "all",
): Promise<AdminFeatureStat[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_feature_stats_v2", {
    p_start: startISO, p_end: endISO, p_prev_start: prevStartISO, p_prev_end: prevEndISO, p_plan: plan, p_device: device,
  });
  if (error) { console.warn("[Roamly] adminFeatureStats failed", error.message); return []; }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    name: String(r.name), total: num(r.total), unique_users: num(r.unique_users),
    free_uses: num(r.free_uses), premium_uses: num(r.premium_uses),
    phone: num(r.phone), tablet: num(r.tablet), pc: num(r.pc),
    last_at: r.last_at ? String(r.last_at) : null, prev_total: num(r.prev_total),
  }));
}

export async function adminFeatureTrend(name: string, startISO: string, endISO: string): Promise<AdminFeatureTrendPoint[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_feature_trend", { p_name: name, p_start: startISO, p_end: endISO });
  if (error) { console.warn("[Roamly] adminFeatureTrend failed", error.message); return []; }
  return (data ?? []).map((r: Record<string, unknown>) => ({ day: String(r.day), uses: num(r.uses) }));
}

export async function adminActivityHeatmap(
  startISO: string, endISO: string, plan: AdminPlanScope = "all", device: AdminDeviceScope = "all",
): Promise<AdminHeatCell[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_activity_heatmap", { p_start: startISO, p_end: endISO, p_plan: plan, p_device: device });
  if (error) { console.warn("[Roamly] adminActivityHeatmap failed", error.message); return []; }
  return (data ?? []).map((r: Record<string, unknown>) => ({ dow: num(r.dow), hour: num(r.hour), events: num(r.events) }));
}

export async function adminRetentionCohorts(weeks = 8): Promise<AdminCohortRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_retention_cohorts", { p_weeks: weeks });
  if (error) { console.warn("[Roamly] adminRetentionCohorts failed", error.message); return []; }
  return (data ?? []).map((r: Record<string, unknown>) => ({
    cohort_week: String(r.cohort_week), cohort_size: num(r.cohort_size), week_offset: num(r.week_offset), retained: num(r.retained),
  }));
}

// Permanent account deletion (admin only). Server cancels Stripe billing first
// and audits the action; the auth delete cascades through every app table.
export async function adminDeleteUser(userId: string): Promise<{ ok?: boolean; billingCanceled?: boolean; stripeWarning?: string; error?: string }> {
  if (!supabase) return { error: "Not available right now." };
  const { data: auth } = await supabase.auth.getSession();
  const token = auth.session?.access_token;
  if (!token) return { error: "Your session expired. Sign in again." };
  try {
    const response = await fetch("/api/admin-account", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ action: "delete_user", userId }),
    });
    const result = await response.json() as { ok?: boolean; billingCanceled?: boolean; stripeWarning?: string; error?: string };
    if (!response.ok) return { error: result.error || "Couldn't delete the account." };
    return result;
  } catch {
    return { error: "Couldn't reach account administration. Try again." };
  }
}

export async function adminListFeedback(limit = 50): Promise<FeedbackRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_list_feedback", { p_limit: limit });
  if (error) { console.warn("[Roamly] adminListFeedback failed", error.message); return []; }
  return (data ?? []) as FeedbackRow[];
}

// ---- Ad submissions (advertiser interest from the break-time prompt) ----
export type AdType = "tiktok" | "reel" | "business_video" | "image_billboard";
export type AdPlan = "image_weekly" | "short_video_weekly" | "business_video_weekly";
export type AdStatus = "new" | "reviewing" | "approved" | "rejected" | "live" | "ended";

export type AdSubmissionRow = {
  id: string; email: string | null; username: string | null;
  ad_type: AdType; business_name: string; target_url: string; contact_email: string;
  plan: AdPlan; note: string | null; status: AdStatus; created_at: string; updated_at: string;
};

// Insert an advertiser submission (RLS: insert-own). Returns { id } or { error }.
export async function submitAdSubmission(userId: string, fields: {
  ad_type: AdType; business_name: string; target_url: string;
  contact_email: string; plan: AdPlan; note?: string | null;
}): Promise<{ id?: string; error?: string }> {
  if (!supabase) return { error: "Ad submissions aren't available right now." };
  const { data, error } = await supabase
    .from("ad_submissions")
    .insert({ user_id: userId, ...fields })
    .select("id")
    .single();
  if (!error) return { id: (data as { id: string }).id };
  if (error.message.includes("does not exist")) return { error: "Ad submissions aren't set up yet. Check back soon." };
  console.warn("[Roamly] submitAdSubmission failed", error.message);
  return { error: "Couldn't send that. Try again." };
}

export async function adminListAdSubmissions(limit = 100): Promise<AdSubmissionRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_list_ad_submissions", { p_limit: limit });
  if (error) { console.warn("[Roamly] adminListAdSubmissions failed", error.message); return []; }
  return (data ?? []) as AdSubmissionRow[];
}

export async function adminSetAdSubmissionStatus(id: string, status: AdStatus): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not available." };
  const { error } = await supabase.rpc("admin_set_ad_submission_status", { p_id: id, p_status: status });
  if (error) { console.warn("[Roamly] adminSetAdSubmissionStatus failed", error.message); return { error: "Couldn't update the status." }; }
  return {};
}

export async function adminDeleteAdSubmission(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: "Not available." };
  const { error } = await supabase.rpc("admin_delete_ad_submission", { p_id: id });
  if (error) { console.warn("[Roamly] adminDeleteAdSubmission failed", error.message); return { error: "Couldn't delete that." }; }
  return {};
}

export async function adminUserActivity(query: string, limit = 200): Promise<UserActivityRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_user_activity", { p_query: query, p_limit: limit });
  if (error) { console.warn("[Roamly] adminUserActivity failed", error.message); return []; }
  return (data ?? []) as UserActivityRow[];
}

// Admin ticket actions (reply / status / delete) go through the service-role
// endpoint so they can also sync the linked GitHub issue. Returns an error
// string on failure, null on success.
export async function adminFeedbackAction(
  action: "reply" | "status" | "delete",
  id: string,
  fields?: { status?: string; reply?: string },
): Promise<string | null> {
  const token = await getAccessToken();
  if (!token) return "Sign in again to manage feedback.";
  try {
    const res = await fetch("/api/admin-feedback", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action, id, ...fields }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? "Couldn't update that ticket. Try again.";
  } catch {
    return "Couldn't reach the server. Try again soon.";
  }
}

export type ErrorRow = {
  id: string; email: string | null; username: string | null;
  message: string; stack: string | null; page: string | null;
  device: string | null; platform: string | null; created_at: string;
};

export async function adminListErrors(limit = 100): Promise<ErrorRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("admin_list_errors", { p_limit: limit });
  if (error) { console.warn("[Roamly] adminListErrors failed", error.message); return []; }
  return (data ?? []) as ErrorRow[];
}

// Returns { id } on success (used to fire the GitHub-issue mirror), or
// { error } with a user-facing message.
export async function submitFeedback(userId: string, fields: {
  category: string; message: string; repro?: string | null;
  page?: string; device?: string; platform?: string;
}): Promise<{ id?: string; error?: string }> {
  if (!supabase) return { error: "Feedback isn't available right now." };
  const { data, error } = await supabase
    .from("feedback")
    .insert({ user_id: userId, ...fields })
    .select("id")
    .single();
  if (!error) return { id: (data as { id: string }).id };
  if (error.message.includes("does not exist")) return { error: "Feedback isn't set up yet. Check back soon." };
  console.warn("[Roamly] submitFeedback failed", error.message);
  return { error: "Couldn't send that. Try again." };
}

// Best-effort: mirror a just-submitted feedback row to a GitHub issue so it
// becomes a trackable ticket. No-ops silently if the server isn't configured
// with a GitHub token — the feedback is already saved either way.
export async function mirrorFeedbackToGitHub(id: string): Promise<void> {
  const token = await getAccessToken();
  if (!token) return;
  try {
    await fetch("/api/feedback-github", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ id }),
    });
  } catch {
    // Non-fatal — the ticket just won't have a GitHub issue yet.
  }
}

// ---- Invites ----
// Invite someone by email (api/invite). Returns { status } on success —
// "invited" (email sent) or "friend_request" (they're already a user) — or
// { error } with a user-facing message.
export type InviteResult = { status?: "invited" | "friend_request"; error?: string; note?: string };

export async function sendInvite(email: string, name?: string): Promise<InviteResult> {
  const token = await getAccessToken();
  if (!token) return { error: "Sign in to invite people." };
  try {
    const res = await fetch("/api/invite", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ email, name: name?.trim() || undefined }),
    });
    const data = (await res.json().catch(() => ({}))) as InviteResult;
    if (!res.ok) return { error: data.error ?? "Couldn't send that invite. Try again." };
    return data;
  } catch {
    return { error: "Couldn't reach the server. Try again soon." };
  }
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
  if (error) { console.warn("[Roamly] fetchProfile failed", error.message); return null; }
  const profile = data as Profile;
  if (profile.avatar_path) {
    const { data: signed } = await supabase.storage.from(AVATAR_BUCKET).createSignedUrl(profile.avatar_path, 60 * 60);
    profile.avatar_url = signed?.signedUrl ?? null;
  }
  const { data: entitlement, error: entitlementError } = await supabase.rpc("get_my_premium_entitlement");
  if (!entitlementError) {
    const row = (entitlement as Array<{ is_premium: boolean; source: string | null; expires_at: string | null; cancel_at_period_end?: boolean }> | null)?.[0];
    if (row) {
      profile.is_premium = row.is_premium;
      profile.premium_source = row.source;
      profile.premium_expires_at = row.expires_at;
      profile.premium_cancel_at_period_end = row.cancel_at_period_end === true;
    }
  }
  return profile;
}

// NOTE the explicit .eq(id) filter: without it this update silently fails
// (production data showed every profile still at the defaults — goals and
// exam dates never persisted while the optimistic UI looked saved).
export async function updateGoalAndExam(userId: string, fields: { daily_goal_minutes?: number; exam_date?: string | null; exam_name?: string | null }) {
  if (!supabase) return;
  let { error } = await supabase.from("profiles").update(fields).eq("id", userId);
  // If the exam_name column hasn't been migrated in yet, retry without it —
  // saving the date always beats losing the whole update.
  if (error && fields.exam_name !== undefined && error.message.includes("exam_name")) {
    const { exam_name: _dropped, ...rest } = fields;
    if (Object.keys(rest).length > 0) ({ error } = await supabase.from("profiles").update(rest).eq("id", userId));
  }
  if (error) console.warn("[Roamly] updateGoalAndExam failed", error.message);
}

export async function fetchExamSchedules(userId: string): Promise<ExamSchedule[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("exam_schedules")
    .select("id,user_id,name,exam_date,created_at,updated_at")
    .eq("user_id", userId)
    .order("exam_date", { ascending: true });
  if (error) {
    console.warn("[Roamly] fetchExamSchedules failed", error.message);
    return [];
  }
  return (data ?? []) as ExamSchedule[];
}

export async function createExamSchedule(userId: string, name: string, examDate: string): Promise<ExamSchedule | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("exam_schedules")
    .insert({ user_id: userId, name: name.trim().slice(0, 60), exam_date: examDate })
    .select("id,user_id,name,exam_date,created_at,updated_at")
    .single();
  if (error) {
    console.warn("[Roamly] createExamSchedule failed", error.message);
    return null;
  }
  return data as ExamSchedule;
}

export async function updateExamSchedule(id: string, fields: { name: string; exam_date: string }): Promise<ExamSchedule | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("exam_schedules")
    .update({ name: fields.name.trim().slice(0, 60), exam_date: fields.exam_date, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id,user_id,name,exam_date,created_at,updated_at")
    .single();
  if (error) {
    console.warn("[Roamly] updateExamSchedule failed", error.message);
    return null;
  }
  return data as ExamSchedule;
}

export async function deleteExamSchedule(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("exam_schedules").delete().eq("id", id);
  if (error) console.warn("[Roamly] deleteExamSchedule failed", error.message);
  return !error;
}

export async function logFocusMinutes(date: string, minutes: number) {
  if (!supabase) return;
  const { error } = await supabase.rpc("log_focus_minutes", { p_date: date, p_minutes: minutes });
  if (error) console.warn("[Roamly] logFocusMinutes failed", error.message);
}

export async function recordFocusSession(date: string, minutes: number, task: Task | undefined, kind: StudyEvent["session_kind"], groupSize = 1): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.rpc("record_focus_session", {
    p_date: date, p_minutes: minutes, p_task: task?.id ?? null,
    p_task_title: task?.title ?? null, p_category: task?.tag || "Uncategorized", p_kind: kind,
    p_group_size: Math.max(1, Math.round(groupSize)),
  });
  if (error) { console.warn("[Roamly] recordFocusSession failed", error.message); return false; }
  return true;
}

export async function fetchStudyEvents(userId: string): Promise<StudyEvent[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("study_session_events").select("id, task_id, task_title, category, minutes, session_kind, completed_at").eq("user_id", userId).order("completed_at", { ascending: false }).limit(1000);
  if (error) { console.warn("[Roamly] fetchStudyEvents failed", error.message); return []; }
  return (data ?? []) as StudyEvent[];
}

export async function fetchPlannedStudySessions(userId: string): Promise<PlannedStudySession[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("planned_study_sessions").select("*").eq("user_id", userId).order("scheduled_for", { ascending: false }).limit(100);
  if (error) { console.warn("[Roamly] fetchPlannedStudySessions failed", error.message); return []; }
  return (data ?? []) as PlannedStudySession[];
}

export async function createPlannedStudySession(userId: string, row: PlannedStudyDraft): Promise<PlannedStudySession | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("planned_study_sessions").insert({ ...row, user_id: userId }).select("*").single();
  if (error) { console.warn("[Roamly] createPlannedStudySession failed", error.message); return null; }
  return data as PlannedStudySession;
}

export type PlannedStudyUpdate = Partial<PlannedStudyDraft> & {
  status?: PlannedStudySession["status"];
  missed_reason?: MissedReason | null;
};

export async function updatePlannedStudySession(id: string, fields: PlannedStudyUpdate): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("planned_study_sessions").update({ ...fields, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) { console.warn("[Roamly] updatePlannedStudySession failed", error.message); return false; }
  return true;
}

export async function deletePlannedStudySession(id: string): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.from("planned_study_sessions").delete().eq("id", id);
  if (error) { console.warn("[Roamly] deletePlannedStudySession failed", error.message); return false; }
  return true;
}

export async function fetchRecentSessions(userId: string, days = 36_500): Promise<FocusSessionRow[]> {
  if (!supabase) return [];
  const since = new Date();
  since.setDate(since.getDate() - days);
  const y = since.getFullYear();
  const m = String(since.getMonth() + 1).padStart(2, "0");
  const d = String(since.getDate()).padStart(2, "0");
  const { data, error } = await supabase
    .from("focus_sessions")
    .select("date, minutes")
    .eq("user_id", userId)
    .gte("date", `${y}-${m}-${d}`)
    .order("date", { ascending: false });
  if (error) { console.warn("[Roamly] fetchRecentSessions failed", error.message); return []; }
  return (data ?? []) as FocusSessionRow[];
}

// Fold work done in guest (signed-out) mode into a freshly signed-in account.
// Called once on sign-in when local guest data is present; the caller clears
// guest storage immediately afterward so this can never run twice (a second run
// would double each migrated day's minutes). Best-effort per item — a single
// failed row must not abort the rest. The task list and per-day focus minutes
// (which drive the streak) are migrated. Guest study-insights events are also
// carried over, but inserted DIRECTLY into study_session_events — never through
// record_focus_session — so the per-day totals that log_focus_minutes already
// reconstructs aren't double-counted. Carrying the events preserves the
// signed-in session count, category breakdown, and gamification XP/pets that
// derive from study_session_events. task_id is dropped (guest ids don't exist
// server-side); task_title/category are kept.
export async function migrateGuestDataToAccount(
  userId: string,
  guestTasks: Task[],
  guestSessions: FocusSessionRow[],
  guestStudyEvents: StudyEvent[] = [],
): Promise<void> {
  if (!supabase) return;
  for (let i = 0; i < guestTasks.length; i++) {
    const g = guestTasks[i];
    const created = await createTask(userId, g.title, g.tag, i + 1);
    if (created && (g.done || g.poms > 0 || g.est > 0)) {
      await updateTask(created.id, {
        ...(g.done ? { done: true } : {}),
        ...(g.poms > 0 ? { poms: g.poms } : {}),
        ...(g.est > 0 ? { est: g.est } : {}),
      });
    }
  }
  for (const s of guestSessions) {
    if (s.minutes > 0) await logFocusMinutes(s.date, s.minutes);
  }
  const events = guestStudyEvents.filter((e) => e.minutes > 0);
  if (events.length > 0) {
    const { error } = await supabase.from("study_session_events").insert(
      events.map((e) => ({
        user_id: userId,
        task_id: null,
        task_title: e.task_title,
        category: e.category || "Uncategorized",
        minutes: e.minutes,
        session_kind: e.session_kind,
        completed_at: e.completed_at,
      }))
    );
    if (error) console.warn("[Roamly] migrate guest study events failed", error.message);
  }
}

export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

// select("*") on purpose: extra columns are harmless, and it keeps fetches
// working whether or not the optional sort_order column has been added yet.
const TASK_COLUMNS = "*";

export async function fetchTasks(userId: string): Promise<Task[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) { console.warn("[Roamly] fetchTasks failed", error.message); return []; }
  return (data ?? []) as Task[];
}

export async function createTask(userId: string, title: string, tag: string, sortOrder?: number, est = 1): Promise<Task | null> {
  if (!supabase) return null;
  const clampedEst = Math.max(1, Math.min(9, Math.round(est)));
  let res = await supabase
    .from("tasks")
    // est defaults to 1 — done in a single focus session unless the user says
    // otherwise at creation (overrides the older DB column default of 2).
    .insert({ user_id: userId, title, tag, est: clampedEst, ...(sortOrder != null ? { sort_order: sortOrder } : {}) })
    .select(TASK_COLUMNS)
    .single();
  // If the sort_order column hasn't been migrated in yet, retry without it —
  // adding the task always beats preserving its position.
  if (res.error && sortOrder != null && res.error.message.includes("sort_order")) {
    res = await supabase.from("tasks").insert({ user_id: userId, title, tag, est: clampedEst }).select(TASK_COLUMNS).single();
  }
  if (res.error) { console.warn("[Roamly] createTask failed", res.error.message); return null; }
  return res.data as Task;
}

export async function updateTask(id: string, fields: Partial<{ title: string; tag: string; done: boolean; poms: number; est: number; sort_order: number }>) {
  if (!supabase) return;
  const { error } = await supabase.from("tasks").update(fields).eq("id", id);
  if (error) console.warn("[Roamly] updateTask failed", error.message);
}

export async function deleteTask(id: string) {
  if (!supabase) return;
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) console.warn("[Roamly] deleteTask failed", error.message);
}

const STUDY_UPLOADS_BUCKET = "study-uploads";

// Uploads directly to Supabase Storage (client -> Storage), bypassing Vercel's
// 4.5MB serverless request-body limit entirely. The server only ever handles
// a short storage path, not the file bytes.
export async function uploadStudyMaterial(userId: string, file: File): Promise<string | null> {
  if (!supabase) return null;
  const ext = (file.name.split(".").pop() || "bin").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) || "bin";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(STUDY_UPLOADS_BUCKET).upload(path, file, { contentType: file.type });
  if (error) { console.warn("[Roamly] uploadStudyMaterial failed", error.message); return null; }
  return path;
}

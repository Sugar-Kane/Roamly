import { supabase } from "./supabaseClient";
import type { Task } from "./data";
import type { MissedReason, PlannedStudyDraft, PlannedStudySession, StudyEvent } from "./release3";

export type Profile = {
  id: string;
  email: string | null;
  username: string | null;
  display_name: string | null;
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
};

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
export type AdminUser = { id: string; email: string | null; username: string | null; display_name: string | null; is_premium: boolean };

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

export async function adminGrantPremium(userId: string, months: 1 | 12, reason?: string): Promise<{ expiresAt?: string; error?: string }> {
  if (!supabase) return { error: "Not available right now." };
  const { data, error } = await supabase.rpc("admin_grant_premium", { p_user: userId, p_months: months, p_reason: reason?.trim() || null });
  if (!error) return { expiresAt: data as string };
  if (error.message.includes("not_admin")) return { error: "You don't have admin access." };
  console.warn("[Roamly] adminGrantPremium failed", error.message);
  return { error: "Couldn't grant Premium — try again." };
}

export async function adminRevokePremium(userId: string): Promise<{ revoked?: number; billingCanceled?: boolean; stripeWarning?: string; error?: string }> {
  if (!supabase) return { error: "Not available right now." };
  const { data: auth } = await supabase.auth.getSession();
  const token = auth.session?.access_token;
  if (!token) return { error: "Your session expired. Sign in again." };
  try {
    const response = await fetch("/api/admin-revoke-premium", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ userId }),
    });
    const result = await response.json() as { revoked?: number; billingCanceled?: boolean; stripeWarning?: string; error?: string };
    if (!response.ok) return { error: result.error || "Couldn't revoke Premium." };
    return result;
  } catch {
    return { error: "Couldn't reach billing administration — try again." };
  }
}

// ---- Admin analytics + feedback ----
// Same pattern: SECURITY DEFINER RPCs that return nothing unless the caller
// is in the admins table. All return empty fallbacks when the migration
// hasn't been applied yet.
export type AdminOverview = { total_users: number; premium_users: number; active_7d: number; feedback_total: number };
export type AdminEventStat = { name: string; total: number; users: number; phone: number; pc: number };
export type AdminDailyActivity = { day: string; events: number; active_users: number };
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
  if (error.message.includes("does not exist")) return { error: "Ad submissions aren't set up yet — check back soon." };
  console.warn("[Roamly] submitAdSubmission failed", error.message);
  return { error: "Couldn't send that — try again." };
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
    return data.error ?? "Couldn't update that ticket — try again.";
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
  if (error.message.includes("does not exist")) return { error: "Feedback isn't set up yet — check back soon." };
  console.warn("[Roamly] submitFeedback failed", error.message);
  return { error: "Couldn't send that — try again." };
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
    if (!res.ok) return { error: data.error ?? "Couldn't send that invite — try again." };
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
  const { data: entitlement, error: entitlementError } = await supabase.rpc("get_my_premium_entitlement");
  if (!entitlementError) {
    const row = (entitlement as Array<{ is_premium: boolean; source: string | null; expires_at: string | null }> | null)?.[0];
    if (row) {
      profile.is_premium = row.is_premium;
      profile.premium_source = row.source;
      profile.premium_expires_at = row.expires_at;
    }
  }
  return profile;
}

export async function startPremiumTrial(): Promise<boolean> {
  const token = await getAccessToken();
  if (!token) return false;
  try {
    const response = await fetch("/api/start-trial", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    return response.ok;
  } catch {
    return false;
  }
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

export async function recordFocusSession(date: string, minutes: number, task: Task | undefined, kind: StudyEvent["session_kind"]): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.rpc("record_focus_session", {
    p_date: date, p_minutes: minutes, p_task: task?.id ?? null,
    p_task_title: task?.title ?? null, p_category: task?.tag || "Uncategorized", p_kind: kind,
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
// failed row must not abort the rest. Only the two non-overlapping guest
// sources are migrated: the task list and the per-day focus minutes that drive
// the streak. (Guest study-insights events aren't carried over, to avoid
// double-counting the daily totals that log_focus_minutes already reconstructs.)
export async function migrateGuestDataToAccount(
  userId: string,
  guestTasks: Task[],
  guestSessions: FocusSessionRow[],
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

export async function createTask(userId: string, title: string, tag: string, sortOrder?: number): Promise<Task | null> {
  if (!supabase) return null;
  let res = await supabase
    .from("tasks")
    // est: 1 — a task is done in a single focus session unless the user says
    // otherwise (overrides the older DB column default of 2).
    .insert({ user_id: userId, title, tag, est: 1, ...(sortOrder != null ? { sort_order: sortOrder } : {}) })
    .select(TASK_COLUMNS)
    .single();
  // If the sort_order column hasn't been migrated in yet, retry without it —
  // adding the task always beats preserving its position.
  if (res.error && sortOrder != null && res.error.message.includes("sort_order")) {
    res = await supabase.from("tasks").insert({ user_id: userId, title, tag }).select(TASK_COLUMNS).single();
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

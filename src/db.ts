import { supabase } from "./supabaseClient";
import type { Task } from "./data";

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
  ai_uploads_count: number;
  ai_uploads_period: string | null;
};

export type FocusSessionRow = { date: string; minutes: number };

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

export async function adminSetPremium(userId: string, premium: boolean): Promise<string | null> {
  if (!supabase) return "Not available right now.";
  const { error } = await supabase.rpc("admin_set_premium", { p_user: userId, p_premium: premium });
  if (!error) return null;
  if (error.message.includes("not_admin")) return "You don't have admin access.";
  console.warn("[Roamly] adminSetPremium failed", error.message);
  return "Couldn't update that account — try again.";
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
  return data as Profile;
}

export async function updateGoalAndExam(fields: { daily_goal_minutes?: number; exam_date?: string | null }) {
  if (!supabase) return;
  const { error } = await supabase.from("profiles").update(fields);
  if (error) console.warn("[Roamly] updateGoalAndExam failed", error.message);
}

export async function logFocusMinutes(date: string, minutes: number) {
  if (!supabase) return;
  const { error } = await supabase.rpc("log_focus_minutes", { p_date: date, p_minutes: minutes });
  if (error) console.warn("[Roamly] logFocusMinutes failed", error.message);
}

export async function fetchRecentSessions(userId: string, days = 60): Promise<FocusSessionRow[]> {
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
    .insert({ user_id: userId, title, tag, ...(sortOrder != null ? { sort_order: sortOrder } : {}) })
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

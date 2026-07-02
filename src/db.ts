import { supabase } from "./supabaseClient";
import type { Task } from "./data";

export type Profile = {
  id: string;
  email: string | null;
  is_premium: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  daily_goal_minutes: number;
  exam_date: string | null;
};

export type FocusSessionRow = { date: string; minutes: number };

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

const TASK_COLUMNS = "id, title, tag, done, poms, est";

export async function fetchTasks(userId: string): Promise<Task[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) { console.warn("[Roamly] fetchTasks failed", error.message); return []; }
  return (data ?? []) as Task[];
}

export async function createTask(userId: string, title: string, tag: string): Promise<Task | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("tasks")
    .insert({ user_id: userId, title, tag })
    .select(TASK_COLUMNS)
    .single();
  if (error) { console.warn("[Roamly] createTask failed", error.message); return null; }
  return data as Task;
}

export async function updateTask(id: string, fields: Partial<{ title: string; tag: string; done: boolean; poms: number; est: number }>) {
  if (!supabase) return;
  const { error } = await supabase.from("tasks").update(fields).eq("id", id);
  if (error) console.warn("[Roamly] updateTask failed", error.message);
}

export async function deleteTask(id: string) {
  if (!supabase) return;
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) console.warn("[Roamly] deleteTask failed", error.message);
}

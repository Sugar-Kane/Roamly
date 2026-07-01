import { supabase } from "./supabaseClient";

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

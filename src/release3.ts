import { loadPref, savePref } from "./storage";

export type StudyEvent = {
  id: string;
  task_id: string | null;
  task_title: string | null;
  category: string;
  minutes: number;
  session_kind: "countdown" | "count_up" | "room";
  completed_at: string;
};

export type MissedReason = "Traveling" | "Sick" | "Too vague" | "Bad timing" | "Too tired" | "Schedule conflict" | "Forgot" | "Lost motivation" | "Too difficult" | "Other";
export const MISSED_REASONS: MissedReason[] = ["Traveling", "Sick", "Too vague", "Bad timing", "Too tired", "Schedule conflict", "Forgot", "Lost motivation", "Too difficult", "Other"];

export type PlannedStudySession = {
  id: string;
  user_id?: string;
  task_id: string | null;
  task_title: string | null;
  category: string;
  scheduled_for: string;
  expected_minutes: number;
  status: "planned" | "completed" | "missed";
  missed_reason: MissedReason | null;
};

const EVENTS_KEY = "roamly-guest-study-events-v1";
const PLANS_KEY = "roamly-guest-study-plans-v1";

function read<T>(key: string): T[] {
  try { const value = JSON.parse(loadPref(key) ?? "[]"); return Array.isArray(value) ? value : []; }
  catch { return []; }
}

export const loadGuestStudyEvents = () => read<StudyEvent>(EVENTS_KEY).slice(-500);
export const saveGuestStudyEvents = (rows: StudyEvent[]) => savePref(EVENTS_KEY, JSON.stringify(rows.slice(-500)));
export const loadGuestStudyPlans = () => read<PlannedStudySession>(PLANS_KEY).slice(-100);
export const saveGuestStudyPlans = (rows: PlannedStudySession[]) => savePref(PLANS_KEY, JSON.stringify(rows.slice(-100)));

export function newStudyEvent(minutes: number, task?: { id: string; title: string; tag: string }, kind: StudyEvent["session_kind"] = "countdown"): StudyEvent {
  return { id: crypto.randomUUID(), task_id: task?.id ?? null, task_title: task?.title ?? null, category: task?.tag || "Uncategorized", minutes, session_kind: kind, completed_at: new Date().toISOString() };
}

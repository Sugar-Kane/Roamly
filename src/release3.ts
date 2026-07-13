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

export type PlannedStudyTarget = "task" | "category";

export type PlannedStudySession = {
  id: string;
  user_id?: string;
  task_id: string | null;
  task_title: string | null;
  category: string;
  target_type: PlannedStudyTarget;
  include_all_category_tasks: boolean;
  included_task_ids: string[];
  included_task_titles: string[];
  scheduled_for: string;
  expected_minutes: number;
  status: "planned" | "completed" | "missed";
  missed_reason: MissedReason | null;
};

export type PlannedStudyDraft = Pick<PlannedStudySession,
  "task_id" | "task_title" | "category" | "target_type" |
  "include_all_category_tasks" | "included_task_ids" | "included_task_titles" |
  "scheduled_for" | "expected_minutes"
>;

export type PlannedStudyInvite = {
  id: string;
  plan_id: string;
  inviter_id: string;
  invitee_id: string;
  status: "pending" | "accepted" | "declined";
  created_at: string;
  updated_at: string;
  plan?: PlannedStudySession;
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

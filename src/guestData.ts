import type { Task } from "./data";
import type { FocusSession } from "./streaks";
import { loadPref, savePref } from "./storage";

export const GUEST_TASK_LIMIT = 5;

const TASKS_KEY = "roamly-guest-tasks-v1";
const SESSIONS_KEY = "roamly-guest-sessions-v1";

function readArray<T>(key: string): T[] {
  const raw = loadPref(key);
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value as T[] : [];
  } catch {
    return [];
  }
}

export function loadGuestTasks(): Task[] {
  return readArray<Task>(TASKS_KEY).slice(0, GUEST_TASK_LIMIT);
}

export function saveGuestTasks(tasks: Task[]): void {
  savePref(TASKS_KEY, JSON.stringify(tasks.slice(0, GUEST_TASK_LIMIT)));
}

export function loadGuestSessions(): FocusSession[] {
  return readArray<FocusSession>(SESSIONS_KEY)
    .filter((session) => typeof session.date === "string" && Number.isFinite(session.minutes) && session.minutes > 0)
    .slice(-60);
}

export function saveGuestSessions(sessions: FocusSession[]): void {
  savePref(SESSIONS_KEY, JSON.stringify(sessions.slice(-60)));
}

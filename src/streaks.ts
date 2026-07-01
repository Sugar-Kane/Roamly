export type FocusSession = { date: string; minutes: number };

// Local Y-M-D key — deliberately NOT toISOString(), which is UTC and would
// shift the date near midnight for any non-UTC timezone.
export const dateKey = (d: Date = new Date()): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Merges into today's entry if one exists, else appends.
export function addSession(sessions: FocusSession[], minutes: number): FocusSession[] {
  if (minutes <= 0) return sessions;
  const today = dateKey();
  const existing = sessions.find((s) => s.date === today);
  return existing
    ? sessions.map((s) => (s.date === today ? { ...s, minutes: s.minutes + minutes } : s))
    : [...sessions, { date: today, minutes }];
}

export function minutesToday(sessions: FocusSession[]): number {
  return sessions.find((s) => s.date === dateKey())?.minutes ?? 0;
}

// Consecutive-day streak, counted backward from today.
// Rule: if today has no session yet, the streak is still "alive" as long as
// yesterday has one — it just starts counting from yesterday, so the badge
// doesn't drop to 0 the instant midnight passes and before today's first
// session lands. If neither today nor yesterday has a session, streak is 0.
export function computeStreak(sessions: FocusSession[]): number {
  const byDate = new Set(sessions.filter((s) => s.minutes > 0).map((s) => s.date));
  const cursor = new Date();
  if (!byDate.has(dateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!byDate.has(dateKey(cursor))) return 0;
  }
  let streak = 0;
  while (byDate.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

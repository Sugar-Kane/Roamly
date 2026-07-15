// Personalized motivation for the personal focus timer.
//
// One message per genuinely NEW focus session: the session boundary is
// "running flipped on while in the focus phase and no session is active".
// Pause/resume keeps the same session (and message); leaving the focus phase
// (natural completion, skip) or resetting back to the full duration ends the
// session, so the next start generates a fresh message. A ref-based session
// guard means re-renders and effect re-runs can never fire duplicate
// requests.
//
// The timer never waits on the AI: a local fallback shows immediately and is
// replaced when (and only if) the request for the SAME session succeeds.
// Guests skip the network entirely and keep the local fallback, matching the
// account-only scope of the other AI features.
import { useEffect, useRef, useState } from "react";
import { getAccessToken, type ExamSchedule } from "./db";
import type { Task } from "./data";

export type MotivationContext = {
  task?: { title: string; tag: string };
  exam?: { name: string; daysLeft: number };
  topics?: string[];
};

// Calm, specific-ish local fallbacks. Shown while the AI responds, kept when
// it fails, and used as the whole feature for guests. No em dashes.
export const MOTIVATION_FALLBACKS = [
  "Settle in. Give this session your full attention.",
  "One block of real focus beats an hour of half attention. Make this that block.",
  "Pick the one thing that matters most right now and stay with it.",
  "Depth over coverage. Leave this session knowing one thing better than when you started.",
] as const;

// Reduce the app's existing data to the minimum context worth sending: the
// active task, the nearest FUTURE exam, and a handful of open-task subjects
// (which is also where AI-generated tasks from uploaded notes live). Never
// documents, note text, or anything personally identifying.
export function buildMotivationContext(args: {
  activeTask: Task | null | undefined;
  exams: ExamSchedule[];
  tasks: Task[];
}): MotivationContext {
  const ctx: MotivationContext = {};
  if (args.activeTask) ctx.task = { title: args.activeTask.title, tag: args.activeTask.tag };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const upcoming = args.exams
    .map((e) => ({ name: e.name, daysLeft: Math.round((new Date(`${e.exam_date}T00:00:00`).getTime() - today.getTime()) / 86_400_000) }))
    .filter((e) => e.daysLeft >= 0)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  if (upcoming[0]) ctx.exam = upcoming[0];
  const topics = [...new Set(args.tasks.filter((t) => !t.done && t.tag !== args.activeTask?.tag).map((t) => t.tag))].slice(0, 4);
  if (topics.length > 0) ctx.topics = topics;
  return ctx;
}

export function useFocusMotivation(
  timer: { phase: string; running: boolean; secondsLeft: number },
  focusTotalSeconds: number,
  signedIn: boolean,
  getContext: () => MotivationContext,
): string | null {
  const [message, setMessage] = useState<string | null>(null);
  // The active session's id, or null between sessions. Monotonic ids let a
  // late AI response verify it still belongs to the current session.
  const sessionRef = useRef<number | null>(null);
  const seqRef = useRef(0);
  const getContextRef = useRef(getContext);
  getContextRef.current = getContext;

  useEffect(() => {
    if (timer.phase !== "focus") {
      // Completed or skipped out of focus: the session is over.
      sessionRef.current = null;
      setMessage(null);
      return;
    }
    if (!timer.running) return; // paused (or not yet started): nothing changes
    if (sessionRef.current !== null) return; // resume / re-render of the same session
    const id = ++seqRef.current;
    sessionRef.current = id;
    setMessage(MOTIVATION_FALLBACKS[Math.floor(Math.random() * MOTIVATION_FALLBACKS.length)]);
    if (!signedIn) return; // guests keep the local message
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const res = await fetch("/api/motivation", {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(getContextRef.current()),
        });
        if (!res.ok) return; // keep the fallback; never disturb the timer
        const data = (await res.json()) as { message?: unknown };
        if (typeof data.message === "string" && data.message.trim() && sessionRef.current === id) {
          setMessage(data.message.trim());
        }
      } catch { /* offline or aborted; the fallback stays */ }
    })();
  }, [timer.phase, timer.running, signedIn]);

  // A reset parks the timer back at the full duration: that cancels the
  // session, so the next Start counts as new (and clears the old message).
  const atFullDuration = !timer.running && timer.phase === "focus" && timer.secondsLeft === focusTotalSeconds;
  useEffect(() => {
    if (atFullDuration && sessionRef.current !== null) {
      sessionRef.current = null;
      setMessage(null);
    }
  }, [atFullDuration]);

  return message;
}

// Shared display wrapper so the Focus tab and the focus-mode overlay render
// the message identically: quiet, small, capped width, no layout jumps taller
// than a couple of lines.
export function MotivationLine({ text, className }: { text: string | null; className?: string }) {
  if (!text) return null;
  return (
    <p data-testid="focus-motivation"
      className={`mx-auto mt-2 max-w-sm text-center text-xs leading-relaxed text-muted-foreground ${className ?? ""}`}>
      {text}
    </p>
  );
}

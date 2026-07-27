// User Journey Monitoring.
//
// Contracts answer "did this action work". Journeys answer the question that
// actually predicts revenue: "did the user get all the way through". They
// catch the failures no single action reports — the person who uploads notes,
// waits, and never sees tasks appear; the person who reaches Stripe and never
// comes back.
//
// Journeys survive reloads and redirects (localStorage-backed), because the
// most important ones — checkout, email verification — are interrupted by a
// full page navigation to a third party by design. A journey that only lived
// in memory would report every successful purchase as an abandonment.

import type { JourneyDefinition } from "./types";
import { JOURNEYS } from "./contracts";
import { enqueueJourney, enqueueEvent } from "./transport";
import { currentRoute, uuid } from "./session";

const STORE_KEY = "roamly-sh-journeys";

type JourneyRun = {
  id: string;
  key: string;
  startedAt: number;
  updatedAt: number;
  stepsDone: { step: string; at: number }[];
  currentStep: string | null;
};

function load(): Record<string, JourneyRun> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, JourneyRun>;
    // Drop runs past their total timeout so stale state can't accumulate
    // forever in a browser that never gets cleared.
    const now = Date.now();
    for (const [key, run] of Object.entries(parsed)) {
      const def = JOURNEYS[key];
      if (!def || now - run.startedAt > def.totalTimeoutMs) delete parsed[key];
    }
    return parsed;
  } catch {
    return {};
  }
}

function save(runs: Record<string, JourneyRun>): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(runs)); } catch { /* ignore */ }
}

/** Begin (or restart) a journey. Restarting is normal: a user can retry. */
export function startJourney(key: string, meta?: Record<string, unknown>): void {
  const def = JOURNEYS[key];
  if (!def || typeof window === "undefined") return;
  const runs = load();
  runs[key] = {
    id: uuid(), key, startedAt: Date.now(), updatedAt: Date.now(),
    stepsDone: [], currentStep: def.steps[0]?.step ?? null,
  };
  save(runs);
  emit(runs[key], def, "started", meta);
}

/**
 * Record progress. Steps may arrive out of order (a webhook-driven step can
 * land before the UI catches up), so completion is set-membership, not index
 * position — sequence is validated server-side where we have a global view.
 */
export function journeyStep(key: string, step: string, meta?: Record<string, unknown>): void {
  const def = JOURNEYS[key];
  if (!def || typeof window === "undefined") return;
  const runs = load();
  const run = runs[key];
  if (!run) {
    // A step for a journey we never saw start usually means the journey began
    // on another device (email verification link). Start it here so the tail
    // is still measured rather than dropped.
    startJourney(key, { resumed_at_step: step });
    return journeyStep(key, step, meta);
  }
  if (run.stepsDone.some((s) => s.step === step)) return;

  run.stepsDone.push({ step, at: Date.now() });
  run.updatedAt = Date.now();
  const done = new Set(run.stepsDone.map((s) => s.step));
  const next = def.steps.find((s) => !done.has(s.step) && !s.optional);
  run.currentStep = next?.step ?? null;

  const complete = def.steps.every((s) => s.optional || done.has(s.step));
  if (complete) {
    delete runs[key];
    save(runs);
    emit(run, def, "succeeded", meta);
    return;
  }
  save(runs);
  emit(run, def, "started", meta);
}

/** Explicit, user-intentional exit (clicked cancel). Not a defect. */
export function cancelJourney(key: string): void {
  const runs = load();
  const run = runs[key];
  if (!run) return;
  delete runs[key];
  save(runs);
  const def = JOURNEYS[key];
  if (def) emit(run, def, "abandoned", { deliberate: true });
}

function emit(
  run: JourneyRun,
  def: JourneyDefinition,
  status: "started" | "succeeded" | "abandoned",
  meta?: Record<string, unknown>
): void {
  enqueueJourney({
    id: run.id,
    journey_key: run.key,
    status,
    started_at: new Date(run.startedAt).toISOString(),
    updated_at: new Date(run.updatedAt).toISOString(),
    completed_at: status === "succeeded" ? new Date().toISOString() : null,
    current_step: run.currentStep,
    steps_done: run.stepsDone,
    abandoned_at_step: status === "abandoned" ? run.currentStep : null,
    severity: def.severity,
  });
  enqueueEvent({
    kind: "journey_step", severity: "info", route: currentRoute(),
    payload: {
      journey: run.key, status, step: run.currentStep,
      elapsedMs: Date.now() - run.startedAt,
      completed: run.stepsDone.length, total: def.steps.length,
      ...meta,
    },
    ts: Date.now(),
  });
}

/** Re-emit in-flight journeys on boot so the server's timeout sweep sees them. */
export function resumeJourneys(): void {
  const runs = load();
  for (const run of Object.values(runs)) {
    const def = JOURNEYS[run.key];
    if (def) emit(run, def, "started", { resumed: true });
  }
}

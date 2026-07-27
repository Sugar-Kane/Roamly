// Feature Outcome Tracking — the module that makes this a self-healing
// platform rather than an error logger.
//
// The premise: an exception is a symptom, not the disease. The bugs that
// actually hurt Roamly are silent — the Create Study Plan button that posts,
// gets a 200, and never renders the plan; the upload that finishes and never
// produces tasks. Nothing throws, so crash monitoring reports 100% health
// while the user quietly gives up.
//
// So instead of watching for errors, we watch for OUTCOMES. Calling
// `expect("task.create")` opens a window in which a set of observable facts
// must all become true — a row posted, a route entered, a toast shown — and if
// they don't within the contract's timeout, that is a defect, reported with
// exactly which expectation went unmet. That diff is the diagnosis hint the
// AI starts from.
//
// Usage in app code is one line at the call site:
//
//   const outcome = expect("task.create");
//   await saveTask(...);                 // network expectations self-satisfy
//   outcome.satisfy("state", "rendered"); // things only the app can prove
//
// Forgetting to settle is fine: the timeout settles it as a failure, which is
// the correct default — a feature nobody can prove worked, didn't.

import type { Expectation, FeatureContract, OutcomeResult } from "./types";
import { CONTRACTS } from "./contracts";
import { enqueueEvent, enqueueOutcome } from "./transport";
import { getContext, currentRoute, uuid } from "./session";
import { onNetwork, matchesUrl, matchesTable } from "./net";
import { redactText } from "./redact";

export type OutcomeHandle = {
  id: string;
  /** Mark an expectation type as observed. `detail` narrows which one. */
  satisfy: (type: Expectation["type"], detail?: string) => void;
  /** Settle immediately as a failure with a reason. */
  fail: (reason: string) => void;
  /** Settle immediately as a success, skipping remaining expectations. */
  succeed: () => void;
  /** Abandon tracking without reporting (e.g. user cancelled deliberately). */
  cancel: () => void;
};

type ActiveOutcome = {
  id: string;
  contract: FeatureContract;
  startedAt: number;
  route: string;
  met: boolean[];
  timer: number;
  unsubs: (() => void)[];
  settled: boolean;
  tries: number;
};

const active = new Map<string, ActiveOutcome>();

/** Contracts that are already running for a key, to detect double-submits. */
function existingFor(key: string): ActiveOutcome | undefined {
  for (const o of active.values()) if (o.contract.key === key) return o;
  return undefined;
}

const NOOP_HANDLE: OutcomeHandle = {
  id: "noop",
  satisfy: () => {}, fail: () => {}, succeed: () => {}, cancel: () => {},
};

/**
 * Open an outcome window for a feature contract.
 * Unknown keys return a no-op handle rather than throwing — instrumentation
 * must never be able to break the feature it is instrumenting.
 */
export function expect(key: string, meta?: Record<string, unknown>): OutcomeHandle {
  const contract = CONTRACTS[key];
  if (!contract || typeof window === "undefined") return NOOP_HANDLE;

  // A second attempt while one is in flight is itself a signal: the user
  // pressed the button again because nothing happened.
  const inflight = existingFor(key);
  if (inflight) {
    enqueueEvent({
      kind: "custom", severity: "low", route: currentRoute(),
      component: contract.component,
      payload: { signal: "duplicate_attempt", contract: key, sincePreviousMs: Date.now() - inflight.startedAt },
      ts: Date.now(),
    });
  }

  const id = uuid();
  const startedAt = Date.now();
  const route = currentRoute();
  const state: ActiveOutcome = {
    id, contract, startedAt, route,
    met: contract.expectations.map(() => false),
    timer: 0, unsubs: [], settled: false, tries: 0,
  };

  enqueueEvent({
    kind: "outcome_started", severity: "info", route, component: contract.component,
    payload: { contract: key, outcomeId: id, ...meta }, ts: startedAt,
  });

  attachObservers(state);
  state.timer = window.setTimeout(() => settle(state, "timeout"), contract.timeoutMs);
  active.set(id, state);

  return {
    id,
    satisfy: (type, detail) => markSatisfied(state, type, detail),
    fail: (reason) => settle(state, "failed", reason),
    succeed: () => settle(state, "succeeded"),
    cancel: () => teardown(state),
  };
}

// ---------------------------------------------------------------------------
// Automatic observation
// ---------------------------------------------------------------------------

function attachObservers(state: ActiveOutcome): void {
  const { expectations } = state.contract;

  const wantsNetwork = expectations.some((e) => e.type === "api_2xx" || e.type === "db_row");
  if (wantsNetwork) {
    state.unsubs.push(onNetwork((obs) => {
      if (!obs.ok) return;
      expectations.forEach((exp, i) => {
        if (state.met[i]) return;
        if (exp.type === "api_2xx" && exp.matcher && matchesUrl(obs, exp.matcher)) state.met[i] = true;
        if (exp.type === "db_row" && exp.table && matchesTable(obs, exp.table)) state.met[i] = true;
      });
      maybeResolve(state);
    }));
  }

  const wantsNav = expectations.some((e) => e.type === "navigation");
  if (wantsNav) {
    const onHash = () => {
      const now = currentRoute();
      expectations.forEach((exp, i) => {
        if (exp.type === "navigation" && !state.met[i]) {
          // A `route: "stripe"` expectation means "we left for an external
          // host", which we can only observe as the page going away — that is
          // handled by pagehide in the sensors module marking success.
          if (!exp.route || now.startsWith(exp.route)) state.met[i] = true;
        }
      });
      maybeResolve(state);
    };
    window.addEventListener("hashchange", onHash);
    state.unsubs.push(() => window.removeEventListener("hashchange", onHash));
  }

  const domExpectations = expectations.filter((e) => e.type === "dom" || e.type === "toast");
  if (domExpectations.length) {
    const check = () => {
      expectations.forEach((exp, i) => {
        if (state.met[i]) return;
        if (exp.type === "toast" && document.querySelector('[data-sh="toast"],[role="status"],[role="alert"]')) {
          state.met[i] = true;
        }
        if (exp.type === "dom" && exp.selector && document.querySelector(`[data-sh="${CSS.escape(exp.selector)}"]`)) {
          state.met[i] = true;
        }
      });
      maybeResolve(state);
    };
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    state.unsubs.push(() => observer.disconnect());
    check();
  }
}

function markSatisfied(state: ActiveOutcome, type: Expectation["type"], detail?: string): void {
  if (state.settled) return;
  state.contract.expectations.forEach((exp, i) => {
    if (exp.type !== type || state.met[i]) return;
    if (!detail) { state.met[i] = true; return; }
    const target = exp.event || exp.matcher || exp.selector || exp.route;
    if (!target || target === detail) state.met[i] = true;
  });
  maybeResolve(state);
}

function maybeResolve(state: ActiveOutcome): void {
  if (state.settled) return;
  const allMet = state.contract.expectations.every((exp, i) => state.met[i] || exp.optional);
  if (allMet) settle(state, "succeeded");
}

// ---------------------------------------------------------------------------
// Settlement + recovery
// ---------------------------------------------------------------------------

function settle(state: ActiveOutcome, status: OutcomeResult["status"], reason?: string): void {
  if (state.settled) return;

  // Recovery: for transient-looking failures the contract may allow one
  // automatic retry before we call it a defect. This is the "self-healing"
  // that happens in the user's browser, in milliseconds, with no deploy —
  // it fixes the user's experience even when the underlying bug stays.
  if (status !== "succeeded" && state.tries < (state.contract.maxRecoveryTries ?? 0)) {
    state.tries += 1;
    const strategy = state.contract.recovery ?? "retry";
    enqueueEvent({
      kind: "custom", severity: "low", route: state.route, component: state.contract.component,
      payload: { signal: "recovery_attempt", contract: state.contract.key, strategy, attempt: state.tries },
      ts: Date.now(),
    });
    if (strategy === "retry" || strategy === "refresh_token") {
      window.clearTimeout(state.timer);
      state.timer = window.setTimeout(() => settle(state, "timeout"), state.contract.timeoutMs);
      window.dispatchEvent(new CustomEvent("roamly:recover", {
        detail: { contract: state.contract.key, strategy, outcomeId: state.id },
      }));
      return;
    }
  }

  state.settled = true;
  const durationMs = Date.now() - state.startedAt;
  const ctx = getContext();
  const unmet = state.contract.expectations.filter((_, i) => !state.met[i]);

  enqueueOutcome({
    id: state.id,
    contract_key: state.contract.key,
    status,
    started_at: new Date(state.startedAt).toISOString(),
    settled_at: new Date().toISOString(),
    duration_ms: durationMs,
    route: state.route,
    release: ctx?.release,
    device: ctx?.device,
    expectations: state.contract.expectations.map((exp, i) => ({ type: exp.type, met: state.met[i] })),
    failed_reason: reason ? redactText(reason) : unmetSummary(unmet),
    recovery_used: state.tries > 0 ? (state.contract.recovery ?? "retry") : null,
    // Severity travels with the row so the server can open an incident without
    // a second lookup, and so a contract retuned in the DB still wins (the
    // server reads the DB contract; this is only the fallback).
    severity: state.contract.severity,
    approval_level: state.contract.approvalLevel,
    component: state.contract.component,
  });

  if (status !== "succeeded") {
    enqueueEvent({
      kind: "outcome_failed",
      severity: state.contract.severity,
      route: state.route,
      component: state.contract.component,
      payload: {
        contract: state.contract.key, outcomeId: state.id, status, durationMs,
        unmet: unmet.map((e) => e.type),
        reason: reason ? redactText(reason) : undefined,
      },
      ts: Date.now(),
    });
  } else {
    enqueueEvent({
      kind: "outcome_ok", severity: "info", route: state.route,
      payload: { contract: state.contract.key, durationMs }, ts: Date.now(),
    });
  }

  teardown(state);
}

function unmetSummary(unmet: Expectation[]): string | null {
  if (!unmet.length) return null;
  return `unmet: ${unmet.map((e) => e.type + (e.table ? `(${e.table})` : e.matcher ? `(${e.matcher})` : "")).join(", ")}`;
}

function teardown(state: ActiveOutcome): void {
  window.clearTimeout(state.timer);
  state.unsubs.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
  state.unsubs = [];
  active.delete(state.id);
}

/**
 * Settle every open outcome as the page goes away. An unsettled outcome at
 * unload means the user left mid-flow — which is exactly the abandonment
 * signal we want, but it must be flushed with the final beacon or it is lost.
 */
export function settleAllForUnload(): void {
  for (const state of Array.from(active.values())) {
    // `navigation → external` contracts (Stripe checkout) succeed by leaving.
    const leavesApp = state.contract.expectations.some(
      (e, i) => e.type === "navigation" && !state.met[i] && e.route === "stripe"
    );
    settle(state, leavesApp ? "succeeded" : "failed", leavesApp ? undefined : "page unloaded before outcome");
  }
}

/** Test/debug seam. */
export function __activeCount(): number {
  return active.size;
}

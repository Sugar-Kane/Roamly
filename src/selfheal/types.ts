// Shared vocabulary for the self-healing SDK. Kept dependency-free so any
// module here can import it without pulling in the transport or Supabase.

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type ApprovalLevel = "auto" | "pr_only" | "manual";

/** Every signal the client can emit. Mirrors the `kind` column of sh_events. */
export type EventKind =
  | "dead_click"
  | "rage_click"
  | "js_error"
  | "promise_rejection"
  | "react_error"
  | "network_error"
  | "slow_request"
  | "spinner_stuck"
  | "nav_failed"
  | "layout_shift"
  | "long_task"
  | "memory_pressure"
  | "offline"
  | "a11y_violation"
  | "console_error"
  | "chunk_load_failed"
  | "outcome_started"
  | "outcome_ok"
  | "outcome_failed"
  | "journey_step"
  | "custom";

export type SelfHealEvent = {
  kind: EventKind;
  severity: Severity;
  route: string;
  component?: string;
  /** Already redacted by the caller. The server redacts again anyway. */
  payload: Record<string, unknown>;
  ts: number;
};

/**
 * What "this feature worked" means, expressed as observable facts.
 *
 * `db_row`/`api_2xx` are proven by watching the network layer; `navigation`,
 * `toast` and `dom` by watching the DOM; `analytics_event` and `state` by the
 * app calling `satisfy()` explicitly. Anything the runtime cannot observe on
 * its own must be reported by the app, which keeps the contract honest — an
 * expectation nobody can prove is a lie, not a safety net.
 */
export type ExpectationType =
  | "db_row"
  | "api_2xx"
  | "navigation"
  | "toast"
  | "dom"
  | "analytics_event"
  | "state";

export type Expectation = {
  type: ExpectationType;
  /** Substring matched against request URLs (api_2xx / db_row). */
  matcher?: string;
  /** Route the user must land on (navigation). */
  route?: string;
  /** Postgres table the row must appear in (db_row). */
  table?: string;
  /** `data-sh` attribute value that must appear in the DOM (dom / toast). */
  selector?: string;
  /** Analytics event name (analytics_event). */
  event?: string;
  /** Optional expectations don't fail the outcome, they only annotate it. */
  optional?: boolean;
};

export type FeatureContract = {
  key: string;
  label: string;
  component?: string;
  expectations: Expectation[];
  timeoutMs: number;
  severity: Severity;
  approvalLevel: ApprovalLevel;
  recovery?: RecoveryStrategy;
  maxRecoveryTries?: number;
};

export type RecoveryStrategy = "none" | "retry" | "refresh_token" | "reload";

export type JourneyStep = {
  step: string;
  contract?: string;
  optional?: boolean;
};

export type JourneyDefinition = {
  key: string;
  label: string;
  steps: JourneyStep[];
  totalTimeoutMs: number;
  severity: Severity;
};

export type OutcomeResult = {
  status: "succeeded" | "failed" | "timeout";
  durationMs: number;
  unmet: Expectation[];
};

/** Serialised session context stamped onto every batch. */
export type SessionContext = {
  sessionId: string;
  anonId: string;
  userId: string | null;
  release: string;
  environment: string;
  device: string;
  os: string;
  browser: string;
  viewport: { w: number; h: number };
  locale: string;
  timezone: string;
  isPremium: boolean | null;
  entryRoute: string;
};

export type ReplayFrame = {
  t: number;
  /** m=mouse move (sampled) c=click s=scroll i=input k=key n=nav d=dom r=resize */
  k: "m" | "c" | "s" | "i" | "k" | "n" | "d" | "r";
  d: unknown;
};

export type FlagState = {
  key: string;
  enabled: boolean;
  rolloutPercent: number;
  premiumOnly: boolean;
  betaOnly: boolean;
  regions: string[] | null;
};

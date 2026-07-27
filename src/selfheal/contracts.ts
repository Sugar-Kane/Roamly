// Feature outcome contracts — the editing surface.
//
// This file is the source of truth for the declarations; the migration seeds
// the same set into sh_feature_contracts so timeouts and severities can be
// re-tuned live in production without a deploy. The two are currently kept in
// sync by hand — a generator (scripts/sync-contracts.mjs) is Phase 2 work, and
// until it exists, adding a contract here means adding it to the migration's
// seed block too.
//
// Adding a contract is how a feature joins the self-healing platform. The bar
// for a good contract: every expectation must be something an outside observer
// could check. "The plan was created" is a contract. "It felt fast" is not.

import type { FeatureContract, JourneyDefinition } from "./types";

function contract(c: FeatureContract): FeatureContract {
  return c;
}

export const CONTRACT_LIST: FeatureContract[] = [
  // --- Authentication (Level 3: never auto-patched) ------------------------
  contract({
    key: "auth.sign_in", label: "Sign in", component: "src/Auth.tsx",
    expectations: [
      { type: "api_2xx", matcher: "auth/v1/token" },
      { type: "state", matcher: "session" },
      { type: "navigation", route: "focus" },
    ],
    timeoutMs: 12_000, severity: "critical", approvalLevel: "manual",
    recovery: "retry", maxRecoveryTries: 1,
  }),
  contract({
    key: "auth.sign_up", label: "Create account", component: "src/Auth.tsx",
    expectations: [
      { type: "api_2xx", matcher: "auth/v1/signup" },
      { type: "toast" },
      { type: "db_row", table: "profiles", optional: true },
    ],
    timeoutMs: 15_000, severity: "critical", approvalLevel: "manual",
  }),
  contract({
    key: "auth.password_reset", label: "Password reset", component: "src/Auth.tsx",
    expectations: [{ type: "api_2xx", matcher: "auth/v1/recover" }, { type: "toast" }],
    timeoutMs: 12_000, severity: "high", approvalLevel: "manual",
  }),

  // --- Core study loop (Level 2: AI may open a PR) -------------------------
  contract({
    key: "task.create", label: "Create task", component: "src/App.tsx",
    expectations: [
      { type: "db_row", table: "tasks" },
      { type: "dom", selector: "task-row" },
      { type: "analytics_event", event: "task_add", optional: true },
    ],
    timeoutMs: 6_000, severity: "high", approvalLevel: "pr_only",
    recovery: "retry", maxRecoveryTries: 1,
  }),
  contract({
    key: "task.complete", label: "Complete task", component: "src/App.tsx",
    expectations: [{ type: "db_row", table: "tasks" }, { type: "state", matcher: "done" }],
    timeoutMs: 6_000, severity: "medium", approvalLevel: "pr_only",
  }),
  contract({
    key: "focus.session_complete", label: "Finish a focus session", component: "src/FocusMode.tsx",
    expectations: [
      // Table names verified against the live schema — a contract naming a
      // table that does not exist can never be satisfied, so it would report
      // the feature as 100% broken forever.
      { type: "db_row", table: "focus_sessions" },
      { type: "analytics_event", event: "session_complete", optional: true },
    ],
    timeoutMs: 10_000, severity: "high", approvalLevel: "pr_only",
    recovery: "retry", maxRecoveryTries: 2,
  }),
  contract({
    key: "calendar.plan_session", label: "Plan a study session", component: "src/StudyInsights.tsx",
    expectations: [{ type: "db_row", table: "planned_study_sessions" }, { type: "dom", selector: "calendar-entry" }],
    timeoutMs: 8_000, severity: "medium", approvalLevel: "pr_only",
  }),

  // --- Uploads + AI --------------------------------------------------------
  contract({
    key: "upload.study_file", label: "Upload study file", component: "src/UploadTasks.tsx",
    expectations: [{ type: "api_2xx", matcher: "storage/v1/object" }, { type: "dom", selector: "upload-ready" }],
    timeoutMs: 60_000, severity: "high", approvalLevel: "pr_only",
    recovery: "retry", maxRecoveryTries: 1,
  }),
  contract({
    key: "ai.generate_tasks", label: "AI task generation", component: "api/generate-tasks.ts",
    expectations: [
      { type: "api_2xx", matcher: "/api/generate-tasks" },
      { type: "db_row", table: "tasks" },
      { type: "toast", optional: true },
    ],
    // Matches the 120s maxDuration configured for this function in vercel.json.
    timeoutMs: 125_000, severity: "high", approvalLevel: "pr_only",
  }),
  contract({
    key: "avatar.upload", label: "Upload avatar", component: "src/avatarUpload.ts",
    expectations: [{ type: "api_2xx", matcher: "storage/v1/object" }, { type: "dom", selector: "avatar-image" }],
    timeoutMs: 30_000, severity: "low", approvalLevel: "pr_only",
  }),

  // --- Money (Level 3) -----------------------------------------------------
  contract({
    key: "billing.checkout", label: "Premium checkout", component: "api/billing.ts",
    expectations: [
      { type: "api_2xx", matcher: "/api/billing" },
      { type: "navigation", route: "stripe" },
    ],
    timeoutMs: 20_000, severity: "critical", approvalLevel: "manual",
  }),
  contract({
    key: "billing.portal", label: "Billing portal", component: "api/billing.ts",
    expectations: [{ type: "api_2xx", matcher: "/api/billing" }, { type: "navigation", route: "stripe" }],
    timeoutMs: 20_000, severity: "high", approvalLevel: "manual",
  }),
  contract({
    key: "premium.gate", label: "Premium gate resolves correctly", component: "src/LockedFeaturePreview.tsx",
    expectations: [{ type: "state", matcher: "is_premium_resolved" }],
    timeoutMs: 5_000, severity: "high", approvalLevel: "manual",
  }),

  // --- Social / realtime ---------------------------------------------------
  contract({
    key: "rooms.join", label: "Join a study room", component: "src/RoomsLive.tsx",
    expectations: [
      // Joining is an RPC (rooms.ts calls join_room), not a table insert —
      // there is no room_participants table to watch for.
      { type: "api_2xx", matcher: "rpc/join_room" },
      { type: "state", matcher: "realtime_subscribed" },
      { type: "dom", selector: "room-timer" },
    ],
    timeoutMs: 15_000, severity: "high", approvalLevel: "pr_only",
    recovery: "refresh_token", maxRecoveryTries: 1,
  }),
  contract({
    key: "rooms.create", label: "Create a study room", component: "src/RoomsLive.tsx",
    expectations: [{ type: "db_row", table: "rooms" }, { type: "navigation", route: "rooms" }],
    timeoutMs: 12_000, severity: "medium", approvalLevel: "pr_only",
  }),
  contract({
    key: "notifications.deliver", label: "Notification delivered", component: "src/Notifications.tsx",
    expectations: [{ type: "db_row", table: "notifications" }, { type: "dom", selector: "notification-item" }],
    timeoutMs: 10_000, severity: "low", approvalLevel: "pr_only",
  }),
  contract({
    key: "feedback.submit", label: "Submit feedback", component: "src/Feedback.tsx",
    expectations: [{ type: "db_row", table: "feedback" }, { type: "toast" }],
    timeoutMs: 8_000, severity: "medium", approvalLevel: "pr_only",
  }),
];

export const CONTRACTS: Record<string, FeatureContract> = Object.fromEntries(
  CONTRACT_LIST.map((c) => [c.key, c])
);

export const JOURNEY_LIST: JourneyDefinition[] = [
  {
    key: "journey.registration", label: "Registration → first session", severity: "critical",
    totalTimeoutMs: 1_800_000,
    steps: [
      { step: "signup_submitted", contract: "auth.sign_up" },
      { step: "email_verified" },
      { step: "first_signin", contract: "auth.sign_in" },
      { step: "first_task", contract: "task.create" },
    ],
  },
  {
    key: "journey.checkout", label: "Premium purchase", severity: "critical",
    totalTimeoutMs: 900_000,
    steps: [
      { step: "upgrade_clicked" },
      { step: "checkout_session", contract: "billing.checkout" },
      { step: "stripe_redirect" },
      { step: "webhook_premium" },
      { step: "premium_visible", contract: "premium.gate" },
    ],
  },
  {
    key: "journey.ai_upload", label: "Upload → AI tasks", severity: "high",
    totalTimeoutMs: 300_000,
    steps: [
      { step: "file_selected" },
      { step: "uploaded", contract: "upload.study_file" },
      { step: "generated", contract: "ai.generate_tasks" },
      { step: "tasks_visible" },
    ],
  },
  {
    key: "journey.study_session", label: "Plan → focus → complete", severity: "high",
    totalTimeoutMs: 7_200_000,
    steps: [
      { step: "session_started" },
      { step: "timer_running" },
      { step: "session_saved", contract: "focus.session_complete" },
    ],
  },
  {
    key: "journey.room", label: "Join and study in a room", severity: "medium",
    totalTimeoutMs: 7_200_000,
    steps: [
      { step: "room_opened" },
      { step: "joined", contract: "rooms.join" },
      { step: "timer_synced" },
      { step: "left_cleanly" },
    ],
  },
  {
    key: "journey.cancel", label: "Subscription cancellation", severity: "high",
    totalTimeoutMs: 900_000,
    steps: [
      { step: "portal_opened", contract: "billing.portal" },
      { step: "cancel_confirmed" },
      { step: "webhook_downgrade" },
    ],
  },
];

export const JOURNEYS: Record<string, JourneyDefinition> = Object.fromEntries(
  JOURNEY_LIST.map((j) => [j.key, j])
);

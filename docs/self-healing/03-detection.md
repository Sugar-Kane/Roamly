# 03 — Detection

Detection is the half of this platform that decides whether it is useful. AI
diagnosis of a bad signal produces confident nonsense; AI diagnosis of a precise
signal produces a fix. So the thresholds below are argued, not guessed, and each
one is tuned to make the **innocent case quiet** — a false positive costs
engineering attention, which is the scarcest resource this platform spends.

## 1. Feature outcome contracts

### The mechanism

```ts
import { expect } from "./selfheal";

async function createTask(title: string) {
  const outcome = expect("task.create");           // opens the window
  try {
    await db.insertTask(title);                    // db_row proves itself
    setTasks((prev) => [...prev, newTask]);
    outcome.satisfy("state", "rendered");          // only the app can prove this
  } catch (err) {
    outcome.fail(err.message);
  }
}
```

The contract for `task.create` declares three expectations:

```ts
expectations: [
  { type: "db_row", table: "tasks" },              // observed on the network
  { type: "dom", selector: "task-row" },           // observed via MutationObserver
  { type: "analytics_event", event: "task_add", optional: true },
],
timeoutMs: 6_000, severity: "high", recovery: "retry", maxRecoveryTries: 1,
```

If all non-optional expectations become true within 6s → `succeeded`. If not →
`timeout`, and the `sh_outcomes` row records **exactly which ones went unmet**.

### Why the default is failure

Forgetting to settle an outcome produces a failure, not a silent drop. This is
deliberate: *a feature nobody can prove worked, didn't*. The alternative default
(assume success unless told otherwise) reproduces exactly the blind spot this
platform exists to close.

### What makes a good expectation

Every expectation must be something an outside observer could check. "The plan
was created" is a contract. "It felt fast" is not. Concretely:

- `db_row` / `api_2xx` — proven automatically by the network wrapper in
  `net.ts`. Free; no call-site work.
- `navigation` — proven by `hashchange`.
- `dom` / `toast` — proven by `MutationObserver` against a `data-sh` attribute.
- `analytics_event` / `state` — **must be reported by the app**. These are the
  facts the runtime cannot observe on its own, and requiring an explicit
  `satisfy()` call keeps the contract honest: an expectation nobody can prove is
  a lie, not a safety net.

### Client-side recovery

Before reporting a defect, a contract may retry (`maxRecoveryTries`). This is
self-healing that happens **in the user's browser, in milliseconds, with no
deploy** — it fixes the user's experience even while the underlying bug stands.
`focus.session_complete` gets two retries because losing a completed study
session is the worst non-financial failure in the product.

The retry is still recorded (`recovery_used`), so a feature that "works" only
because it retries every time is visible as a defect rather than hidden by its
own mitigation.

### Aggregate detection

Individual failures open incidents only at high severity. The subtler signal is
the **success rate**, swept every minute by `sh_sweep_contracts(15)`:

```sql
having count(*) >= 20
   and (successes::numeric / count(*)) < c.min_success_rate
```

The `n >= 20` floor is the important number. Without it, a single failure in the
first three attempts after a deploy reads as a 67% success rate and pages
someone at 4am for noise. With it, the platform waits for statistical evidence
before believing a rate. Below-floor by more than 2× escalates to `critical`.

## 2. Journey monitoring

Contracts answer "did this action work". Journeys answer the question that
actually predicts revenue: "did the user get all the way through".

```ts
startJourney("journey.checkout");
journeyStep("journey.checkout", "upgrade_clicked");
journeyStep("journey.checkout", "checkout_session");
// … user redirects to Stripe, comes back on a fresh page load …
journeyStep("journey.checkout", "webhook_premium");
```

Journeys are **localStorage-backed** and survive reloads and third-party
redirects, because the most important ones — checkout, email verification — are
interrupted by a full navigation *by design*. A journey that lived only in
memory would report every successful purchase as an abandonment, which is a
worse-than-useless metric.

Steps may arrive **out of order** (a webhook-driven step can land before the UI
catches up), so completion is set-membership rather than index position;
sequence validation happens server-side where there is a global view.

Six journeys ship: registration, checkout, AI upload, study session, rooms, and
cancellation. Two sweeps run against them — `sh_sweep_journeys()` marks runs
past their total timeout as abandoned, and `sh_sweep_journey_health(60)` opens an
incident when completion falls below the journey's floor, naming the step users
are stalling at (`mode() within group (order by abandoned_at_step)`).

## 3. Passive sensors

These need no per-feature instrumentation. Each has an explicit argument for why
its signal is definitely a defect.

### Dead clicks — the flagship detector

A click on something that looks interactive where **nothing observable
happened**: no structural DOM change, no navigation, no network request, within
1.2s.

The subtlety that makes this work is what counts as "something happened", and
getting it wrong breaks the detector silently in **both** directions. Two
versions of this code were wrong before the current one, and the test suite
caught both:

1. Observing `{childList, subtree, attributes, characterData}` and counting any
   mutation. Roamly always has a running timer rewriting text and toggling
   animation classes, so this was true 100% of the time — it suppressed every
   real dead click.
2. Counting a mutation whose target *contains* the clicked element. That reads
   as "a change around the button", but `document.body.contains(anyButton)` is
   always true, so any root-level re-render — constant in a React SPA — had the
   same suppressing effect. **Ancestor containment is not evidence.**

`isResponsiveMutation()` therefore counts only **structural** changes (nodes
added or removed — never attributes or text) that are:

- inside the clicked element's own subtree, **or**
- inside its immediate parent's subtree, and only when that parent is narrow
  enough to mean something (`<body>` and `<html>` are excluded), **or**
- a newly mounted overlay — `role=dialog|alertdialog|status|alert|menu|listbox|tooltip`,
  `[aria-modal]`, `[data-state=open]`, or `[data-sh]`.

The known tradeoff: a button that renders a response somewhere far away in the
tree, with no overlay role and no `data-sh` attribute, will be reported as a
dead click. That is the correct direction to err — a false positive costs one
triage, while the suppression bugs above cost the entire detector — and adding
`data-sh` to the responding element fixes it.

Disabled and `aria-disabled` controls are excluded — a disabled button doing
nothing is correct behaviour. Anchors with a real `href` are excluded — the
browser handles those, not JS.

### Rage clicks

4+ clicks within 2s in a 40px radius. Severity depends on whether anything
responded: a working stepper clicked rapidly is `low`; a button clicked four
times that produced nothing is `high`. Without that distinction, every `+10
minutes` timer button would page an engineer.

### Stuck loading states

A spinner visible >12s **with zero requests in flight**. The in-flight check is
what separates "the upload is genuinely slow" from "the promise never
resolved" — the second is always a bug, the first never is.

Two corrections, both from incidents this detector opened against itself:

- **A progress display is not a loading state.** `[role=progressbar]` covers
  both meanings in ARIA, separated by one attribute: a determinate bar
  publishes `aria-valuenow`, an indeterminate one omits it. Every progressbar
  in Roamly is determinate — the focus-phase bar, the daily-goal bar, the
  task-completion bar — and each is *meant* to sit on screen for a whole
  session with no network behind it, which is the firing condition exactly. Two
  incidents were opened this way and one was "patched" against a bug that never
  existed. Elements carrying `aria-valuenow` are therefore never watched.
  Keying on the attribute rather than a route or selector allowlist means a new
  determinate bar is exempt the day it is written.
- **The in-flight count must be exact in both directions.** It is maintained in
  `net.ts`, the only place that wraps both `fetch` and XHR. When it lived in the
  watchdog it decremented on every observation while incrementing only for
  fetch, so XHR traffic dragged it to zero while real requests were pending
  (false positives), and the SDK's own ingest POST incremented without ever
  emitting, leaking it upward forever (silent suppression).

Visibility is measured as one *continuous* interval — the clock resets when the
element goes off screen, so a spinner shown briefly, hidden, and shown again no
longer accumulates its way past the threshold. Visibility itself is
`getClientRects()`, not `offsetParent`, which is null for every
`position: fixed` element and had been exempting full-screen loading overlays —
the most important thing the detector watches.

### Form submit with no request

A `submit` event with no network activity within 2.5s. This catches the
signup and checkout forms that die silently, which are the highest-value forms
in the product. Field *values* are never read — only how many fields exist and
how many were non-empty.

### Errors

`window.error`, `unhandledrejection`, React `componentDidCatch` (via
`ErrorBoundary`), and a `console.error` wrapper — the last catches React
hydration mismatches and minified React errors that never become exceptions.
Chunk-load failures are classified separately at `medium`, because a deploy
replacing hashed chunks makes them *expected* in an old tab, and the app already
self-heals them with a one-shot reload.

### Network

500s → `critical`. 401/403 → `high`, tagged `permission` (usually RLS or a
premium gate, always Level 3 to fix). 429 → `medium`, tagged `rate_limited`.
Failures explained by the user's connection are downgraded to `low` — the
user's train went into a tunnel; that is not our bug.

Deciding that took one more step than it looks. `navigator.onLine` is updated
by the browser *after* the request has already failed, so sampling it at
failure time splits one tunnel into two verdicts: a token refresh failed
reporting `online: true` and opened a high-severity incident, while the very
next request 17ms later reported `online: false`. Connection failures
(`status === 0`) therefore hold their verdict for 2s and are downgraded when
any of three things is true — the browser is offline now, it reported going
offline any time from just before the request started, or the request failed
after `pagehide`, since a navigation aborts everything in flight and the
failures are indistinguishable from an outage. The reason is recorded on the
event as `connectivity`, so triage can see the grounds rather than just a
missing incident. A `pagehide` resolves every held verdict immediately, so the
last batch still carries them.

### Performance and layout

- CLS reported once at unload, only above 0.25 (Google's "poor" threshold).
- Long tasks: individually only above 2s; a *sustained* run (>20 tasks and >5s
  in a minute) reports as `high` — one long task is noise, a sustained run is a
  freeze.
- Interaction latency >1s (INP-style).
- Memory: Chrome-only, reports when heap exceeds 90% of limit AND has grown 20%
  since the last report. This is the leading indicator of the leak that
  eventually crashes long study sessions.
- **Horizontal overflow on viewports ≤640px** — content wider than the screen
  reliably makes controls unreachable, and is the single most common mobile
  layout failure.

### Navigation

A hash change where `main`/`#root` contains <20 characters 1.5s later — the SPA
equivalent of a 404 that returns 200.

## 4. Backend detection

`instrument()` wraps a route handler and reports:

- 5xx responses and thrown exceptions → incident, with a **dependency
  classification** from the error text (Stripe / Resend / Anthropic / RLS
  denial / deadlock / connection exhaustion / statement timeout / JWT).
  Routing an incident to the right owner is most of the value of triage.
- Requests over their latency budget → incident. *Slow is a defect*: a 20s
  checkout call is a failed checkout for anyone who gives up at 15.
- An `x-roamly-request-id` header on every response, so a user-visible error can
  be tied to a server trace without asking the user for anything.

`reportBackendOutcome()` covers business-level failures that aren't exceptions —
a Stripe webhook whose signature verified but whose subscription update didn't
land. These are the backend equivalent of an unmet frontend expectation.

## 5. Threshold summary

| Detector | Threshold | Why not tighter | Why not looser |
|---|---|---|---|
| Contract success rate | n≥20, below contract floor | Fewer samples = noise after every deploy | 20 attempts is minutes at current traffic |
| Journey completion | n≥15, below floor | Journeys are lower-volume than actions | Same |
| Dead click | 1.2s, structural mutations only | Async handlers need time to respond | >2s and real dead clicks blur into slow ones |
| Rage click | 4 clicks / 2s / 40px | 3 is normal impatience | 5+ and users have already given up |
| Stuck spinner | 12s continuous, 0 in flight, no `aria-valuenow` | Real uploads exceed 8s | Users abandon around 15s |
| Offline downgrade | offline within request window ±grace | Tighter re-blames us for tunnels | Wider hides real backend outages |
| Slow request | 8s | p99 of AI generation is legitimately long | Beyond 8s it is a failed interaction |
| CLS | 0.25 session total | Below this is imperceptible | Above 0.5 is already broken |
| Sustained jank | 20 tasks + 5s / min | One long task is normal | Beyond this the tab is frozen |
| Mobile overflow | >16px on ≤640px | Sub-pixel rounding is not a bug | Any real overflow breaks reachability |

## 6. Adding a contract

1. Add it to `CONTRACT_LIST` in `src/selfheal/contracts.ts`.
2. Mirror it in the seed block of the migration. (These are kept in sync by
   hand today; a generator is Phase 2 work.)
3. Call `expect("your.key")` at the call site and `satisfy()` for anything the
   runtime cannot observe.
4. Add `data-sh="…"` attributes for any `dom`/`toast` expectations.
5. Start with `min_success_rate` low (0.8) and `severity: "low"`, watch real
   traffic for a week, then tighten. Shipping a new contract at 0.99 guarantees
   a week of false alarms while you learn what its real baseline is.

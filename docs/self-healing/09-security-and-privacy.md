# 09 — Security and privacy

## The privacy problem specific to Roamly

Roamly's users are physician assistant students. Their uploaded lecture notes,
flashcards, and study material can contain **patient case details**. That single
fact drives most of the decisions below and rules out the industry-standard
approach to session replay outright.

## Session replay: what we deliberately did not build

The conventional answer is rrweb-style DOM recording: serialise the DOM and its
mutations, replay pixel-perfect, mask sensitive fields with a selector list.

We rejected it. DOM serialisation captures **every text node**, which for Roamly
means study content leaving the browser by default and being protected only by a
maintained list of selectors — a list that is wrong the moment anyone adds a
component and forgets. The failure mode is silent, and the data at stake could
include patient information.

What `src/selfheal/replay.ts` records instead is an **interaction trace**: what
the user did, where, and what the app did in response.

| Recorded | Not recorded |
|---|---|
| Pointer positions (250ms sampled) | Any text node |
| Click targets by structural description | Any input value, even masked |
| Scroll offsets | Any character key |
| Input *events* — field type, sensitivity flag, value **length** | Screenshots |
| Enter/Tab/Escape/Backspace/arrows only | Clipboard |
| Navigation, resize | DOM snapshots |
| Network metadata (URL shape, status, duration) | Request or response bodies |

This is enough to answer "what were they doing when it broke" and to author a
Playwright reproduction, with **no user content in it at all**. The tradeoff —
you cannot watch a pixel-perfect video of the failure — is one worth making
here, and it is a design decision rather than a limitation.

Replay is sampled at 25%, uploaded **only when the batch also carries a
high-severity event**, and retained 30 days in a **private** Storage bucket.
A healthy session's trace is discarded, never transmitted.

## Three layers of PII protection

Assume each layer will eventually be bypassed by a future code path.

**Layer 1 — client** (`src/selfheal/redact.ts`). Before anything is queued:
emails, card numbers, SSNs, API keys, JWTs, bearer tokens, phone numbers, and
UUIDs are pattern-replaced. Sensitive URL params are stripped and path
identifiers collapsed to `:id`. Input values are never read at all when the
field is `password`/`email`/`tel`/`number`/`date`/`file`, is a `textarea` or
`contenteditable` (where notes and journals live), sits inside `[data-sh-private]`,
or has a sensitive-looking name/id/autocomplete. Opt-in via `data-sh-safe`, never
opt-out.

**Layer 2 — server** (`api/_scrub.ts`). The same pattern classes re-run on
ingest, plus provider-specific secret shapes (`sk_live_`, `whsec_`,
`sk-ant-`, `ghp_`) and IP addresses. Keys matching the sensitive pattern are
**dropped entirely**, not scrubbed — a field literally named `password` needs no
value inspection, and its value may match no pattern at all.

**Layer 3 — access control.** RLS enabled, zero policies, no client-reachable
read path. Even a total failure of layers 1 and 2 does not produce a data breach,
only bad data in a table no user can query.

`tests/selfheal.spec.ts` asserts layer 1 end to end: a distinctive string typed
into the app must appear in no telemetry batch.

## Data minimisation

- **IPs are never stored.** Only a salted SHA-256 prefix (`TELEMETRY_IP_SALT`),
  used solely to correlate an abuse burst to one origin. Salted because the IPv4
  space is small enough to enumerate exhaustively against an unsalted hash.
- **`anon_id` rotates every 30 days**, so no durable cross-session identity graph
  accumulates for signed-out visitors.
- **Geography is country-level at most.**
- **`user_id` is nullable throughout**; signed-out telemetry carries no identity.
- **Retention is enforced in code**, by `sh_rollup_and_prune()` on a cron
  schedule, not by a policy document.

### GDPR

| Right | Mechanism |
|---|---|
| Erasure | `sh_sessions.user_id`, `sh_events.user_id`, `sh_outcomes.user_id` are `on delete set null` — deleting an account anonymises telemetry without destroying the incident record an engineer may still need |
| Access | Everything attributable to a user is reachable by `user_id` across four tables |
| Minimisation | Shape not content; see above |
| Purpose limitation | Service improvement and defect detection only; never marketing, never profiling, never sold |
| Storage limitation | 14/30/90-day retention, enforced automatically |

## Threat model

| Threat | Control |
|---|---|
| Forged telemetry from a hostile client | No client identity is trusted; `user_id` comes from a verified JWT or is null. Fabricated events can inflate an incident's count but cannot attribute it to another user, and `affected_users` is recounted from distinct ids rather than incremented |
| Telemetry flood / DoS | 240 batches/hour/IP (Upstash), 128KB body cap, count caps per array, DB-level per-session insert limits, 14-day retention |
| Reading another user's telemetry | Impossible: RLS on, no policies, no client read path |
| Privilege escalation via the AI | Four independent layers, authoritative one is a DB trigger — [05](05-safety-and-approval.md) |
| Prompt injection through user content | Prompts declare evidence untrusted; `scrubForPrompt()` strips instruction-shaped text; **no tool access** — models return text, our code takes every action |
| Malicious generated test code | `extractCode()` rejects `require(`, `child_process`, `fs.`, and privileged env reads before storage |
| Path traversal in a generated patch | `patchFiles()` rejects `..`, absolute paths, `.github/`, `.env*` |
| Supply-chain injection via a generated patch | CI **hard-fails** on any `package.json`/`package-lock.json` change in a self-healing PR |
| Secret leakage into a commit | CI scans added lines for secret patterns and fails |
| Compromised admin session | Cannot downgrade an approval tier (classifier re-runs server-side), cannot merge Level 3, every action is audited; `/api/selfheal-action` is rate-limited to 30/5min |
| Stolen `CRON_SECRET` | Grants only the ability to trigger investigation of existing incidents — no write path to patches beyond what the classifier permits |
| Telemetry endpoint used to probe the backend | Returns 2xx for nearly everything; no error text distinguishes "session exists" from "session doesn't" |

## OWASP Top 10 mapping

| Risk | Position |
|---|---|
| A01 Broken access control | RLS-deny-by-default on every table; `is_admin()` on every read RPC; admin membership re-verified server-side on every action endpoint |
| A02 Cryptographic failures | No secrets in telemetry (three scrub layers); IPs hashed with a salt; all transport TLS |
| A03 Injection | Parameterised queries throughout (PostgREST/supabase-js); no dynamic SQL from user input; prompt injection treated as its own class above |
| A04 Insecure design | The four-layer approval model exists precisely because a single-layer design is insecure by construction |
| A05 Security misconfiguration | Every component no-ops when unconfigured rather than failing open; `/api/health` reports env presence as booleans |
| A06 Vulnerable components | `npm audit` in CI; dependency changes **forbidden** in machine-authored PRs |
| A07 Auth failures | Auth is unchanged by this work; the platform only observes it. Every auth contract is Level 3 |
| A08 Data integrity failures | Machine-authored code goes through more CI than human-authored; secret scanning; no auto-merge above Level 1 |
| A09 Logging failures | This platform *is* the logging improvement; `sh_audit_log` is append-only and never pruned |
| A10 SSRF | Outbound calls go only to `api.github.com` and `api.anthropic.com`, with paths derived from our own data, never from model output |

## Required secrets

| Variable | Purpose | Absent → |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | All server writes | Ingest no-ops |
| `TELEMETRY_IP_SALT` | IP hashing | Falls back to a default salt (set it) |
| `ANTHROPIC_API_KEY` | Diagnosis and patching | Investigation returns 503 |
| `GITHUB_TOKEN` | Issues, branches, PRs, source reads | PR steps no-op; analysis still works |
| `CRON_SECRET` | Sweep authentication | Sweep skips |
| `UPSTASH_REDIS_REST_*` | Rate limiting | Fails **open** — matching the existing limiter's documented behaviour |

None of these is ever logged. `api/_log.ts` records ids and outcomes only, and
that constraint is stated in the file itself.

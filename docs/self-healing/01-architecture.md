# 01 — Architecture

## 1. High-level

```
                    ┌──────────────────────────────────────────┐
   User's browser   │  React 19 SPA (Vite, Vercel CDN)          │
                    │  ┌────────────────────────────────────┐  │
                    │  │ src/selfheal/  (the SDK)           │  │
                    │  │  contracts · journeys · sensors    │  │
                    │  │  replay · flags · redact           │  │
                    │  └───────────────┬────────────────────┘  │
                    └──────────────────┼───────────────────────┘
                                       │ batched JSON, ≤48KB
                                       │ (anonymous-capable)
                    ┌──────────────────▼───────────────────────┐
   Vercel function  │ /api/selfheal   — scrub, clamp, rate-limit│
                    │ /api/_instrument — wraps every other route│
                    └──────────────────┬───────────────────────┘
                                       │ service role
                    ┌──────────────────▼───────────────────────┐
   Supabase         │ Postgres: sh_* tables                     │
                    │  · sh_fingerprint()  dedupe               │
                    │  · sh_record_incident()  one row per bug  │
                    │  · sh_classify_approval()  SAFETY GATE    │
                    │  · pg_cron sweeps  detection              │
                    │ Storage: selfheal-replays (private)       │
                    └──────────────────┬───────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
    ┌─────────▼────────┐   ┌───────────▼──────────┐  ┌──────────▼─────────┐
    │ GitHub Actions   │   │ /api/selfheal-       │  │ Bug Intelligence   │
    │ selfheal-sweep   │──▶│   investigate        │  │ dashboard          │
    │ (every 15 min)   │   │  Anthropic: RCA →    │  │ (admin only)       │
    └──────────────────┘   │  repro → patch       │  └──────────┬─────────┘
                           └───────────┬──────────┘             │
                                       │                        │ approve
                           ┌───────────▼────────────────────────▼─────────┐
                           │ /api/selfheal  (op: action)                   │
                           │  issue → branch → commit → PR                 │
                           │  (re-runs the classifier; never merges L3)    │
                           └───────────┬───────────────────────────────────┘
                                       │
                           ┌───────────▼──────────┐
                           │ GitHub → Vercel       │
                           │ CI gauntlet → preview │
                           │ → human merge → prod  │
                           └───────────────────────┘
```

## 2. The pipeline, module by module

Each stage is independently replaceable: it reads a defined input and writes a
defined output, with the database as the only shared interface. Nothing calls
anything else directly.

| Stage | Module | Input | Output | Replaceable with |
|---|---|---|---|---|
| Event tracking | `src/selfheal/sensors.ts`, `net.ts` | DOM/network/perf events | `sh_events` rows | rrweb, OpenTelemetry browser SDK |
| Behaviour monitoring | `outcomes.ts`, `journeys.ts` | `expect()` calls | `sh_outcomes`, `sh_journey_runs` | — (this is the differentiator) |
| Error detection | `sh_record_incident()`, pg_cron sweeps | events + outcome rates | `sh_incidents` | Sentry issue grouping |
| Evidence collection | `_selfheal-investigate.ts` § collectEvidence | incident id | `sh_incident_evidence` | any log aggregator |
| Root cause analysis | `_selfheal-investigate.ts` § investigate | evidence bundle | `sh_diagnoses` | any LLM, or a human |
| Reproduction | § reproduce | diagnosis | `sh_repro_attempts` + spec file | manual repro |
| Regression tests | CI + `tests/generated/` | repro spec | pass/fail | hand-written tests |
| Patch generation | § proposePatch | diagnosis + source | `sh_patches` | human engineer |
| Automated testing | `.github/workflows/self-healing.yml` | PR | CI status → `sh_patches.status` | any CI |
| Preview deploy | Vercel PR preview | PR | preview URL | Netlify, Cloudflare |
| Human approval | dashboard → `_selfheal-action.ts` | patch id | `sh_audit_log` + merge | GitHub review alone |
| Production deploy | Vercel on merge to `main` | merge | release | — |

## 3. Sequence: a silent feature failure, end to end

The scenario this platform exists for. An RLS policy change ships at 14:02 that
accidentally denies `insert` on `study_sessions` for non-premium users. No
exception is thrown — PostgREST returns a 403, the client's optimistic UI shows
the session as saved, and the row silently never exists.

```
 14:02  Deploy abc123f.

 14:04  User A finishes a focus session.
        FocusMode calls expect("focus.session_complete").
        Contract expects: db_row(study_sessions) + analytics_event.
        The POST /rest/v1/study_sessions returns 403 → not ok → expectation unmet.
        10s timeout fires → sh_outcomes row {status: timeout, unmet: [db_row]}.
        The client's recovery strategy retries twice (maxRecoveryTries: 2),
        both fail, so the user at least isn't told everything is fine.

 14:04  Concurrently, sensors emits network_error severity=high (403 →
        kind:"permission"), which is INCIDENT_KINDS + high, so telemetry.ts
        calls sh_fingerprint() then sh_record_incident().
        → sh_incidents row, status=detected, approval_level=manual
          (approvalFor() returns manual for any network_error — a 403 could be
          RLS or Stripe, and both are Level 3).

 14:04– Users B…Q hit the same thing. Same fingerprint → the SAME incident row.
 14:17  occurrences increments; affected_users is RECOUNTED from distinct
        user_ids on sh_events, so one user refreshing 40 times is 1, not 40.
        priority_score climbs as reach grows.

 14:19  pg_cron sh_sweep_contracts(15) runs (every minute).
        focus.session_complete: 71 attempts, 4 succeeded → 5.6% success rate,
        floor is 97%. Below floor/2, so severity escalates to CRITICAL.
        A second incident opens, fingerprinted on the CONTRACT, carrying
        business_impact: "67 of 71 attempts failed in the last 15 min".

 14:20  selfheal-sweep.yml fires → POST /api/selfheal {op:"investigate"}.
        collectEvidence() pulls: the 40 most recent events, the outcome rows
        with their expectation diffs, session context (device/browser/release),
        the 30s lead-up from the same sessions, src/FocusMode.tsx from GitHub,
        and the last 10 commits.
        Prior sh_learning rows for the same route are retrieved as context.

 14:20  Anthropic (haiku) returns:
          root_cause: "RLS policy study_sessions_insert_own added in abc123f
            requires profiles.is_premium, denying inserts for free users"
          confidence: 0.87   regression_risk: high
          affected_files: ["supabase/migrations/...", "src/FocusMode.tsx"]
        → sh_diagnoses v1. Incident status → diagnosed. diagnosed_ms recorded.

 14:20  Severity is critical → alert fires (deduped on sh_alerts.dedupe_key,
        so the 200 subsequent occurrences send nothing further).

 14:21  Operator opens Bug Intelligence. The incident is at the top of the list
        (awaiting-human states sort first, then priority_score).
        The banner reads: Level 3 — this touches RLS. The platform will never
        deploy it automatically.

 14:22  Operator's fastest lever is NOT a code fix: they flip the flag or, in
        this case, revert the migration by hand. The dashboard's "Roll back"
        and the flag kill switch are one click each.

 14:25  Incident marked resolved. repaired_ms computed from first_seen_at.
        An sh_learning row is written: root cause, fix, files, timings,
        diagnosis_correct=true. The next time anything on this route breaks,
        that row is retrieved as context.

 MTTD: 2 minutes (vs. "whenever a user emails us", historically days).
 MTTR: 23 minutes.
```

The important detail: **no user reported anything.** The signal was a success
rate falling, not a complaint arriving.

## 4. Sequence: a Level 1 fix, fully automatic

```
 A broken image reference ships. Sensors emit network_error severity=low for
 the 404 on the asset. Low severity alone does not open an incident — but the
 same fingerprint recurring across 300 sessions raises affected_users, and the
 kind is in INCIDENT_KINDS, so once a high-severity variant appears (or an
 operator triages it up) the loop starts.

 investigate  → root_cause: "src/assets/hero.png renamed, reference not updated"
                confidence 0.95
 reproduce    → a Playwright test asserting the image loads. Fails today.
 patch        → diff touching only src/App.tsx's import path.
                files_changed = ["src/App.tsx"]
                model suggests "auto".
                sh_classify_approval() disagrees: .tsx is not in the
                cosmetic-only allowlist, and the diff contains "=>".
                → stored as pr_only. The model's suggestion is advisory only.

 A patch touching ONLY src/index.css or a public/ asset with no control flow in
 the diff would classify as auto: PR opened non-draft, CI runs the full
 gauntlet, and on green the operator's standing approval lets it merge. Even
 then it is a branch + PR + CI + audit row — identical to a human's path.
```

## 5. Why these boundaries

**Why the ingest is an API route, not a direct Postgres insert.** The existing
`client_errors` table uses insert-own RLS, which structurally cannot accept a
row from a signed-out visitor. Anonymous failures — the signup that never
submits, the checkout that 500s before an account exists — are both the most
expensive bugs and the ones invisible today. Routing through a service-role
endpoint is the only way to cover them, and it buys IP rate limiting, a second
PII scrub, and server-stamped fields the client cannot forge.

**Why fingerprinting and incident creation live in SQL.** Two serverless
instances processing batches for the same bug must converge on one incident.
The unique partial index on `(fingerprint) WHERE status not in (closed states)`
plus a single `SECURITY DEFINER` function is the only construction that
guarantees it without a distributed lock.

**Why the safety classifier is a database trigger.** Application-layer checks
are bypassable by any future code path — a new endpoint, a migration script, a
mistake. `sh_enforce_patch_level()` runs on every INSERT and UPDATE to
`sh_patches`, so a patch touching Stripe cannot be *stored* claiming to be
auto-deployable. See [05](05-safety-and-approval.md).

**Why three separate AI stages instead of one agent loop.** Serverless wall
clock is finite; each stage's output is a reviewable artifact a human can stop
at; and a failure in patch authoring must not discard a good diagnosis. It also
lets diagnosis run on a cheap fast model and patching on an expensive careful
one, which is the single biggest lever on running cost.

## 6. Failure modes of the platform itself

| The platform's own failure | Consequence | Mitigation |
|---|---|---|
| SDK throws on boot | App still renders | Whole `initSelfHealing()` body is try/caught |
| Ingest endpoint down | Telemetry lost, app unaffected | Backoff to 5 min, queue capped at 200, never surfaced |
| Telemetry floods the DB | Cost, slow queries | Per-IP rate limit, size clamps, severity-aware queue shedding, 14-day retention |
| A detector false-positives | Wasted engineering attention | Statistical floors (n≥20/n≥15), structural-mutation filter, "did anything happen" checks |
| The model hallucinates a fix | Bad code proposed | Confidence gate at 0.55, CI gauntlet, human merge, `diagnosis_correct` tracking |
| The model is prompt-injected | Attempted privilege escalation | DB classifier is authoritative; prompts are data-only; see [09](09-security-and-privacy.md) |
| Runaway AI spend | Budget incident | 5 incidents/invocation cap, 15-min sweep cadence, Anthropic console spend limit |
| The platform itself is the bug | Recursive incidents | `selfheal.telemetry` master kill switch, `/api/selfheal` excluded from its own network monitor |

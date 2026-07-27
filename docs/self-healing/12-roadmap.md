# 12 — Roadmap, risks, testing, and maintenance

## Phasing

**Phase 1 — shipped in this change.** Frontend SDK (contracts, journeys,
sensors, replay, flags, redaction, transport), telemetry ingest, backend
instrumentation, the full database schema with fingerprinting and the safety
classifier, pg_cron detection sweeps, the three-stage AI orchestrator, GitHub
issue/branch/PR automation, the Bug Intelligence dashboard, the CI gauntlet, and
SDK tests.

**Phase 2 — 4–6 weeks.** The gaps that Phase 1 deliberately left, now that real
data exists to justify their shape:

- Session replay **player** in the dashboard (the traces are already captured).
- Instrument the remaining call sites with `expect()` — Phase 1 defines 17
  contracts; wiring every one into its component is mechanical but takes a pass
  through `App.tsx`.
- Email alerting via Resend, with `sh_alerts` deduplication and escalation
  levels (currently the schema supports it; only the dashboard channel is wired).
- Deployment correlation view — `suspected_release` is stored but needs more
  release history to visualise usefully.
- `scripts/sync-contracts.mjs` to generate the migration's seed block from
  `contracts.ts`, closing the one place where the two can drift (they are kept
  in sync by hand today).
- Backend outcome contracts on the Stripe webhook and Resend delivery
  (`reportBackendOutcome()` exists and is unused).

**Phase 3 — 2–3 months.**

- pgvector on `sh_learning` once the corpus passes ~1,000 incidents.
- Automated preview-deployment verification: run the reproduction test against
  the PR's Vercel preview, so "the fix actually fixes it" is proven rather than
  asserted.
- Synthetic monitoring — run the critical journeys against production on a
  schedule, so a broken signup is detected at 3am with zero users awake to
  trigger it. This is the single biggest remaining detection gap: everything in
  Phase 1 requires a real user to hit the bug first.
- Anomaly detection on metric rollups (seasonal baselines rather than fixed
  floors).
- Slack/Discord notification channels.

**Phase 4 — 6+ months.**

- Multi-hypothesis patching: generate 2–3 candidate fixes, run the regression
  suite against each, present the one that passes.
- Cross-incident clustering — "these 12 incidents share a cause".
- Predictive detection: flag a deploy as risky *before* incidents appear, from
  diff shape and historical regression data.
- Self-tuning thresholds from false-positive feedback.

## Risk register

| # | Risk | L | I | Mitigation | Residual |
|---|---|---|---|---|---|
| 1 | AI proposes a plausible-but-wrong fix that passes CI | M | H | Confidence gate, human merge above L1, regression tests, `diagnosis_correct` tracking, rollback path | **Medium** — the primary residual risk; accepted because L2/L3 require human merge |
| 2 | False positives cause alert fatigue | H | H | Statistical floors, structural-mutation filter, severity gating, Phase 0 shadow week | Low if Phase 0 is not skipped |
| 3 | PII leaks into telemetry | L | **Critical** | Three independent layers, no-DOM-capture replay design, E2E test | Low |
| 4 | Telemetry degrades app performance | L | H | Sampling, batching, idle flush, bounded queue, full failure isolation | Low |
| 5 | Runaway AI spend | M | M | Per-invocation cap, sweep cadence, confidence gate, console spend limit | Low |
| 6 | Prompt injection escalates privileges | L | **Critical** | DB trigger is authoritative and reads no prompts; no tool access; scrubbing | Very low |
| 7 | Fingerprint over-splitting → incident spam + cost | M | M | `sh_normalise()` collapses uuids/numbers; tunable | Medium — expect tuning in month one |
| 8 | Fingerprint over-merging → distinct bugs conflated | M | M | Fingerprint includes kind + route + component | Low |
| 9 | Operator rubber-stamps approvals | M | H | Confidence, alternatives, and evidence are all surfaced; Level 3 banner; audit log | **Medium** — a process risk, not a technical one |
| 10 | Platform outage hides real bugs | L | M | Sweep freshness monitoring; detection is independent of AI | Low |
| 11 | Schema migration issues | L | M | Idempotent, additive-only, no changes to existing tables | Very low |
| 12 | Generated tests that pass on broken builds | M | M | Fail-before/pass-after requirement; `stdout_tail` recorded to distinguish wrong-reason failures | Medium |

Risks 1 and 9 are the ones to watch. Both are about **human trust calibration**,
not code: an operator who trusts the AI too much and one who trusts it too
little both make the platform worse. `sh_learning.diagnosis_correct` is the
instrument for measuring which way it is drifting, and reviewing it monthly is a
maintenance task below, not an optional nicety.

## Testing strategy

| Layer | Coverage | Where |
|---|---|---|
| SDK behaviour | Boot safety, PII exclusion, dead-click detection, failure isolation, table inaccessibility, admin gating | `tests/selfheal.spec.ts` (12 tests, 2 viewports) |
| Detection thresholds | Synthetic event streams asserting the sweep opens/doesn't open incidents | **Phase 2** — needs a seeded test database |
| Safety classifier | `sh_classify_approval()` against a corpus of representative diffs | `supabase/tests/sh_classify_approval_corpus.sql` — 16 cases, run by hand after any classifier change |
| Ingest validation | Malformed, oversized, and hostile batches | **Phase 2** |
| Dashboard | Admin gating covered; interaction flows | Phase 2 |
| Generated tests | Fail-before/pass-after harness | Phase 3 |

The classifier corpus (`supabase/tests/sh_classify_approval_corpus.sql`) earned
its keep on its first run against the live database: it caught that a diff
changing premium **gating** classified as `pr_only` rather than `manual`. The
keyword list covered the payment rails — stripe, billing, checkout,
subscription, price, invoice — but not entitlement logic, which is just as
money-critical. Automation could have opened a mergeable PR that gave the
product away. `premium`, `entitlement`, `paywall`, `credits` and `quota` are now
in the list, and the corpus includes a negative control so nobody "fixes" a
future gap by adding a keyword broad enough (`gate`) to route all routine work
to manual review.

Remaining gap: the corpus is run by hand. Wiring it into CI needs a database
connection the workflow does not currently have — Phase 2.

Two tests in the current suite deserve mention as regression protection against
mistakes already made: the dead-click test caught a detector that counted the
running timer's mutations as "the button worked" (it would have suppressed 100%
of real dead clicks), and the flush helper documents why a synthetic
`visibilitychange` is insufficient.

## Monitoring strategy

See [10 — Monitoring the monitor](10-operations.md#monitoring-the-monitor) for
the metric table. The philosophy: this platform monitors the app, and a **human
monitors the platform, weekly**. Automating platform-health alerting in Phase 1
would produce the first false positives, at the worst possible time for
operator trust.

## Documentation plan

| Document | Audience | Owner | Cadence |
|---|---|---|---|
| `docs/self-healing/*` (this set) | Engineers | Platform owner | On architectural change |
| `src/selfheal/*` header comments | Anyone reading the code | Author | With the code |
| `tests/generated/README.md` | Reviewers of AI-authored tests | Platform owner | Rare |
| Runbooks ([10](10-operations.md#runbooks)) | On-call | Platform owner | After each incident that wasn't covered |
| Contract catalogue | Product + engineering | Feature authors | When adding a contract |
| Privacy statement | Users | Owner | Before Phase 0 replay is enabled |

The privacy statement is a hard prerequisite, not a nice-to-have: `docs/
accessibility/accessibility-statement.md` sets the precedent for user-facing
statements in this project, and enabling replay without one would be
inconsistent with how the project already handles user-facing commitments.

## Maintenance roadmap

**Weekly** — review new incidents for false positives; check sweep freshness;
check AI spend.

**Monthly** — review `diagnosis_correct` and patch acceptance rate; tune
contract floors against actual baselines; review Level 1 auto-deploys (every
one, individually — the moment nobody reads them is the moment the tier stops
being safe); prune resolved incidents older than a quarter.

**Quarterly** — re-tune detector thresholds against the season's traffic; review
retention against actual storage cost; **audit the classifier keyword list
against the codebase** (a new payment provider or auth surface that isn't in the
list is a silent Level 3 bypass); review the CI/DB classifier duplication for
drift.

**Annually** — re-evaluate build vs. buy ([11](11-cost.md)); re-run the threat
model; review model choices against what is current.

## Known limitations

Stated plainly, because a blueprint that only lists strengths is not useful:

1. **Detection requires a real user to hit the bug.** There is no synthetic
   monitoring in Phase 1, so a bug that only affects signup at 3am waits for a
   3am signup. Phase 3.
2. **Replay cannot show you the screen.** By design ([09](09-security-and-privacy.md)),
   but it means some visual bugs remain hard to diagnose from telemetry alone.
3. **Patch quality is unproven at scale.** The confidence gate and CI gauntlet
   bound the damage, but nobody should expect a high acceptance rate in month one.
4. **Contracts require manual instrumentation.** The 17 shipped here cover the
   critical paths; everything else is invisible to outcome tracking until
   someone writes a contract for it.
5. **Single-operator assumptions.** Assignment, escalation policies, and on-call
   rotation are schema-supported but not built.
6. **Thresholds are educated guesses** until Phase 0 produces real data. This is
   expected, and the reason Phase 0 exists.

# 11 — Cost

All figures are USD/month at list prices as of the design date. Treat them as
order-of-magnitude: the point is which term dominates at each tier, not the
third significant figure. Actual spend is **measured**, not projected —
`sh_diagnoses` and `sh_patches` record token counts and `cost_usd` on every row.

## Cost model

### Storage (Supabase Postgres)

Row sizes: `sh_events` ≈ 400B (JSONB payload dominates), `sh_outcomes` ≈ 300B,
`sh_sessions` ≈ 250B. With 14/30/90-day retention:

| DAU | `sh_events` steady state | Outcomes (90d) | Total DB |
|---|---|---|---|
| 100 | 22K rows / ~9MB | 36K / ~11MB | <50MB |
| 1,000 | 224K / ~90MB | 360K / ~110MB | ~250MB |
| 100,000 | 22M / ~9GB | 36M / ~11GB | ~25GB |
| 1,000,000 | 224M / ~90GB | 360M / ~110GB | ~250GB† |

† At this tier `sh_events` moves off Postgres entirely — see
[06](06-scalability.md). The Postgres figure drops to ~15GB.

### Replay storage

25% sampling, ~30KB/trace, 30-day retention, uploaded only when a batch carries
an incident (a small fraction of sessions):

| DAU | Traces stored/day | 30-day footprint |
|---|---|---|
| 1,000 | ~30 | ~27MB |
| 100,000 | ~3,000 | ~2.7GB |
| 1,000,000 | ~30,000 (at 5% sampling) | ~13GB |

### AI

Diagnosis on Haiku (~$1/$5 per MTok): ~15K input + ~800 output ≈ **$0.019** per
incident. Patch on Sonnet (~$3/$15 per MTok): ~40K input + ~3K output ≈
**$0.165** per patch. Reproduction is similar to patching.

Incidents grow far slower than users because of fingerprint dedupe, and only
diagnoses above the 0.55 confidence gate proceed to the expensive stages.

| DAU | Incidents/day | Diagnoses | Patches (~40%) | AI/month |
|---|---|---|---|---|
| 100 | 1.5 | 45/mo | 18/mo | **~$4** |
| 1,000 | 10 | 300/mo | 120/mo | **~$26** |
| 100,000 | 120 | 3,600/mo | 1,440/mo | **~$307** |
| 1,000,000 | 500 | 15,000/mo | 6,000/mo | **~$1,275** |

### Compute

Vercel function invocations: ~3 telemetry batches/session. At 1,000 DAU that is
~180K invocations/month — inside the Pro plan's included allowance. At 1M DAU,
~180M invocations/month is the dominant infrastructure cost and is precisely
why [06](06-scalability.md) moves ingest behind a queue at that tier.

## Totals

| Tier | Supabase | Storage | AI | Vercel Δ | Upstash | **Total** |
|---|---|---|---|---|---|---|
| 100 DAU | $0 (Free) | ~$0 | $4 | $0 | $0 | **~$4** |
| 1,000 DAU | $25 (Pro) | ~$1 | $26 | $0 | $0 | **~$52** |
| 100,000 DAU | ~$150 | ~$10 | $307 | ~$200 | ~$20 | **~$690** |
| 1,000,000 DAU | ~$700 | ~$60 | $1,275 | ~$1,200 | ~$100 | **~$3,335** |

At 1M DAU, ~$3.3K/month is **$0.0033 per user per month**, and it displaces
roughly $4–6K/month of equivalent third-party tooling (below) while producing
something none of that tooling does: verified fixes.

## Build vs. buy

| Capability | Third party | Their cost at 100K DAU | This platform |
|---|---|---|---|
| Error tracking | Sentry | ~$500–1,500/mo | ✅ included |
| Session replay | LogRocket / FullStory | ~$1,000–3,000/mo | ✅ interaction traces (privacy-first) |
| Product analytics | PostHog | ~$500–1,500/mo | Partial — `app_events` already covers this |
| Feature flags | LaunchDarkly | ~$500–2,000/mo | ✅ included, with auto-rollback |
| Uptime / APM | Datadog | ~$1,000+/mo | Partial — backend instrumentation |
| **Outcome tracking** | **nothing sells this** | — | ✅ the differentiator |
| **AI RCA + patching** | early/experimental | — | ✅ |
| **Combined** | | **~$3,500–9,000/mo** | **~$690/mo** |

### The honest case for buying

Sentry's stack-trace grouping, source-map handling, and release health are
years ahead of anything reasonable to build. LaunchDarkly's flag targeting is
far richer. PostHog's funnels are better than ours will be.

**When to buy instead:** if the team grows past ~5 engineers, if error volume
outpaces the ability to tune fingerprinting, or if SOC 2 makes a vendor's
compliance posture cheaper than proving your own.

**Why build here, now:** the thing that actually matters — *did the feature
reach its intended outcome* — is not a product any vendor sells, because it
requires per-feature knowledge of the application. That is the expensive,
valuable, non-purchasable part. Everything else in this platform is
scaffolding around it, and the scaffolding happens to be cheap because Supabase
and Vercel are already paid for.

**A hybrid is entirely reasonable:** keep outcome contracts, journeys, the AI
loop, and the dashboard; send raw crashes to Sentry for its superior grouping.
The module boundaries in [01](01-architecture.md) make that a contained change
to `sensors.ts` and nothing else.

## Cost controls, in order of leverage

1. **Model split** — Haiku for diagnosis, Sonnet for patching. ~3× on the
   dominant AI term.
2. **Confidence gate (0.55)** — skips the expensive stage exactly when it would
   waste a reviewer's time anyway.
3. **Fingerprint dedupe** — the reason 1M users don't produce 1M incidents.
   Improving `sh_normalise()` is the highest-leverage cost work available.
4. **Sampling** — 10% for perf events, 50% for low severity, 25% for replay.
   All single-value changes.
5. **Retention** — 14/30/90 days, enforced by cron.
6. **Per-invocation cap (5)** — bounds the worst case when an outage generates a
   thousand incidents at once.
7. **Sweep cadence (15 min)** — a 14-minute-old incident is not meaningfully
   worse than a 1-minute-old one, and critical incidents alert immediately
   regardless.
8. **Anthropic console spend limit** — the hard backstop behind every in-app
   control, exactly as the existing `generate-tasks` quota system does.

## Runaway scenarios and their bounds

| Scenario | Uncontrolled | Bounded by | Bounded cost |
|---|---|---|---|
| Infinite render loop, 10K events/s from one user | Unbounded | 240 batches/hr/IP + 200-event queue cap | ~$0 |
| Bad deploy → 100K users hit one bug | 100K incidents | Fingerprint dedupe | 1 incident, ~$0.02 |
| Poor normalisation → 1,000 distinct fingerprints | 1,000 diagnoses | 5/invocation × 96 sweeps/day | ≤480/day ≈ $9/day, visible immediately |
| Repro loop never converges | Unbounded | 3-attempt cap | ~$0.50/incident |
| Malicious telemetry flood | Unbounded storage | Rate limit + size caps + retention | Negligible |

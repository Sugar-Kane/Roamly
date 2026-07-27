# Roamly Self-Healing Platform

> A user should almost never need to submit a bug report.

This directory is the engineering blueprint for the platform that makes that
true: a system that detects a broken feature from user behaviour, diagnoses the
cause, writes a failing test, proposes a fix, verifies it, and puts one decision
in front of a human — ship or don't.

## The core idea, in one paragraph

Conventional monitoring watches for **errors**. That is the wrong signal,
because the bugs that actually cost Roamly users are silent: the Create Study
Plan button that posts, gets a 200, and never renders the plan; the upload that
finishes and never produces tasks; the premium gate that resolves to "locked"
for someone who paid. Nothing throws, so an error tracker reports 100% health
while the user quietly gives up and stops opening the app. This platform
instead watches for **outcomes**. Every important feature declares what "it
worked" means — a row exists, a route was entered, a toast appeared — and
anything that fails to reach its declared outcome inside its timeout is a
defect, reported with exactly which expectation went unmet. That diff is both
the detector and the first line of the diagnosis.

## Document map

| # | Document | What it answers |
|---|---|---|
| 01 | [Architecture](01-architecture.md) | High- and low-level design, module boundaries, sequence diagrams |
| 02 | [Data model](02-data-model.md) | Every table, why it exists, retention, partitioning path |
| 03 | [Detection](03-detection.md) | Outcome contracts, journeys, sensors, thresholds and their justification |
| 04 | [AI orchestration](04-ai-orchestration.md) | Evidence collection, RCA, reproduction, patch authoring, continuous learning |
| 05 | [Safety and approval](05-safety-and-approval.md) | The three levels, how they are enforced in four independent layers |
| 06 | [Scalability](06-scalability.md) | 10 → 1,000,000 users, with the specific change at each tier |
| 07 | [API contracts](07-api-contracts.md) | Every endpoint and RPC, request/response shapes |
| 08 | [Dashboard](08-dashboard.md) | Bug Intelligence UI/UX, information architecture |
| 09 | [Security and privacy](09-security-and-privacy.md) | Threat model, PII handling, prompt injection, OWASP mapping |
| 10 | [Operations](10-operations.md) | Rollout, deployment, rollback, disaster recovery, runbooks |
| 11 | [Cost](11-cost.md) | Per-tier cost model, build-vs-buy comparison, controls |
| 12 | [Roadmap](12-roadmap.md) | Phasing, risk register, future enhancements, maintenance |

## What is implemented in this change

Phase 1 is real code, not a proposal:

```
src/selfheal/            Frontend SDK — contracts, journeys, sensors, replay, flags
  types.ts               Shared vocabulary
  contracts.ts           17 feature contracts + 6 journeys (source of truth)
  outcomes.ts            The expect() runtime — outcome windows and recovery
  journeys.ts            Multi-step flow tracking, survives reloads and redirects
  sensors.ts             Dead clicks, rage clicks, stuck spinners, errors, perf
  net.ts                 One fetch/XHR wrapper, two consumers
  replay.ts              Privacy-aware interaction trace (not DOM replay — see 09)
  redact.ts              PII masking, layer 1 of 3
  flags.ts               Kill switches and deterministic rollout
  transport.ts           Batched, bounded, failure-isolated ingest
  session.ts             Session + rotating anonymous identity

api/
  telemetry.ts           Ingest — anonymous-capable, rate-limited, double-scrubbed
  _scrub.ts              Server-side PII scrubbing, layer 2 of 3
  _instrument.ts         Backend route wrapper — traces, incidents, dependency triage
  selfheal-investigate.ts  AI: evidence → root cause → repro → patch
  selfheal-action.ts     Approve / reject / PR / rollback / kill switch

supabase/migrations/20260727120000_self_healing_platform.sql
                         17 tables, fingerprinting, priority scoring, the safety
                         classifier, pg_cron detection sweeps, admin RPCs

src/adminSelfHealing.tsx  Bug Intelligence dashboard
.github/workflows/       self-healing.yml (verification gauntlet), selfheal-sweep.yml
tests/selfheal.spec.ts   SDK behaviour tests
tests/generated/         Where AI-authored reproduction tests land
```

## The five properties everything here is designed around

1. **It must never break the app it monitors.** Every SDK entry point is
   failure-isolated; the transport degrades to silence, never to a retry storm;
   a broken flag service fails open. A monitoring system that can take down the
   product is worse than no monitoring system.

2. **It must never leak user content.** Roamly holds study material that can
   include patient case details. Telemetry captures *shape*, never *content* —
   three independent layers enforce it, on the assumption that any one of them
   will eventually be bypassed.

3. **Automation must never be able to escalate its own privileges.** The AI
   proposes an approval level; the database decides. Payments, auth, RLS, and
   schema are unreachable by automation no matter what any model outputs,
   because the enforcement lives on a write path the model cannot influence.

4. **A human's attention is the scarcest resource.** Every threshold in
   `03-detection.md` is tuned to make the innocent case quiet. A false positive
   costs more than a missed low-severity bug.

5. **Every module is independently replaceable.** The detection layer doesn't
   know an LLM exists. The AI layer reads rows and writes rows. The dashboard
   reads RPCs. Swapping the model, the ingest transport, or the dashboard is a
   contained change.

## Getting it running

See [10-operations.md](10-operations.md#initial-setup). In short: apply the
migration, create the private `selfheal-replays` storage bucket, set
`TELEMETRY_IP_SALT` and `CRON_SECRET`, and the SDK starts reporting on the next
deploy. Every piece degrades to a no-op when its configuration is absent, so a
partial rollout is safe.

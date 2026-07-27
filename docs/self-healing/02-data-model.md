# 02 — Data model

Source of truth: `supabase/migrations/20260727120000_self_healing_platform.sql`.
This document explains *why* each table looks the way it does.

## Access model — the single most important thing on this page

Every `sh_*` table has **RLS enabled with zero policies**. That is not an
oversight; it is the design. No browser session — anonymous, authenticated, or
premium — can read or write any of these tables directly. There are exactly
three doors:

1. **The service role**, used only by the `/api/selfheal` handlers,
   `api/_instrument.ts`, and the CI reporter.
2. **`is_admin()`-gated `SECURITY DEFINER` RPCs**, which is how the dashboard
   reads. Same pattern as the existing admin dashboard.
3. **`sh_public_flags()`**, the one deliberate exception: flags must be readable
   by everyone including signed-out visitors, or a kill switch cannot reach the
   users who need it. It exposes only the serving projection — never thresholds,
   never audit state.

This differs from `client_errors`/`app_events`, which grant clients insert-own.
The tradeoff is discussed in [01 §5](01-architecture.md#5-why-these-boundaries):
insert-own cannot express "anonymous", and anonymous failures are the expensive
ones.

## Entity relationships

```
sh_feature_contracts ──┐
                       ├──< sh_outcomes >──┐
sh_journeys ───────────┴──< sh_journey_runs┤
                                           │
sh_sessions ──< sh_events >────────────────┼──> sh_incidents
                                           │        │
                                           │        ├──< sh_incident_evidence
                                           │        ├──< sh_diagnoses (versioned)
                                           │        ├──< sh_repro_attempts
                                           │        ├──< sh_patches ──< sh_audit_log
                                           │        ├──< sh_alerts
                                           │        └──> sh_learning (survives purge)
sh_flags ──< sh_flag_audit
sh_metrics_hourly  (rollups; survive raw-data purge)
```

## Table reference

### Definition tables

**`sh_feature_contracts`** — what "it worked" means, per feature. Declared in
`src/selfheal/contracts.ts` (the editing surface) and seeded here so timeouts,
severities, and success floors can be re-tuned in production **without a
deploy**. That matters: the first weeks of running this platform are mostly
threshold tuning, and needing a deploy per adjustment would make it painful
enough that nobody does it.

**`sh_journeys`** — ordered step sequences with their own completion floors.
Journeys catch what contracts can't: the user who never reaches step 3 at all.

### Volume tables

**`sh_sessions`** — one row per browser session. `user_id` is **nullable on
purpose**. `ip_hash` is a salted SHA-256 prefix, never a raw IP; it exists
solely to correlate an abuse burst to one origin. `anon_id` is a device
pseudonym that **rotates every 30 days**, so no durable cross-session identity
graph accumulates for signed-out visitors.

**`sh_events`** — the raw stream. High volume, 14-day retention, append-only.
This is the evidence pool the AI reads; `sh_metrics_hourly` is what survives
long-term. `fingerprint` and `incident_id` are set only for incident-worthy
events, and both are partial-indexed accordingly.

**`sh_outcomes`** — one row per "user tried to do the thing". The
`expectations` JSONB column stores which expectations were met and which were
not: **that diff is the highest-value column in the schema**, because it turns
"something failed" into "the database row never appeared but the toast did",
which is nearly a diagnosis on its own.

**`sh_journey_runs`** — in-flight and settled journeys. The partial index on
`(updated_at) WHERE status = 'started'` is what makes the timeout sweep cheap.

### Incident tables

**`sh_incidents`** — the deduplicated unit of work.

```sql
create unique index sh_incidents_open_fingerprint
  on sh_incidents (fingerprint)
  where status not in ('resolved','ignored','rejected');
```

That partial unique index is the whole dedupe strategy: **one open incident per
fingerprint**, enforced by the database rather than by application logic, so
concurrent serverless instances converge. Resolved incidents may recur, which
is how regressions are detected (a new incident with a fingerprint that already
exists in `sh_learning`).

Timing columns (`detected_ms`, `diagnosed_ms`, `repaired_ms`) are denormalised
so MTTD/MTTR are a single scan rather than a join against the audit log.

`priority_score` is deliberately arithmetic, not learned:

```
severity   0-40   how bad is one occurrence
reach      0-35   ln(distinct users) × 7, capped
surface    0-15   does it touch money/auth/data
freshness  0-10   is it happening right now
```

An on-call engineer must be able to explain at 3am why they were paged. A model
score cannot be explained; a weighted sum can.

**`sh_incident_evidence`** — kept separate from the incident so the incident row
stays small and evidence ages out on its own clock. Small structured evidence is
inline JSONB; anything large is a `storage_ref`.

**`sh_diagnoses`** — versioned, never overwritten. Re-running analysis appends,
so we can measure whether the model is improving and roll back a bad prompt.
Token counts and `cost_usd` are recorded per diagnosis, which is what makes the
cost model in [11](11-cost.md) measured rather than estimated.

**`sh_repro_attempts`** — capped at 3 attempts by the orchestrator. Artifacts
(trace.zip, screenshots, video) go to storage; only pointers land here.

**`sh_patches`** — proposed fixes. `approval_level` is guarded by a trigger (see
[05](05-safety-and-approval.md)); `level_reason` records *why* a tier was
assigned, so a Level 1 auto-deploy can always be explained after the fact.

**`sh_audit_log`** — append-only. Every automated action and every human
decision, forever. This is the table a compliance auditor reads. Nothing in the
platform deletes from it.

**`sh_learning`** — the corpus. Deliberately denormalised and long-retention, so
purging raw telemetry never destroys institutional memory. `diagnosis_correct`
is the single most important column in the whole schema: it is how we answer
"is this platform actually working, or is it generating confident nonsense?"
It is set to `false` automatically on rejection and rollback, and to `true` when
an incident resolves with a deployed patch.

The `embedding` path is provisioned but not enabled: pgvector goes in at the
~1,000-incident mark. Below that, trigram + tag + route matching retrieves just
as well for a fraction of the operational cost. Enabling it early would be
architecture for its own sake.

### Control tables

**`sh_flags`** — kill switches and rollout. `auto_rollback_error_rate` +
`auto_rollback_window_min` are what make the flag system part of the healing
loop rather than a separate product feature: `sh_sweep_flag_rollback()` disables
a flag whose surface's error rate crosses its threshold, in under a minute, with
no deploy and no human.

**`sh_alerts`** — one row per `(incident, channel)`, uniquely constrained on
`dedupe_key`. Re-alerting requires **escalation**, not repetition. Alert fatigue
is the failure mode that kills monitoring platforms, and a schema that makes
duplicate alerts impossible is stronger than a convention that discourages them.

**`sh_metrics_hourly`** — rollups written by `sh_rollup_and_prune()`. Makes the
dashboard O(rows in window) instead of O(events), and survives raw purge.

## Retention

| Table | Retention | Rationale |
|---|---|---|
| `sh_events` | 14 days | Cheap to produce, expensive to keep; rollups carry the trend |
| `sh_sessions` | 30 days | Long enough to investigate a slow-burn incident |
| `sh_outcomes` | 90 days | Quarterly success-rate comparisons |
| `sh_journey_runs` | 90 days | Same |
| `sh_metrics_hourly` | 400 days | Year-over-year with a margin |
| `sh_incidents`, `sh_patches`, `sh_diagnoses` | indefinite | Small, and the history is the value |
| `sh_audit_log` | indefinite | Compliance |
| `sh_learning` | indefinite | The corpus is the compounding asset |
| Replay bundles (Storage) | 30 days | Largest artifact, highest privacy surface |

Enforced by `sh_rollup_and_prune()` on an hourly pg_cron schedule. Retention is
explicit and in code, not a policy document nobody executes.

## Partitioning path

At current volume a single `sh_events` table with time-ordered indexes is
correct — partitioning adds real operational complexity for no benefit yet. The
trigger to convert is **`sh_events` exceeding ~50M rows or the daily delete in
`sh_rollup_and_prune()` exceeding 30 seconds**, whichever comes first. At that
point: convert to daily `RANGE` partitions on `ts`, replace the delete with
`DETACH PARTITION` + `DROP` (O(1) instead of O(rows)), and add `pg_partman`.
Sized in [06](06-scalability.md).

## Migration safety

The migration is idempotent (`create ... if not exists`, `on conflict do
update`) and guards the pg_cron block behind an extension check so it applies
cleanly on a local or CI database without pg_cron. It creates no policies on
existing tables and modifies no existing table, so it cannot affect the running
app: the worst case of a bad apply is that the self-healing tables don't exist,
and every consumer of them degrades to a no-op.

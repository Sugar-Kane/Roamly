# 06 — Scalability

The architecture does not change between 10 users and 1,000,000. What changes is
where data is stored and how it is aggregated. Each tier below names the
**specific trigger** and the **specific change**, so nobody has to guess when to
act — and so nobody builds the 1M-user version at 100 users, which is the more
common and more expensive mistake.

## Volume model

Per active session, assuming the shipped sampling:

| Signal | Per session | Notes |
|---|---|---|
| Session row | 1 | Upserted, not re-inserted |
| Events | ~8 | After sampling; medium+ always kept, low sampled 50%, perf 10% |
| Outcomes | ~4 | One per feature attempt |
| Journey rows | ~1 | Upserted per progression |
| Replay bundle | 0.25 × ~30KB | Only 25% of sessions record, and only uploaded when the batch carries a real problem |
| Batches | ~3 | 10s flush interval, 25-event threshold, unload beacon |

Assume 2 sessions/user/day.

| Tier | DAU | Events/day | `sh_events` at 14d | Batches/day | Incidents/day |
|---|---|---|---|---|---|
| 10 | 10 | 160 | 2.2K | 60 | <1 |
| 100 | 100 | 1.6K | 22K | 600 | 1–2 |
| 1,000 | 1,000 | 16K | 224K | 6K | 5–15 |
| 100,000 | 100,000 | 1.6M | 22M | 600K | 50–200 |
| 1,000,000 | 1,000,000 | 16M | 224M | 6M | 200–1,000 |

Incidents grow far slower than events because of fingerprint dedupe: one broken
deploy affecting every user is **one** incident row, not one per user. That is
the property that makes the human-facing side of this scale at all.

## Tier changes

### 10 – 1,000 users — ship as written
Single Postgres, no partitioning, 1-minute pg_cron sweeps, 15-minute AI sweep.
`sh_events` peaks around 224K rows at 14-day retention, which is nothing.
Supabase Free/Pro is sufficient throughout.

**Do not partition, do not add a queue, do not add pgvector.** Each would add
operational surface for no measurable benefit, and would have to be maintained
by whoever is on call.

### 1,000 – 100,000 users — the first real change

**Trigger:** `sh_events` > 50M rows, *or* the delete inside
`sh_rollup_and_prune()` exceeding 30s, whichever comes first.

1. **Partition `sh_events`** — daily `RANGE` partitions on `ts`, managed by
   `pg_partman`. Retention becomes `DETACH PARTITION` + `DROP`, which is O(1)
   instead of O(rows). This is the change that matters most; a nightly delete of
   millions of rows will otherwise dominate database load.
2. **Batch the ingest writes.** `insertEvents()` currently issues one
   `sh_record_incident` RPC per incident candidate. Above ~50 batches/second
   this becomes the bottleneck. Move to a single set-returning RPC that takes
   the whole batch as JSONB and loops server-side — one round trip per batch
   instead of N.
3. **Raise the per-IP rate limit** and add a per-`anon_id` limit, so shared
   networks (a university library — very much Roamly's audience) aren't
   throttled as one client.
4. **Reduce replay sampling** to 5–10%. It is the dominant storage cost and its
   marginal value falls sharply with volume: at 100K DAU, 5% still gives
   thousands of traces per incident.
5. **Move rollups to 5-minute buckets** for the recent window so the dashboard
   stops touching raw events at all.

### 100,000 – 1,000,000 users — decouple ingest from Postgres

**Trigger:** ingest write latency p95 > 500ms, *or* `sh_events` inserts
consuming >20% of database CPU.

1. **Put a queue in front of ingest.** `/api/telemetry` writes to a durable
   buffer (Upstash QStash — already in the stack via `@upstash/redis` — or
   Kafka/Redpanda if the volume justifies it) and returns 202 immediately. A
   consumer drains it into Postgres in large batches. This decouples user-facing
   latency from database write throughput, which is the fundamental scaling
   constraint of the current design.
2. **Move `sh_events` off Postgres entirely.** ClickHouse or Timescale for the
   raw stream; Postgres keeps incidents, patches, audit, and learning — the
   small, relational, transactional data it is good at. Raw telemetry is
   append-only, time-ordered, and analytically queried, which is exactly the
   workload a columnar store is for.
3. **Read replicas** for the dashboard, so an admin running a 90-day query
   cannot slow ingest.
4. **pgvector for `sh_learning`** — at ~1,000+ resolved incidents, exact
   fingerprint/route matching starts missing genuinely similar bugs.
5. **Shard the AI sweep by severity.** Critical incidents get a 5-minute
   cadence; everything else 30 minutes. At this volume a flat cadence either
   spends too much or reacts too slowly, and there is no single value that is
   right for both.
6. **Regional ingest.** Vercel edge functions co-located with users, writing to
   a regional queue, with a single consumer region. Telemetry latency stops
   mattering for correctness but starts mattering for beacon delivery on unload.

## What never changes

- The SDK's public API (`expect`, `startJourney`, `isEnabled`).
- The contract and journey definitions.
- The incident/diagnosis/patch/audit schema.
- The safety classifier and its four enforcement layers.
- The dashboard's RPC contracts.

Every tier change above is confined to the storage and transport layers, behind
interfaces that already exist. That is what "independently replaceable modules"
buys, and it is why the boundaries in [01](01-architecture.md) are drawn where
they are.

## Load characteristics

**Ingest is the only hot path.** It is stateless, horizontally scalable by
default on Vercel, and does bounded work: parse (capped at 128KB), scrub
(bounded depth and key count), and N inserts. There is no fan-out and no
cross-request coordination.

**Detection sweeps are the heaviest recurring queries.** `sh_sweep_contracts`
aggregates `sh_outcomes` over a 15-minute window — with the
`(contract_key, started_at desc)` index this is an index range scan over minutes
of data, not a table scan. It stays cheap as long as the window stays short,
which is why the sweep window is a parameter and not a constant.

**The dashboard is bounded by design.** Every list RPC clamps its limit
(`least(p_limit, 200)`), the overview reads rollups rather than raw events, and
incident detail is a single keyed lookup with lateral joins.

## Cost of scale

See [11](11-cost.md) for full numbers. The short version: database storage and
AI calls dominate, both grow sub-linearly with users (dedupe and sampling), and
the controls that bound them — retention, sampling rates, per-invocation caps —
are all single-value changes rather than architectural ones.

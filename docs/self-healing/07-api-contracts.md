# 07 — API contracts

## One route, three operations

All three self-healing operations share a single Vercel function,
`api/selfheal.ts`, dispatched on a top-level **`op`** field:

| `op` | Handler | Auth |
|---|---|---|
| `telemetry` | `api/_selfheal-telemetry.ts` | none required (anonymous-capable) |
| `investigate` | `api/_selfheal-investigate.ts` | `CRON_SECRET` or admin JWT |
| `action` | `api/_selfheal-action.ts` | admin JWT |

**Why one route:** Vercel counts every non-underscore file in `api/` as a
serverless function, and the Hobby plan permits 12 per deployment. The repo
already ships 11, so three new routes failed the deploy outright
(`exceeded_serverless_functions_per_deployment`). Splitting them back into
three files on a Pro plan is mechanical — each handler is already a
self-contained module with its own authentication.

Two properties make the sharing safe and fast: authentication is **per
handler**, not per function, so the router grants nothing and a misroute
merely reaches a handler that then rejects the caller; and the heavy
dependencies (Anthropic SDK, GitHub client) are **dynamically imported** only
on the paths that use them, so the hot ingest path does not pay their
cold-start cost.

Dispatch deliberately uses `op` rather than `action`, because the
approve/reject handler already uses `action` for its own verbs.

---

## `op: "telemetry"`

The ingest operation. **Authentication optional** — see
[01 §5](01-architecture.md#5-why-these-boundaries) for why anonymous batches are
accepted, and [09](09-security-and-privacy.md) for how that is made safe.

**Headers:** `content-type: application/json`, optionally
`authorization: Bearer <supabase jwt>`.

**Request**

```jsonc
{
  "op": "telemetry",
  "v": 1,
  "session": {                        // full context on the first batch only
    "sessionId": "uuid",              // required, client-generated, unguessable
    "anonId": "uuid",                 // rotates every 30 days
    "release": "abc123f",
    "environment": "production",
    "device": "phone|tablet|pc",
    "os": "iOS", "browser": "Safari",
    "viewport": { "w": 390, "h": 844 },
    "locale": "en-GB", "timezone": "Europe/London",
    "isPremium": false,
    "entryRoute": "focus"
  },
  // later batches send only: { "session": { "id": "uuid" } }
  "events": [{
    "kind": "dead_click",             // one of the 21 EventKind values
    "severity": "medium",
    "route": "focus",
    "component": "src/FocusMode.tsx",
    "payload": { "element": "button\"Start\"", "path": "div>button" },
    "ts": 1769500000000
  }],
  "outcomes": [{
    "id": "uuid", "contract_key": "task.create",
    "status": "succeeded|failed|timeout|abandoned",
    "started_at": "iso", "settled_at": "iso", "duration_ms": 4210,
    "route": "tasks", "release": "abc123f", "device": "pc",
    "expectations": [{ "type": "db_row", "met": false }],
    "failed_reason": "unmet: db_row(tasks)",
    "recovery_used": "retry"
  }],
  "journeys": [{
    "id": "uuid", "journey_key": "journey.checkout",
    "status": "started|succeeded|abandoned",
    "current_step": "webhook_premium",
    "steps_done": [{ "step": "upgrade_clicked", "at": 1769500000000 }]
  }],
  "replay": [ /* ReplayFrame[], only when the batch carries an incident */ ],
  "sentAt": 1769500001000
}
```

**Responses**

| Status | Body | Meaning |
|---|---|---|
| 202 | `{ "ok": true, "incidents": 1 }` | Accepted; N incidents opened or folded into |
| 200 | `{ "ok": true, "note": "not_configured" }` | Supabase env absent — no-op |
| 200 | `{ "ok": false }` | Server-side failure. **Deliberately 2xx**: a failed ingest must not trigger the client's retry backoff into a storm |
| 400 | `{ "error": "invalid body" \| "invalid session" \| "unknown op" }` | Malformed, unrecognised `op`, or `sessionId` is not a UUID |
| 413 | `{ "error": "payload too large" }` | >128KB |
| 429 | `{ "error": "…" }` + `retry-after` | >240 batches/hour/IP |

**Limits:** 100 events, 50 outcomes, 25 journeys, 400 replay frames per batch;
excess is truncated, not rejected.

**Server-side normalisation the client cannot override:** `user_id` (from a
verified JWT or null — a client-claimed id is ignored), `ip_hash`, `country`,
`ts` (client timestamps outside now±60s/−24h are replaced with server time), and
a full re-scrub of every payload.

---

## `op: "investigate"`

**Auth:** `Bearer <CRON_SECRET>` (scheduled sweep) **or** `Bearer <admin jwt>`
(admin membership re-checked server-side against `public.admins`).

**Request**

```jsonc
{
  "op": "investigate",
  "incidentId": "uuid",              // optional; omit to sweep the backlog
  "stage": "investigate" | "reproduce" | "patch"   // default "investigate"
}
```

**Response** `200`

```jsonc
{
  "ok": true, "stage": "investigate", "processed": 3,
  "results": [
    { "incidentId": "uuid", "confidence": 0.87, "rootCause": "…" },
    { "incidentId": "uuid", "error": "confidence_too_low", "confidence": 0.41 },
    { "incidentId": "uuid", "error": "max_attempts" }
  ]
}
```

Per-result `error` values: `not_found`, `unparseable`, `no_diagnosis`,
`confidence_too_low`, `max_attempts`, `no_test_generated`,
`unparseable_patch`, `patch_insert_failed`, `stage_failed`.

`401` unauthorized · `403` not_admin · `503` not configured.

Caps at **5 incidents per invocation**.

---

## `op: "action"`

**Auth:** `Bearer <admin jwt>`, required. Rate-limited to 30/5min per admin.

```jsonc
{ "op": "action",
  "action": "approve"|"reject"|"open_pr"|"rollback"|"disable_flag"|"ignore",
  "patchId": "uuid",      // approve | reject | open_pr | rollback
  "incidentId": "uuid",   // ignore
  "flagKey": "rooms.voice",// disable_flag
  "reason": "free text" }
```

| Action | Effect |
|---|---|
| `approve` | Re-runs `sh_classify_approval`, records consent + audit row, opens issue + branch + commits + PR. **Never merges Level 3.** |
| `reject` | Marks rejected, writes an `sh_learning` row with `diagnosis_correct=false`, returns the incident to `diagnosed` |
| `open_pr` | Idempotent; returns the existing PR if one exists |
| `rollback` | Marks rolled back, incident → `regressed`, writes negative learning |
| `disable_flag` | Immediate kill switch + flag audit row |
| `ignore` | Incident → `ignored`, resolution `not_a_bug` |

**Responses:** `200 { ok, pr?, url?, issue?, note? }` · `400` unknown action or
missing id · `401` no token · `403` not an admin · `404` not found · `429`
rate-limited · `500`.

`note` values: `already_deployed`, `already_open`, `github_not_configured`,
`diff_not_machine_applicable`.

---

## Database RPCs (admin dashboard)

All are `SECURITY DEFINER`, gated on `is_admin()`, executable by
`authenticated` only. A non-admin caller receives zero rows (read RPCs) or a
`not_admin` exception (write RPCs) — never an error that leaks whether data
exists.

| RPC | Returns |
|---|---|
| `admin_sh_overview(start, end)` | open/critical incidents, affected users, auto-resolved, awaiting approval, MTTD, MTTR, outcome success rate, journey completion, sessions, error sessions |
| `admin_sh_incidents(status, severity, search, limit, offset)` | Incident list + latest diagnosis confidence, patch status, PR/preview URLs, and `total_count` for pagination. Sorted: awaiting-human first, then `priority_score desc`, then recency |
| `admin_sh_incident_detail(id)` | One JSONB object: incident, latest diagnosis, all diagnoses, patches, repro attempts, evidence, timeline, replay refs, similar prior incidents |
| `admin_sh_feature_health(start, end)` | Per-contract attempts, successes, rate, floor, p95, severity |
| `admin_sh_incident_series(start, end)` | Daily opened / resolved / affected users |
| `admin_sh_set_incident(id, status, severity, assign, resolution)` | void; writes audit |
| `admin_sh_flags()` | All flags |
| `admin_sh_set_flag(key, enabled, rollout, reason)` | void; writes flag audit |

### Public

| RPC | Grants | Returns |
|---|---|---|
| `sh_public_flags()` | `anon`, `authenticated` | key, enabled, rollout_percent, premium_only, beta_only, regions — the serving projection only, never thresholds or audit state |

### Service-role only

`sh_fingerprint`, `sh_record_incident`, `sh_bump_session_counters`,
`sh_classify_approval`, `sh_priority`, `sh_normalise`, `sh_sweep_*`,
`sh_rollup_and_prune`. All revoked from `public`, `anon`, `authenticated`.

---

## SDK surface (`src/selfheal`)

```ts
initSelfHealing(options?: { replaySampleRate?: number; enabled?: boolean }): void
identifySelfHealing(userId: string | null, isPremium: boolean | null): void

expect(key: string, meta?: Record<string, unknown>): OutcomeHandle
//   .satisfy(type, detail?)  .fail(reason)  .succeed()  .cancel()

startJourney(key: string, meta?): void
journeyStep(key: string, step: string, meta?): void
cancelJourney(key: string): void

isEnabled(key: string): boolean          // synchronous, safe in render
refreshFlags(): Promise<void>
activeFlagState(): Record<string, boolean>

reportReactCrash(message, componentStack, stack?): void
forceReplay(): void
flushTelemetry(beacon?: boolean): Promise<void>
```

Unknown contract keys return a no-op handle rather than throwing — instrumentation
must never be able to break the feature it instruments. Unknown flags return
`true` (fail open) — a flag service outage must not hide working features.

// Telemetry ingest — the only write path into the self-healing tables.
//
// Accepts UNAUTHENTICATED batches on purpose. The failures that matter most
// (the signup form that never submits, the checkout that 500s before a session
// exists) happen to users who have no JWT, and today's client_errors reporter
// drops every one of them because RLS insert-own can't express "anonymous".
// Accepting anonymous telemetry is therefore a requirement, and everything
// below exists to make that safe:
//
//   * per-IP rate limiting, with the DB-level per-session caps behind it;
//   * hard size and count clamps before any parsing work;
//   * a server-side PII scrub that re-runs the client's redaction, because a
//     bug in the client redactor must not become a data breach;
//   * no client-supplied identity is trusted: user_id is taken from a verified
//     JWT when one is present and ignored otherwise.
//
// Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELEMETRY_IP_SALT.

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { limitOrResponse, clientIp } from "./_ratelimit.js";
import { apiLog } from "./_log.js";
import { scrubDeep, scrubText } from "./_scrub.js";

const MAX_BODY_BYTES = 128 * 1024;
const MAX_EVENTS = 100;
const MAX_OUTCOMES = 50;
const MAX_JOURNEYS = 25;
const MAX_REPLAY_FRAMES = 400;

const SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);
const EVENT_KINDS = new Set([
  "dead_click", "rage_click", "js_error", "promise_rejection", "react_error",
  "network_error", "slow_request", "spinner_stuck", "nav_failed", "layout_shift",
  "long_task", "memory_pressure", "offline", "a11y_violation", "console_error",
  "chunk_load_failed", "outcome_started", "outcome_ok", "outcome_failed",
  "journey_step", "custom",
]);

/** Kinds that are always worth an incident when severity is high enough. */
const INCIDENT_KINDS = new Set([
  "js_error", "promise_rejection", "react_error", "network_error", "spinner_stuck",
  "nav_failed", "dead_click", "rage_click", "chunk_load_failed", "outcome_failed",
]);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function int(v: unknown, min: number, max: number): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

async function hashIp(ip: string, salt: string): Promise<string> {
  // Salted so the stored value can't be reversed with a rainbow table of the
  // IPv4 space, which is small enough to enumerate exhaustively.
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Batch = {
  v?: number;
  session?: Record<string, unknown>;
  events?: Record<string, unknown>[];
  outcomes?: Record<string, unknown>[];
  journeys?: Record<string, unknown>[];
  replay?: unknown[];
};

export async function handleTelemetry(request: Request): Promise<Response> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: true, note: "not_configured" }, 200);

  const ip = clientIp(request);

  // 240 batches/hour/IP ≈ one every 15s, comfortably above the SDK's 10s flush
  // interval under normal use and far below what a flood would need.
  const limited = await limitOrResponse("telemetry", ip, 240, 3600);
  if (limited) return limited;

  const rawLength = Number(request.headers.get("content-length") || 0);
  if (rawLength > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);

  let batch: Batch;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return json({ error: "payload too large" }, 413);
    batch = JSON.parse(text) as Batch;
  } catch {
    return json({ error: "invalid body" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  // Identity comes from a VERIFIED token or not at all. A client claiming a
  // user_id in the payload is ignored — that would let anyone attribute
  // fabricated incidents to another account.
  let userId: string | null = null;
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const { data } = await admin.auth.getUser(authHeader.slice(7));
      userId = data.user?.id ?? null;
    } catch { /* anonymous is fine */ }
  }

  const sessionRaw = batch.session ?? {};
  const sessionId = sessionRaw.sessionId ?? sessionRaw.id;
  if (!isUuid(sessionId)) return json({ error: "invalid session" }, 400);

  try {
    await upsertSession(admin, sessionId, sessionRaw, userId, ip);

    const events = Array.isArray(batch.events) ? batch.events.slice(0, MAX_EVENTS) : [];
    const outcomes = Array.isArray(batch.outcomes) ? batch.outcomes.slice(0, MAX_OUTCOMES) : [];
    const journeys = Array.isArray(batch.journeys) ? batch.journeys.slice(0, MAX_JOURNEYS) : [];

    const incidents = await insertEvents(admin, sessionId, userId, events, str(sessionRaw.release, 60));
    await insertOutcomes(admin, sessionId, userId, outcomes);
    await insertJourneys(admin, sessionId, userId, journeys);

    if (Array.isArray(batch.replay) && batch.replay.length && incidents > 0) {
      await storeReplay(admin, sessionId, batch.replay.slice(0, MAX_REPLAY_FRAMES));
    }

    apiLog("telemetry", "ingested", {
      session: sessionId, events: events.length, outcomes: outcomes.length,
      journeys: journeys.length, incidents,
    });
    return json({ ok: true, incidents }, 202);
  } catch (error) {
    apiLog("telemetry", "ingest_failed", { message: error instanceof Error ? error.message : "unknown" });
    // 200 on purpose: a failed ingest must never make the client retry into a
    // storm, and the SDK's backoff only triggers on non-2xx.
    return json({ ok: false }, 200);
  }
}

async function upsertSession(
  admin: SupabaseClient, sessionId: string, raw: Record<string, unknown>,
  userId: string | null, ip: string
): Promise<void> {
  const viewport = (raw.viewport ?? {}) as Record<string, unknown>;
  const salt = process.env.TELEMETRY_IP_SALT || "roamly-default-salt";

  // Only the first batch carries full context; later batches send {id} alone.
  const isFull = Boolean(raw.device || raw.browser);
  const patch: Record<string, unknown> = {
    id: sessionId,
    last_seen_at: new Date().toISOString(),
  };
  if (userId) patch.user_id = userId;

  if (isFull) {
    Object.assign(patch, {
      anon_id: str(raw.anonId, 60),
      release: str(raw.release, 60),
      environment: str(raw.environment, 20) ?? "production",
      device: str(raw.device, 20),
      os: str(raw.os, 30),
      browser: str(raw.browser, 30),
      viewport_w: int(viewport.w, 0, 20000),
      viewport_h: int(viewport.h, 0, 20000),
      locale: str(raw.locale, 20),
      timezone: str(raw.timezone, 60),
      entry_route: str(raw.entryRoute, 40),
      is_premium: typeof raw.isPremium === "boolean" ? raw.isPremium : null,
      ip_hash: await hashIp(ip, salt),
      // Vercel resolves geo at the edge; country only, never city-level.
      country: str(process.env.VERCEL_REGION, 10),
      started_at: new Date().toISOString(),
    });
  }

  await admin.from("sh_sessions").upsert(patch, { onConflict: "id" });
}

/**
 * Insert events and open incidents for the ones that warrant it.
 *
 * Fingerprinting and incident creation happen in Postgres (sh_fingerprint /
 * sh_record_incident) rather than here: two serverless instances processing
 * batches for the same bug concurrently must converge on ONE incident, and the
 * unique index plus a single SQL function is the only way to guarantee that.
 */
async function insertEvents(
  admin: SupabaseClient, sessionId: string, userId: string | null,
  events: Record<string, unknown>[], release: string | null
): Promise<number> {
  if (!events.length) return 0;

  const rows: Record<string, unknown>[] = [];
  const incidentCandidates: { row: Record<string, unknown>; message: string }[] = [];

  for (const raw of events) {
    const kind = str(raw.kind, 40);
    if (!kind || !EVENT_KINDS.has(kind)) continue;
    const severity = SEVERITIES.has(String(raw.severity)) ? String(raw.severity) : "info";
    const payload = scrubDeep(raw.payload ?? {}) as Record<string, unknown>;

    const row: Record<string, unknown> = {
      session_id: sessionId,
      user_id: userId,
      // Client clocks are unreliable and trivially forgeable; only accept a
      // client timestamp inside a sane window, else stamp server time.
      ts: sanitizeTs(raw.ts),
      kind,
      severity,
      route: str(raw.route, 40),
      component: str(raw.component, 120),
      payload,
    };
    rows.push(row);

    if (INCIDENT_KINDS.has(kind) && (severity === "high" || severity === "critical")) {
      incidentCandidates.push({ row, message: incidentTitle(kind, payload) });
    }
  }

  if (!rows.length) return 0;
  const { data: inserted } = await admin.from("sh_events").insert(rows).select("id, kind, route, component, payload");

  let opened = 0;
  for (const candidate of incidentCandidates) {
    const payload = candidate.row.payload as Record<string, unknown>;

    // Fingerprinting lives in the database so the normalisation rules exist in
    // exactly one place, and so two concurrent serverless instances handling
    // the same bug converge on one incident rather than racing to create two.
    const { data: fingerprint } = await admin.rpc("sh_fingerprint", {
      p_kind: candidate.row.kind,
      p_message: candidate.message,
      p_route: candidate.row.route,
      p_component: candidate.row.component,
    });
    if (!fingerprint) continue;

    const { data: incidentId, error } = await admin.rpc("sh_record_incident", {
      p_fingerprint: fingerprint,
      p_title: candidate.message,
      p_kind: candidate.row.kind,
      p_severity: candidate.row.severity,
      p_source: "frontend",
      p_route: candidate.row.route,
      p_component: candidate.row.component,
      p_contract_key: str(payload.contract, 80),
      p_journey_key: str(payload.journey, 80),
      p_release: release,
      p_user_id: userId,
      p_session_id: sessionId,
      p_approval_level: approvalFor(String(candidate.row.kind), candidate.row.route as string | null),
      p_first_seen: null,
    });

    if (error || !incidentId) continue;
    opened += 1;

    // Link this session's events to the incident so the AI can pull the full
    // lead-up, and so affected_users/_sessions recount correctly.
    const ids = (inserted ?? []).filter((e: Record<string, unknown>) => e.kind === candidate.row.kind).map((e) => e.id);
    if (ids.length) {
      await admin.from("sh_events").update({ incident_id: incidentId }).in("id", ids);
    }
  }

  await admin.rpc("sh_bump_session_counters", {
    p_session: sessionId,
    p_events: rows.length,
    p_errors: incidentCandidates.length,
    p_rage: rows.filter((r) => r.kind === "rage_click").length,
  }).then(() => undefined, () => undefined);

  return opened;
}

function sanitizeTs(value: unknown): string {
  const n = Number(value);
  const now = Date.now();
  if (!Number.isFinite(n) || n > now + 60_000 || n < now - 86_400_000) return new Date().toISOString();
  return new Date(n).toISOString();
}

function incidentTitle(kind: string, payload: Record<string, unknown>): string {
  const message = scrubText(String(payload.message ?? payload.signal ?? payload.element ?? payload.url ?? ""));
  switch (kind) {
    case "dead_click": return `Dead click: ${payload.element ?? "unknown element"}`;
    case "rage_click": return `Rage clicks: ${payload.element ?? "unknown element"}`;
    case "spinner_stuck": return `Stuck loading state: ${payload.element ?? "spinner"}`;
    case "nav_failed": return `Route renders empty: ${payload.route ?? "unknown"}`;
    case "network_error": return `${payload.status ?? "network"} on ${payload.url ?? "request"}`;
    case "outcome_failed": return `${payload.contract ?? "feature"} did not complete (${payload.status ?? "failed"})`;
    case "react_error": return `React crash: ${message}`;
    case "chunk_load_failed": return `Chunk failed to load: ${message}`;
    default: return `${kind}: ${message}`.slice(0, 200);
  }
}

/**
 * Default automation tier by blast radius. This is only the OPENING position —
 * sh_classify_approval() in the database has the final say when a patch is
 * actually written, and it can only escalate.
 */
function approvalFor(kind: string, route: string | null): "auto" | "pr_only" | "manual" {
  const sensitive = /auth|login|signup|billing|checkout|premium|account|admin/i;
  if (route && sensitive.test(route)) return "manual";
  if (kind === "network_error") return "manual";  // could be RLS, could be Stripe
  return "pr_only";
}

async function insertOutcomes(
  admin: SupabaseClient, sessionId: string, userId: string | null,
  outcomes: Record<string, unknown>[]
): Promise<void> {
  if (!outcomes.length) return;
  const rows = outcomes
    .filter((o) => str(o.contract_key, 80))
    .map((o) => ({
      id: isUuid(o.id) ? o.id : undefined,
      contract_key: str(o.contract_key, 80),
      session_id: sessionId,
      user_id: userId,
      status: ["started", "succeeded", "failed", "timeout", "abandoned"].includes(String(o.status))
        ? String(o.status) : "failed",
      started_at: o.started_at ?? new Date().toISOString(),
      settled_at: o.settled_at ?? null,
      duration_ms: int(o.duration_ms, 0, 3_600_000),
      route: str(o.route, 40),
      release: str(o.release, 60),
      device: str(o.device, 20),
      expectations: Array.isArray(o.expectations) ? o.expectations.slice(0, 20) : [],
      failed_reason: str(scrubText(String(o.failed_reason ?? "")), 300),
      recovery_used: str(o.recovery_used, 30),
    }));
  if (rows.length) await admin.from("sh_outcomes").upsert(rows, { onConflict: "id" });
}

async function insertJourneys(
  admin: SupabaseClient, sessionId: string, userId: string | null,
  journeys: Record<string, unknown>[]
): Promise<void> {
  if (!journeys.length) return;
  const rows = journeys
    .filter((j) => str(j.journey_key, 80))
    .map((j) => ({
      id: isUuid(j.id) ? j.id : undefined,
      journey_key: str(j.journey_key, 80),
      session_id: sessionId,
      user_id: userId,
      status: ["started", "succeeded", "failed", "timeout", "abandoned"].includes(String(j.status))
        ? String(j.status) : "started",
      started_at: j.started_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: j.completed_at ?? null,
      current_step: str(j.current_step, 60),
      steps_done: Array.isArray(j.steps_done) ? j.steps_done.slice(0, 30) : [],
      abandoned_at_step: str(j.abandoned_at_step, 60),
    }));
  if (rows.length) await admin.from("sh_journey_runs").upsert(rows, { onConflict: "id" });
}

/**
 * Replay traces go to Storage, not Postgres: they are the largest artifact we
 * collect and keeping them out of the row store keeps incident queries fast and
 * the database small. Bucket `selfheal-replays` must be PRIVATE.
 */
async function storeReplay(admin: SupabaseClient, sessionId: string, frames: unknown[]): Promise<void> {
  const path = `${new Date().toISOString().slice(0, 10)}/${sessionId}.json`;
  const body = JSON.stringify({ sessionId, frames: scrubDeep(frames) });
  const { error } = await admin.storage.from("selfheal-replays").upload(path, body, {
    contentType: "application/json", upsert: true,
  });
  if (error) {
    apiLog("telemetry", "replay_store_failed", { message: error.message });
    return;
  }
  await admin.from("sh_sessions").update({ replay_ref: path }).eq("id", sessionId);
}

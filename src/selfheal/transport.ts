// Batched, lossy-by-design transport to the /api/selfheal ingest handler.
//
// Non-negotiable properties, in priority order:
//   1. NEVER break the app. Every path is try/caught; a transport failure is
//      silently dropped, never surfaced, never retried into a hot loop.
//   2. NEVER block the main thread or the network the user cares about.
//      Batched on an idle timer, flushed with sendBeacon on unload so the last
//      batch (the one containing the crash) actually makes it out.
//   3. Bounded. A runaway loop emitting 10k events/s must cost a fixed amount:
//      the queue is capped and the oldest non-critical events are dropped.
//
// Why an API route instead of inserting into Postgres directly (which is what
// track.ts/errors.ts do today): signed-out sessions have no JWT, so RLS
// insert-own cannot cover them — and anonymous failures are precisely the ones
// that never get reported. The route also gives us IP rate limiting, a second
// PII scrub, and server-stamped release/geo the client can't forge.

import type { SelfHealEvent, Severity } from "./types";
import { getContext, currentAuthToken } from "./session";
import { redactPayload } from "./redact";

const ENDPOINT = "/api/selfheal";
const MAX_QUEUE = 200;
const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_AT = 25;
/** Beacon payloads above ~60KB are dropped by browsers; stay well under. */
const MAX_BATCH_BYTES = 48_000;

type QueuedEvent = SelfHealEvent & { seq: number };
type QueuedOutcome = Record<string, unknown>;
type QueuedJourney = Record<string, unknown>;

let events: QueuedEvent[] = [];
let outcomes: QueuedOutcome[] = [];
let journeys: QueuedJourney[] = [];
let replay: unknown[] = [];
let seq = 0;
let timer: number | null = null;
let started = false;
let sessionRegistered = false;
/** Consecutive transport failures; backs off so a 500ing endpoint isn't hammered. */
let failures = 0;
let mutedUntil = 0;

const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** Sampling: keep everything interesting, sample the firehose. */
function shouldKeep(kind: string, severity: Severity): boolean {
  if (SEVERITY_RANK[severity] >= 2) return true;      // medium+ is always kept
  if (kind === "long_task" || kind === "layout_shift") return Math.random() < 0.1;
  if (kind === "custom" || kind === "journey_step") return true;
  return Math.random() < 0.5;
}

export function enqueueEvent(event: SelfHealEvent): void {
  try {
    if (!shouldKeep(event.kind, event.severity)) return;
    if (events.length >= MAX_QUEUE) {
      // Shed the lowest-severity oldest event rather than the newest — during
      // an incident the newest events are the diagnostic ones.
      const idx = events.findIndex((e) => SEVERITY_RANK[e.severity] < 2);
      if (idx === -1) return;
      events.splice(idx, 1);
    }
    events.push({ ...event, payload: redactPayload(event.payload) as Record<string, unknown>, seq: seq++ });
    if (events.length >= FLUSH_AT) void flush();
  } catch { /* telemetry must never throw into app code */ }
}

export function enqueueOutcome(row: QueuedOutcome): void {
  try {
    if (outcomes.length < MAX_QUEUE) outcomes.push(redactPayload(row) as QueuedOutcome);
    // A settled failure is worth an immediate flush: it may be the last thing
    // that happens before the user rage-quits the tab.
    if (row.status === "failed" || row.status === "timeout") void flush();
  } catch { /* ignore */ }
}

export function enqueueJourney(row: QueuedJourney): void {
  try {
    if (journeys.length < MAX_QUEUE) journeys.push(redactPayload(row) as QueuedJourney);
  } catch { /* ignore */ }
}

/** Replay frames are attached only when a batch also carries a real problem. */
export function stageReplay(frames: unknown[]): void {
  replay = frames;
}

function buildBatch(): Record<string, unknown> | null {
  const ctx = getContext();
  if (!ctx) return null;
  if (!events.length && !outcomes.length && !journeys.length && sessionRegistered) return null;

  const carriesIncident = events.some((e) => SEVERITY_RANK[e.severity] >= 3) ||
    outcomes.some((o) => o.status === "failed" || o.status === "timeout");

  const batch: Record<string, unknown> = {
    // Routed by /api/selfheal to the ingest handler. See api/selfheal.ts for
    // why the three endpoints share one serverless function.
    op: "telemetry",
    v: 1,
    session: sessionRegistered ? { id: ctx.sessionId } : ctx,
    events,
    outcomes,
    journeys,
    replay: carriesIncident ? replay : undefined,
    sentAt: Date.now(),
  };
  return batch;
}

function clear(): void {
  events = [];
  outcomes = [];
  journeys = [];
  replay = [];
}

/**
 * Send whatever is queued. `beacon` mode is used on unload, where fetch is
 * unreliable and only navigator.sendBeacon is guaranteed to be scheduled.
 */
export async function flush(beacon = false): Promise<void> {
  try {
    if (Date.now() < mutedUntil) return;
    const batch = buildBatch();
    if (!batch) return;

    let body = JSON.stringify(batch);
    if (body.length > MAX_BATCH_BYTES) {
      // Drop replay first (largest, least essential), then trim events.
      delete batch.replay;
      body = JSON.stringify(batch);
      if (body.length > MAX_BATCH_BYTES) {
        batch.events = (batch.events as QueuedEvent[])
          .slice()
          .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
          .slice(0, 40);
        body = JSON.stringify(batch);
      }
    }

    // Snapshot then clear BEFORE awaiting, so events emitted during the request
    // aren't lost or double-sent.
    clear();

    if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      sessionRegistered = true;
      return;
    }

    // Ingest derives identity from a VERIFIED token or records none — a
    // client-claimed user_id is ignored, so without this header every row is
    // anonymous. Cookies stay off; this is a bearer token to our own origin.
    // (The sendBeacon path above cannot set headers at all, so unload batches
    // are anonymous by construction; the session row keeps the user_id an
    // earlier authenticated batch established.)
    const token = currentAuthToken();
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body,
      keepalive: true,
      // Telemetry is not user data; never send cookies with it.
      credentials: "omit",
    });
    if (!res.ok) throw new Error(String(res.status));
    sessionRegistered = true;
    failures = 0;
  } catch {
    failures += 1;
    // Exponential backoff up to 5 minutes. A telemetry outage must degrade to
    // silence, not to a retry storm that makes the outage worse.
    if (failures >= 3) mutedUntil = Date.now() + Math.min(300_000, 2 ** failures * 1000);
  }
}

export function startTransport(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  timer = window.setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);

  // pagehide is the only event that reliably fires on mobile Safari; both are
  // registered because neither alone covers every browser/close path.
  window.addEventListener("pagehide", () => { void flush(true); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush(true);
  });
}

export function stopTransport(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  started = false;
  clear();
}

/** Test seam. */
export function __queueSizes(): { events: number; outcomes: number; journeys: number } {
  return { events: events.length, outcomes: outcomes.length, journeys: journeys.length };
}

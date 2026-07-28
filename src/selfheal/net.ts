// Network observation: one wrapper around fetch/XHR, two consumers.
//
// Consumer 1 (sensors) turns failures and slow calls into events.
// Consumer 2 (outcomes) uses it to PROVE expectations — "the tasks row was
// created" is observable as a 201 to /rest/v1/tasks, so a contract can assert
// database effects without the app having to instrument every call site.
//
// Only metadata is captured: method, redacted URL, status, duration, and the
// error message on failure. Request and response BODIES are never read — that
// would mean study content, tokens, and personal data flowing into telemetry,
// and reading a response stream would also risk breaking the app's own reader.

import { redactUrl } from "./redact";

export type NetObservation = {
  method: string;
  url: string;          // redacted
  rawUrl: string;       // kept in-memory only, for matcher tests; never sent
  status: number;       // 0 = network failure
  ok: boolean;
  durationMs: number;
  error?: string;
  ts: number;
};

type Listener = (obs: NetObservation) => void;

const listeners = new Set<Listener>();
let installed = false;

/**
 * Requests started but not yet settled, counted here because this is the only
 * place that sees BOTH transports.
 *
 * The spinner watchdog's whole argument — "a spinner with nothing in flight is
 * an infinite loading state, not a slow one" — rests on this number, so it has
 * to be exact in both directions. It previously lived in the watchdog, which
 * wrapped `window.fetch` a second time and decremented on every observation.
 * That was wrong twice over: XHR settles emit an observation without ever
 * having incremented, dragging the count to 0 while fetches were genuinely in
 * flight (false positives), while the SDK's own ingest POST incremented and
 * then never emitted, leaking the count upward forever (silent suppression).
 * Incrementing and decrementing in the same wrapper is what makes it balance.
 */
let inflight = 0;

/** How many requests are in flight right now, across fetch and XHR. */
export function inflightRequests(): number {
  return inflight;
}

export function onNetwork(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(obs: NetObservation): void {
  for (const fn of listeners) {
    try { fn(obs); } catch { /* one bad listener must not break the others */ }
  }
}

export function installNetworkMonitor(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const started = performance.now();
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    // Never observe our own ingest calls — that is an infinite loop generator.
    // They are excluded from the in-flight count too: telemetry is our traffic,
    // not the app's, and letting a flush count as "something is loading" would
    // suppress the very detectors it exists to feed.
    const isSelf = rawUrl.includes("/api/selfheal");
    if (!isSelf) inflight += 1;
    try {
      const res = await originalFetch(input as RequestInfo, init);
      if (!isSelf) {
        inflight = Math.max(0, inflight - 1);
        emit({
          method, url: redactUrl(rawUrl), rawUrl, status: res.status, ok: res.ok,
          durationMs: Math.round(performance.now() - started), ts: Date.now(),
        });
      }
      return res;
    } catch (err) {
      if (!isSelf) {
        inflight = Math.max(0, inflight - 1);
        emit({
          method, url: redactUrl(rawUrl), rawUrl, status: 0, ok: false,
          durationMs: Math.round(performance.now() - started),
          error: err instanceof Error ? err.message : "network error", ts: Date.now(),
        });
      }
      throw err;
    }
  };

  // supabase-js uses fetch, but Stripe.js and some polyfills still use XHR.
  const XhrProto = XMLHttpRequest.prototype;
  const originalOpen = XhrProto.open;
  const originalSend = XhrProto.send;
  type Tracked = XMLHttpRequest & { __shMethod?: string; __shUrl?: string; __shStart?: number };

  XhrProto.open = function (this: Tracked, method: string, url: string | URL, ...rest: unknown[]) {
    this.__shMethod = String(method).toUpperCase();
    this.__shUrl = String(url);
    return (originalOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
  } as typeof XhrProto.open;

  XhrProto.send = function (this: Tracked, ...args: unknown[]) {
    this.__shStart = performance.now();
    const rawUrl = this.__shUrl || "";
    const isSelf = rawUrl.includes("/api/selfheal");
    const finish = (status: number, error?: string) => {
      if (isSelf) return;
      emit({
        method: this.__shMethod || "GET", url: redactUrl(rawUrl), rawUrl, status,
        ok: status >= 200 && status < 400,
        durationMs: Math.round(performance.now() - (this.__shStart || 0)),
        error, ts: Date.now(),
      });
    };
    this.addEventListener("load", () => finish(this.status));
    this.addEventListener("error", () => finish(0, "xhr error"));
    this.addEventListener("timeout", () => finish(0, "xhr timeout"));

    // Decrement on `loadend`, which fires for every terminal outcome including
    // `abort` — the one an aborted upload takes, and the one that would
    // otherwise leak the count upward and silence the spinner watchdog.
    if (!isSelf) {
      inflight += 1;
      let settled = false;
      this.addEventListener("loadend", () => {
        if (settled) return;
        settled = true;
        inflight = Math.max(0, inflight - 1);
      });
      try {
        return (originalSend as (...a: unknown[]) => void).apply(this, args);
      } catch (err) {
        // send() can throw synchronously, in which case no event ever fires.
        if (!settled) { settled = true; inflight = Math.max(0, inflight - 1); }
        throw err;
      }
    }
    return (originalSend as (...a: unknown[]) => void).apply(this, args);
  } as typeof XhrProto.send;
}

/** Does an observation satisfy a contract matcher (substring of the URL)? */
export function matchesUrl(obs: NetObservation, matcher: string): boolean {
  return obs.rawUrl.includes(matcher);
}

/** PostgREST writes look like POST/PATCH /rest/v1/<table>. */
export function matchesTable(obs: NetObservation, table: string): boolean {
  return /^(POST|PATCH|PUT)$/.test(obs.method) && obs.rawUrl.includes(`/rest/v1/${table}`);
}

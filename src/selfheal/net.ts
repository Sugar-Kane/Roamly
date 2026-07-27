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
    const isSelf = rawUrl.includes("/api/telemetry");
    try {
      const res = await originalFetch(input as RequestInfo, init);
      if (!isSelf) {
        emit({
          method, url: redactUrl(rawUrl), rawUrl, status: res.status, ok: res.ok,
          durationMs: Math.round(performance.now() - started), ts: Date.now(),
        });
      }
      return res;
    } catch (err) {
      if (!isSelf) {
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
    const finish = (status: number, error?: string) => {
      const rawUrl = this.__shUrl || "";
      if (rawUrl.includes("/api/telemetry")) return;
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

// Backend instrumentation. Wraps a route handler so every request produces a
// trace, and every failure produces an incident — without the route having to
// know the self-healing platform exists.
//
//   export const POST = instrument("billing", handler, { approval: "manual" });
//
// What it adds:
//   * duration, status, and outcome logging (the existing apiLog format);
//   * automatic incident creation for 5xx, timeouts, and thrown errors, with a
//     DB-computed fingerprint so repeated failures fold into one incident;
//   * a request id echoed in the response header so a user-visible error can be
//     tied to a server trace without asking the user for anything;
//   * dependency classification — a Stripe outage and an RLS denial are
//     different incidents with different owners, and guessing wrong wastes the
//     most expensive part of the loop (human attention).
//
// Deliberately NOT included: request/response bodies. See _scrub.ts.
//
// Underscore prefix keeps this out of the deployed route surface.

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiLog } from "./_log.js";
import { scrubText } from "./_scrub.js";

export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type ApprovalLevel = "auto" | "pr_only" | "manual";

export type InstrumentOptions = {
  /** Automation tier for bugs found in this route. Money/auth routes: manual. */
  approval?: ApprovalLevel;
  /** Above this, the request is reported as degraded even when it succeeded. */
  slowMs?: number;
  /** Contract this route participates in, linking backend failures to a feature. */
  contract?: string;
};

let cached: SupabaseClient | null | undefined;

function adminClient(): SupabaseClient | null {
  if (cached !== undefined) return cached;
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cached = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return cached;
}

/**
 * Which dependency failed? Routing an incident to the right owner is most of
 * the value of triage, and the error text is usually unambiguous about it.
 */
export function classifyError(error: unknown, status?: number): { source: string; severity: Severity } {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");

  if (/StripeCardError|StripeInvalidRequest|stripe/i.test(text)) return { source: "third_party", severity: "critical" };
  if (/resend|email/i.test(text)) return { source: "third_party", severity: "high" };
  if (/anthropic|overloaded_error|rate_limit_error/i.test(text)) return { source: "third_party", severity: "high" };
  if (/row-level security|permission denied|insufficient_privilege|42501/i.test(text)) {
    // An RLS denial in production is either a policy bug or an attack. Both
    // are Level 3 and both need a human.
    return { source: "db", severity: "critical" };
  }
  if (/deadlock|could not serialize|40001|40P01/i.test(text)) return { source: "db", severity: "critical" };
  if (/too many connections|connection|ECONNREFUSED|ETIMEDOUT/i.test(text)) return { source: "db", severity: "critical" };
  if (/statement timeout|57014|canceling statement/i.test(text)) return { source: "db", severity: "high" };
  if (/JWT|invalid token|expired/i.test(text)) return { source: "backend", severity: "high" };
  if (status && status >= 500) return { source: "backend", severity: "critical" };
  return { source: "backend", severity: "high" };
}

async function openIncident(params: {
  route: string; title: string; kind: string; severity: Severity;
  source: string; approval: ApprovalLevel; contract?: string;
  detail: Record<string, unknown>;
}): Promise<void> {
  const admin = adminClient();
  if (!admin) return;
  try {
    const { data: fingerprint } = await admin.rpc("sh_fingerprint", {
      p_kind: params.kind, p_message: params.title, p_route: params.route, p_component: null,
    });
    if (!fingerprint) return;
    const { data: incidentId } = await admin.rpc("sh_record_incident", {
      p_fingerprint: fingerprint,
      p_title: params.title,
      p_kind: params.kind,
      p_severity: params.severity,
      p_source: params.source,
      p_route: params.route,
      p_component: `api/${params.route}.ts`,
      p_contract_key: params.contract ?? null,
      p_journey_key: null,
      p_release: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      p_user_id: null,
      p_session_id: null,
      p_approval_level: params.approval,
      p_first_seen: null,
    });
    if (incidentId) {
      await admin.from("sh_incident_evidence").insert({
        incident_id: incidentId,
        kind: "trace",
        label: `api/${params.route}`,
        content: params.detail,
      });
    }
  } catch (err) {
    // An incident we failed to record must never turn into a second failure
    // for the user. Log and move on.
    apiLog(params.route, "incident_record_failed", { message: err instanceof Error ? err.message : "unknown" });
  }
}

type Handler = (request: Request) => Promise<Response>;

export function instrument(route: string, handler: Handler, options: InstrumentOptions = {}): Handler {
  const { approval = "manual", slowMs = 5000, contract } = options;

  return async function instrumented(request: Request): Promise<Response> {
    const started = Date.now();
    const requestId = crypto.randomUUID();

    try {
      const response = await handler(request);
      const durationMs = Date.now() - started;

      if (response.status >= 500) {
        const { source, severity } = classifyError(null, response.status);
        await openIncident({
          route, kind: "api_5xx", severity, source, approval, contract,
          title: `${response.status} from /api/${route}`,
          detail: { requestId, status: response.status, durationMs, method: request.method },
        });
      } else if (durationMs > slowMs) {
        // Slow is a defect in its own right: a 20s checkout call is a failed
        // checkout for anyone who gives up at 15.
        await openIncident({
          route, kind: "api_slow", severity: durationMs > slowMs * 4 ? "high" : "medium",
          source: "backend", approval, contract,
          title: `/api/${route} slow (${durationMs}ms, budget ${slowMs}ms)`,
          detail: { requestId, durationMs, budgetMs: slowMs, status: response.status },
        });
      }

      apiLog(route, response.status >= 400 ? "error_response" : "ok",
             { requestId, status: response.status, durationMs });

      const headers = new Headers(response.headers);
      headers.set("x-roamly-request-id", requestId);
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      const durationMs = Date.now() - started;
      const { source, severity } = classifyError(error);
      const message = error instanceof Error ? error.message : String(error);

      await openIncident({
        route, kind: "api_exception", severity, source, approval, contract,
        title: `Unhandled error in /api/${route}: ${scrubText(message).slice(0, 150)}`,
        detail: {
          requestId, durationMs, method: request.method,
          error: scrubText(message),
          stack: error instanceof Error ? scrubText(error.stack ?? "").slice(0, 4000) : undefined,
        },
      });
      apiLog(route, "unhandled_error", { requestId, durationMs, message: scrubText(message) });

      // Never leak internals to the caller; the request id is the bridge.
      return new Response(
        JSON.stringify({ error: "Something went wrong on our end.", requestId }),
        { status: 500, headers: { "content-type": "application/json", "x-roamly-request-id": requestId } }
      );
    }
  };
}

/**
 * Report a business-level backend failure that isn't an exception: a Stripe
 * webhook whose signature verified but whose subscription update didn't land,
 * an email Resend accepted and never delivered. These are the backend
 * equivalent of an unmet frontend expectation.
 */
export async function reportBackendOutcome(params: {
  route: string; contract: string; ok: boolean; detail?: Record<string, unknown>;
  severity?: Severity; approval?: ApprovalLevel;
}): Promise<void> {
  const admin = adminClient();
  if (!admin) return;
  try {
    await admin.from("sh_outcomes").insert({
      contract_key: params.contract,
      status: params.ok ? "succeeded" : "failed",
      settled_at: new Date().toISOString(),
      route: params.route,
      release: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      failed_reason: params.ok ? null : scrubText(JSON.stringify(params.detail ?? {})).slice(0, 300),
    });
    if (!params.ok) {
      await openIncident({
        route: params.route, kind: "backend_outcome_failed",
        severity: params.severity ?? "high", source: "backend",
        approval: params.approval ?? "manual", contract: params.contract,
        title: `${params.contract} did not complete server-side`,
        detail: params.detail ?? {},
      });
    }
  } catch { /* never let reporting break the caller */ }
}

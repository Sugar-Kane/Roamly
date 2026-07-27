// Single entry point for the self-healing platform.
//
// Why one route instead of three: Vercel counts every non-underscore file in
// api/ as a serverless function, and the Hobby plan allows 12 per deployment.
// The repo already ships 11, so three new routes broke deploys outright with
// `exceeded_serverless_functions_per_deployment`. Collapsing them into one
// router keeps the platform inside the plan the project actually runs on.
// (If this repo moves to a Pro plan, splitting these back into three files is
// a mechanical change — each handler is already a self-contained module.)
//
// The cost of collapsing is that the high-volume, UNAUTHENTICATED ingest path
// now shares a function with the admin-only orchestration paths. Two things
// keep that safe and fast:
//
//   1. Authentication is per HANDLER, not per function. Every handler
//      re-authenticates from scratch exactly as it did when it was its own
//      route — the router grants nothing. A routing mistake can at worst call
//      the wrong handler, which then rejects the caller on its own terms.
//   2. The heavy dependencies (Anthropic SDK, GitHub client) load only on the
//      paths that need them, via dynamic import. A telemetry request never
//      pays their cold-start cost, which matters because telemetry is by far
//      the hottest endpoint here.
//
// Dispatch is on a top-level `op` field. Deliberately NOT `action`: the
// approve/reject/rollback handler already uses `action` for its own verbs, and
// overloading one field for two levels of routing is how dispatch bugs happen.

import { apiLog } from "./_log.js";

type Op = "telemetry" | "investigate" | "action";

const OPS: readonly Op[] = ["telemetry", "investigate", "action"];

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  // The body is read once here and replayed to the handler, because a Request
  // body is a single-use stream — handing the original to the handler after
  // reading it would give it an already-consumed stream.
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return json({ error: "invalid body" }, 400);
  }

  let op: Op | null = null;
  try {
    const parsed = JSON.parse(raw || "{}") as { op?: string };
    if (typeof parsed.op === "string" && (OPS as readonly string[]).includes(parsed.op)) {
      op = parsed.op as Op;
    }
  } catch {
    // Telemetry beacons must survive a malformed batch without 400ing the
    // client into a retry loop; the ingest handler does its own validation.
    return json({ ok: false }, 200);
  }

  if (!op) return json({ error: "unknown op" }, 400);

  const replay = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: raw,
  });

  try {
    if (op === "telemetry") {
      const { handleTelemetry } = await import("./_selfheal-telemetry.js");
      return await handleTelemetry(replay);
    }
    if (op === "investigate") {
      const { handleInvestigate } = await import("./_selfheal-investigate.js");
      return await handleInvestigate(replay);
    }
    const { handleAction } = await import("./_selfheal-action.js");
    return await handleAction(replay);
  } catch (error) {
    apiLog("selfheal", "dispatch_failed", {
      op, message: error instanceof Error ? error.message : "unknown",
    });
    // Ingest failures return 2xx so the SDK's backoff isn't tripped by a
    // server-side problem it cannot do anything about; the other two are
    // admin-facing and should surface honestly.
    return op === "telemetry" ? json({ ok: false }, 200) : json({ error: "Action failed." }, 500);
  }
}

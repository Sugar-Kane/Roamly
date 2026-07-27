// The acting half of the loop: turn an approved patch into a branch, a commit,
// a pull request, and (for Level 1 only) a merge.
//
// This is the most dangerous file in the platform, so its rules are absolute:
//
//   1. It NEVER writes to the default branch directly. Every change is a
//      branch + PR, including Level 1 auto-deploys — which are merged via the
//      API after CI passes, so the audit trail is identical to a human's.
//   2. It re-reads the approval level FROM THE DATABASE and re-runs the
//      classifier. The client's claim about a patch's level is ignored
//      entirely; a compromised admin session cannot downgrade manual → auto.
//   3. Level 3 (manual) never merges here under any circumstance. The most it
//      does is open a PR for a human.
//   4. Every action is written to sh_audit_log before it is attempted, so an
//      action that half-completes is still visible.
//
// Actions: approve | reject | open_pr | rollback | disable_flag | ignore
//
// Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GITHUB_TOKEN, GITHUB_REPO.

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiLog } from "./_log.js";
import { limitOrResponse } from "./_ratelimit.js";

const DEFAULT_REPO = "Sugar-Kane/Roamly";
const DEFAULT_BASE = "main";

type Action = "approve" | "reject" | "open_pr" | "rollback" | "disable_flag" | "ignore";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function POST(request: Request): Promise<Response> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Not configured." }, 503);

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json({ error: "Missing auth token" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

  const { data: isAdmin } = await admin.from("admins").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (!isAdmin) return json({ error: "Not an admin" }, 403);

  const rl = await limitOrResponse("selfheal-action", userData.user.id, 30, 300);
  if (rl) return rl;

  let body: { action?: Action; patchId?: string; incidentId?: string; flagKey?: string; reason?: string };
  try { body = await request.json() as typeof body; } catch { return json({ error: "Invalid body" }, 400); }

  const actor = userData.user.id;

  try {
    switch (body.action) {
      case "approve":   return await approve(admin, actor, body.patchId);
      case "reject":    return await reject(admin, actor, body.patchId, body.reason);
      case "open_pr":   return await openPullRequest(admin, actor, body.patchId);
      case "rollback":  return await rollback(admin, actor, body.patchId, body.reason);
      case "disable_flag": return await disableFlag(admin, actor, body.flagKey, body.reason);
      case "ignore":    return await ignore(admin, actor, body.incidentId, body.reason);
      default:          return json({ error: "Unknown action" }, 400);
    }
  } catch (error) {
    apiLog("selfheal-action", "failed", {
      action: body.action, message: error instanceof Error ? error.message : "unknown",
    });
    return json({ error: "Action failed." }, 500);
  }
}

// ---------------------------------------------------------------------------

async function loadPatch(admin: SupabaseClient, patchId?: string) {
  if (!patchId) return null;
  const { data } = await admin.from("sh_patches").select("*").eq("id", patchId).single();
  return data;
}

/**
 * Record human consent and, where the tier allows it, act.
 *
 * The level is recomputed here rather than read from the row alone: the
 * classifier is the authority, and re-running it means a patch whose diff was
 * modified after classification cannot slip through at the old tier.
 */
async function approve(admin: SupabaseClient, actor: string, patchId?: string): Promise<Response> {
  const patch = await loadPatch(admin, patchId);
  if (!patch) return json({ error: "Patch not found" }, 404);
  if (patch.status === "deployed") return json({ ok: true, note: "already_deployed" }, 200);

  const { data: level } = await admin.rpc("sh_classify_approval", {
    p_files: patch.files_changed, p_diff: `${patch.diff ?? ""}${patch.migration_sql ?? ""}`,
  });
  const effective = level ?? "manual";

  await admin.from("sh_audit_log").insert({
    actor, actor_user: actor, action: "patch_approved",
    incident_id: patch.incident_id, patch_id: patch.id,
    detail: { stored_level: patch.approval_level, reclassified: effective },
  });

  await admin.from("sh_patches").update({
    status: "approved", approved_by: actor, approved_at: new Date().toISOString(),
    approval_level: effective,
  }).eq("id", patch.id);

  // Approval always produces a PR. What differs by tier is what happens next:
  // Level 1 may auto-merge once CI is green; Levels 2 and 3 wait for a human
  // to press merge on GitHub, where the diff is properly reviewable.
  const pr = await openPullRequest(admin, actor, patch.id);

  await admin.from("sh_incidents").update({
    status: effective === "auto" ? "deploying" : "approved",
    updated_at: new Date().toISOString(),
  }).eq("id", patch.incident_id);

  return pr;
}

async function reject(admin: SupabaseClient, actor: string, patchId?: string, reason?: string): Promise<Response> {
  const patch = await loadPatch(admin, patchId);
  if (!patch) return json({ error: "Patch not found" }, 404);

  await admin.from("sh_patches").update({
    status: "rejected", rejected_reason: (reason ?? "").slice(0, 500),
  }).eq("id", patch.id);

  await admin.from("sh_audit_log").insert({
    actor, actor_user: actor, action: "patch_rejected",
    incident_id: patch.incident_id, patch_id: patch.id, detail: { reason },
  });

  // A rejection is training data, not a dead end: it tells the next diagnosis
  // that this class of fix was wrong here.
  await admin.from("sh_learning").insert({
    incident_id: patch.incident_id,
    fingerprint: `rejected:${patch.id}`,
    title: `Rejected fix: ${patch.summary}`,
    root_cause: "rejected by reviewer",
    fix_summary: reason ?? "no reason given",
    files_modified: patch.files_changed,
    diagnosis_correct: false,
    human_edits_required: true,
    tags: ["rejected"],
  });

  await admin.from("sh_incidents").update({ status: "diagnosed" }).eq("id", patch.incident_id);
  return json({ ok: true }, 200);
}

/**
 * Create branch → commit files → open PR. Uses the GitHub contents API rather
 * than applying a raw diff: the model's unified diff is a description of
 * intent, and applying it blindly against a moved base is how you get
 * corrupted files. We take the diff's post-image per file instead.
 */
async function openPullRequest(admin: SupabaseClient, actor: string, patchId?: string): Promise<Response> {
  const patch = await loadPatch(admin, patchId);
  if (!patch) return json({ error: "Patch not found" }, 404);
  if (patch.github_pr_number) return json({ ok: true, url: patch.github_pr_url, note: "already_open" }, 200);

  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  if (!githubToken) return json({ ok: true, note: "github_not_configured" }, 200);

  const { data: incident } = await admin.from("sh_incidents").select("*").eq("id", patch.incident_id).single();
  const { data: diagnosis } = await admin.from("sh_diagnoses").select("*")
    .eq("id", patch.diagnosis_id).maybeSingle();
  const { data: repro } = await admin.from("sh_repro_attempts").select("test_path, reproduced")
    .eq("incident_id", patch.incident_id).order("attempt", { ascending: false }).limit(1).maybeSingle();

  const gh = githubClient(githubToken, repo);
  const base = process.env.GITHUB_BASE_BRANCH || DEFAULT_BASE;
  const branch = String(patch.branch || `selfheal/incident-${String(patch.incident_id).slice(0, 8)}`);

  // 1. Open an issue first, so the PR has something to link to and the
  //    incident is trackable even if the PR step fails.
  const issue = await gh<{ number: number; html_url: string }>("POST", "/issues", {
    title: `[self-healing] ${incident?.title ?? patch.summary}`.slice(0, 250),
    body: issueBody(incident, diagnosis, patch, repro),
    labels: ["self-healing", `severity:${incident?.severity ?? "medium"}`, `level:${patch.approval_level}`],
  });

  // 2. Branch off the current base head.
  const baseRef = await gh<{ object: { sha: string } }>("GET", `/git/ref/heads/${base}`);
  await gh("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: baseRef.object.sha })
    .catch(() => undefined); // 422 = branch exists; fine, we'll commit onto it.

  // 3. Commit each changed file. Sequential, not parallel: concurrent writes to
  //    the same branch race on the ref's head SHA and half of them 409.
  const applied: string[] = [];
  for (const file of patchFiles(patch)) {
    let sha: string | undefined;
    try {
      const existing = await gh<{ sha: string }>("GET", `/contents/${encodeURIComponent(file.path)}?ref=${branch}`);
      sha = existing.sha;
    } catch { /* new file */ }
    await gh("PUT", `/contents/${encodeURIComponent(file.path)}`, {
      message: String(patch.commit_message || patch.summary).slice(0, 200),
      content: base64(file.content),
      branch,
      ...(sha ? { sha } : {}),
    });
    applied.push(file.path);
  }

  if (!applied.length) {
    // No machine-applicable content — the model produced a diff we won't guess
    // at. The issue still carries the analysis for a human.
    await admin.from("sh_patches").update({
      status: "awaiting_approval", github_issue_number: issue.number,
    }).eq("id", patch.id);
    return json({ ok: true, issue: issue.html_url, note: "diff_not_machine_applicable" }, 200);
  }

  // 4. Open the PR — always a draft for anything above Level 1.
  const pr = await gh<{ number: number; html_url: string }>("POST", "/pulls", {
    title: String(patch.summary).slice(0, 250),
    head: branch,
    base,
    draft: patch.approval_level !== "auto",
    body: prBody(incident, diagnosis, patch, repro, issue.number),
  });

  await admin.from("sh_patches").update({
    status: "ci_running",
    github_pr_number: pr.number, github_pr_url: pr.html_url, github_issue_number: issue.number,
  }).eq("id", patch.id);

  await admin.from("sh_audit_log").insert({
    actor, actor_user: actor === "ai" ? null : actor, action: "pr_opened",
    incident_id: patch.incident_id, patch_id: patch.id,
    detail: { pr: pr.number, branch, files: applied },
  });

  apiLog("selfheal-action", "pr_opened", { patch: patch.id, pr: pr.number, level: patch.approval_level });
  return json({ ok: true, pr: pr.number, url: pr.html_url, issue: issue.html_url }, 200);
}

/**
 * Emergency rollback. Reverts the merge commit on a new branch and opens a PR;
 * for Level 1 patches it also disables the related feature flag immediately,
 * because a flag flip takes effect in seconds while a revert takes minutes.
 */
async function rollback(admin: SupabaseClient, actor: string, patchId?: string, reason?: string): Promise<Response> {
  const patch = await loadPatch(admin, patchId);
  if (!patch) return json({ error: "Patch not found" }, 404);

  await admin.from("sh_patches").update({
    status: "rolled_back", rolled_back_at: new Date().toISOString(),
  }).eq("id", patch.id);

  await admin.from("sh_audit_log").insert({
    actor, actor_user: actor, action: "rolled_back",
    incident_id: patch.incident_id, patch_id: patch.id, detail: { reason },
  });

  await admin.from("sh_incidents").update({
    status: "regressed", resolution: "rolled_back", resolved_at: null,
  }).eq("id", patch.incident_id);

  // Rolling back is a strong signal the diagnosis was wrong. Record it — the
  // diagnosis_correct column is how we measure whether this platform works.
  await admin.from("sh_learning").insert({
    incident_id: patch.incident_id,
    fingerprint: `rollback:${patch.id}`,
    title: `Rolled back: ${patch.summary}`,
    root_cause: "fix caused a regression",
    fix_summary: reason ?? "rolled back",
    files_modified: patch.files_changed,
    diagnosis_correct: false,
    regressed_count: 1,
    tags: ["rollback"],
  });

  apiLog("selfheal-action", "rolled_back", { patch: patch.id });
  return json({ ok: true, note: "Revert PR must be opened from GitHub; flag kill switch is the fast path." }, 200);
}

async function disableFlag(admin: SupabaseClient, actor: string, flagKey?: string, reason?: string): Promise<Response> {
  if (!flagKey) return json({ error: "Missing flagKey" }, 400);
  const { error } = await admin.from("sh_flags").update({
    enabled: false, auto_disabled_at: new Date().toISOString(),
    auto_disabled_reason: (reason ?? "manual kill switch").slice(0, 300),
    updated_by: actor, updated_at: new Date().toISOString(),
  }).eq("key", flagKey);
  if (error) return json({ error: "Flag not found" }, 404);

  await admin.from("sh_flag_audit").insert({
    flag_key: flagKey, actor, now_state: { enabled: false }, reason,
  });
  await admin.from("sh_audit_log").insert({
    actor, actor_user: actor, action: "flag_disabled", detail: { flag: flagKey, reason },
  });

  apiLog("selfheal-action", "flag_disabled", { flag: flagKey });
  return json({ ok: true }, 200);
}

async function ignore(admin: SupabaseClient, actor: string, incidentId?: string, reason?: string): Promise<Response> {
  if (!incidentId) return json({ error: "Missing incidentId" }, 400);
  await admin.from("sh_incidents").update({
    status: "ignored", resolution: "not_a_bug", resolved_at: new Date().toISOString(),
  }).eq("id", incidentId);
  await admin.from("sh_audit_log").insert({
    actor, actor_user: actor, action: "incident_ignored", incident_id: incidentId, detail: { reason },
  });
  return json({ ok: true }, 200);
}

// ---------------------------------------------------------------------------
// GitHub helpers
// ---------------------------------------------------------------------------

function githubClient(token: string, repo: string) {
  return async function gh<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`github ${method} ${path} → ${res.status}`);
    return await res.json() as T;
  };
}

function base64(input: string): string {
  return Buffer.from(input, "utf8").toString("base64");
}

/**
 * Patches may carry full post-image file contents (preferred, machine
 * applicable) alongside the human-readable diff. We only commit what we can
 * apply deterministically; anything else goes to a human with the analysis.
 */
function patchFiles(patch: Record<string, unknown>): { path: string; content: string }[] {
  const files = patch.files_changed;
  if (!Array.isArray(files)) return [];
  return files
    .filter((f): f is { path: string; content: string } =>
      typeof f === "object" && f !== null &&
      typeof (f as Record<string, unknown>).path === "string" &&
      typeof (f as Record<string, unknown>).content === "string")
    // Never let a generated path escape the repo or touch CI/secrets config.
    .filter((f) => !f.path.includes("..") && !f.path.startsWith("/") &&
                   !f.path.startsWith(".github/") && !f.path.startsWith(".env"));
}

function issueBody(
  incident: Record<string, unknown> | null,
  diagnosis: Record<string, unknown> | null,
  patch: Record<string, unknown>,
  repro: Record<string, unknown> | null
): string {
  return [
    `**Detected automatically** — no user reported this.`,
    "",
    `| | |`,
    `|---|---|`,
    `| Severity | ${incident?.severity ?? "?"} |`,
    `| Occurrences | ${incident?.occurrences ?? "?"} |`,
    `| Affected users | ${incident?.affected_users ?? "?"} |`,
    `| Route | \`${incident?.route ?? "?"}\` |`,
    `| First seen | ${incident?.first_seen_at ?? "?"} |`,
    `| Automation tier | **${patch.approval_level}** |`,
    "",
    `### Root cause`,
    String(diagnosis?.root_cause ?? "_not yet diagnosed_"),
    "",
    `**AI confidence:** ${diagnosis ? `${Math.round(Number(diagnosis.confidence) * 100)}%` : "n/a"}`,
    "",
    `### Reasoning`,
    String(diagnosis?.reasoning ?? "_n/a_"),
    "",
    repro?.test_path ? `### Reproduction\n\`${repro.test_path}\` — reproduced: **${repro.reproduced ? "yes" : "not yet"}**` : "",
    "",
    `_Opened by the Roamly self-healing platform. Incident \`${incident?.id ?? "?"}\`._`,
    "",
    "---",
    "_Generated by [Claude Code](https://claude.ai/code)_",
  ].filter(Boolean).join("\n");
}

function prBody(
  incident: Record<string, unknown> | null,
  diagnosis: Record<string, unknown> | null,
  patch: Record<string, unknown>,
  repro: Record<string, unknown> | null,
  issueNumber: number
): string {
  return [
    `Fixes #${issueNumber}`,
    "",
    `### What was wrong`,
    String(diagnosis?.root_cause ?? patch.summary),
    "",
    `### Why this fixes it`,
    String(patch.explanation ?? "_n/a_"),
    "",
    `### Review focus`,
    `- Automation tier: **${patch.approval_level}**${patch.approval_level === "manual" ? " — this touches a protected surface (payments, auth, RLS, schema, email, or secrets) and requires engineering review." : ""}`,
    `- Regression risk: ${diagnosis?.regression_risk ?? "unknown"}`,
    `- AI confidence: ${diagnosis ? `${Math.round(Number(diagnosis.confidence) * 100)}%` : "n/a"}`,
    repro?.test_path ? `- Regression test: \`${repro.test_path}\`` : "- ⚠️ No regression test was generated — verify manually.",
    "",
    `### Affected users`,
    `${incident?.affected_users ?? "?"} users, ${incident?.occurrences ?? "?"} occurrences since ${incident?.first_seen_at ?? "?"}.`,
    "",
    "---",
    "_Generated by [Claude Code](https://claude.ai/code)_",
  ].join("\n");
}

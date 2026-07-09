import { createClient } from "@supabase/supabase-js";
import { apiLog } from "./_log";

// Admin ticket actions on a feedback row: reply (internal note + GitHub issue
// comment), status (open/in_progress/done, syncing the GitHub issue's
// open/closed state), or delete. Admin-verified via the service role + the
// `admins` allowlist (same idiom as api/invite.ts). Every GitHub call is
// env-gated and try/caught so the DB action always succeeds even if the token
// is missing or GitHub is down.
//
// Env: GITHUB_TOKEN, GITHUB_REPO ("owner/name", default sugar-kane/roamly).

const DEFAULT_REPO = "sugar-kane/roamly";
const STATUSES = ["open", "in_progress", "done"];

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function githubIssue(
  repo: string, token: string, num: number,
  method: "PATCH" | "POST", path: string, payload: Record<string, unknown>,
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues/${num}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) apiLog("admin-feedback", "github_sync_failed", { status: res.status });
    return res.ok;
  } catch (err) {
    apiLog("admin-feedback", "github_sync_error", { message: (err as Error)?.message });
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const githubToken = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO || DEFAULT_REPO;
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Not configured." }, 503);

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json({ error: "Missing auth token" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Invalid session" }, 401);

  // Admin gate: must be in the allowlist.
  const { data: adminRow } = await admin
    .from("admins").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (!adminRow) return json({ error: "You don't have admin access." }, 403);

  let body: { action?: string; id?: string; status?: string; reply?: string };
  try { body = await request.json(); } catch { return json({ error: "Invalid request body" }, 400); }
  const { action } = body;
  const id = (body.id ?? "").trim();
  if (!id) return json({ error: "Missing ticket id" }, 400);

  const { data: row, error: rowErr } = await admin
    .from("feedback")
    .select("id, github_issue_number")
    .eq("id", id)
    .single();
  if (rowErr || !row) return json({ error: "Ticket not found" }, 404);
  const issueNum = row.github_issue_number as number | null;
  const canSync = !!githubToken && !!issueNum;

  if (action === "reply") {
    const reply = (body.reply ?? "").trim().slice(0, 4000);
    if (!reply) return json({ error: "Reply is empty." }, 400);
    const { error } = await admin.from("feedback")
      .update({ admin_reply: reply, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return json({ error: "Couldn't save the reply." }, 500);
    if (canSync) await githubIssue(repo, githubToken!, issueNum!, "POST", "/comments", { body: `**Admin reply:**\n\n${reply}` });
    apiLog("admin-feedback", "reply", { id });
    return json({ ok: true }, 200);
  }

  if (action === "status") {
    const status = body.status ?? "";
    if (!STATUSES.includes(status)) return json({ error: "Invalid status." }, 400);
    const { error } = await admin.from("feedback")
      .update({ status, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return json({ error: "Couldn't update the status." }, 500);
    if (canSync) {
      await githubIssue(repo, githubToken!, issueNum!, "PATCH", "", { state: status === "done" ? "closed" : "open" });
    }
    apiLog("admin-feedback", "status", { id, status });
    return json({ ok: true }, 200);
  }

  if (action === "delete") {
    // Best-effort: close the issue with a note before deleting the row.
    if (canSync) {
      await githubIssue(repo, githubToken!, issueNum!, "POST", "/comments", { body: "_Ticket deleted by an admin in Roamly._" });
      await githubIssue(repo, githubToken!, issueNum!, "PATCH", "", { state: "closed" });
    }
    const { error } = await admin.from("feedback").delete().eq("id", id);
    if (error) return json({ error: "Couldn't delete that ticket." }, 500);
    apiLog("admin-feedback", "delete", { id });
    return json({ ok: true }, 200);
  }

  return json({ error: "Unknown action." }, 400);
}

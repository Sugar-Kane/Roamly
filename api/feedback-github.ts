import { createClient } from "@supabase/supabase-js";
import { limitOrResponse } from "./_ratelimit.js";

// Inlined structured logger (kept local so this function bundles standalone).
// Never log secrets, tokens, or message bodies — ids and outcomes only.
function apiLog(route: string, outcome: string, fields: Record<string, unknown> = {}): void {
  try {
    console.log(JSON.stringify({ src: "roamly-api", route, outcome, time: new Date().toISOString(), ...fields }));
  } catch {
    console.log(`roamly-api ${route} ${outcome}`);
  }
}

// Mirror a submitted feedback row to a GitHub issue so it becomes a trackable
// ticket the team (and the AI) can pull and act on. Fired best-effort from the
// client right after the feedback is saved. Degrades to a no-op (feedback still
// stored) whenever GITHUB_TOKEN isn't configured, so nothing breaks until the
// user adds the token in Vercel.
//
// Env: GITHUB_TOKEN (fine-grained PAT, Issues: Read+Write), GITHUB_REPO
// ("owner/name", default Sugar-Kane/Roamly).

const DEFAULT_REPO = "Sugar-Kane/Roamly";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const CATEGORY_LABEL: Record<string, string> = {
  bug: "bug", confusing: "confusing", idea: "idea", other: "other",
};

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

  // Short-window burst guard (Upstash; no-op until configured).
  const rl = await limitOrResponse("feedback-github", userData.user.id, 5, 60);
  if (rl) return rl;

  let body: { id?: string };
  try { body = await request.json(); } catch { return json({ error: "Invalid request body" }, 400); }
  const id = (body.id ?? "").trim();
  if (!id) return json({ error: "Missing feedback id" }, 400);

  // Load the feedback row + submitter details. Service role bypasses RLS, so we
  // re-check ownership by hand: the caller must own this feedback.
  const { data: row, error: rowErr } = await admin
    .from("feedback")
    .select("id, user_id, category, message, repro, page, device, platform, github_issue_number")
    .eq("id", id)
    .single();
  if (rowErr || !row) return json({ error: "Feedback not found" }, 404);
  if (row.user_id !== userData.user.id) return json({ error: "Not your feedback" }, 403);
  if (row.github_issue_number) return json({ ok: true, note: "already_mirrored" }, 200);

  // No token → feedback stays saved, just no issue yet. Report success so the
  // client never surfaces an error for an unconfigured integration.
  if (!githubToken) return json({ ok: true, note: "github_not_configured" }, 200);

  const { data: profile } = await admin
    .from("profiles").select("email, username").eq("id", row.user_id).single();

  const category = String(row.category);
  const message = String(row.message);
  const title = `[${category}] ${message.replace(/\s+/g, " ").slice(0, 60)}${message.length > 60 ? "…" : ""}`;
  const bodyLines = [
    message,
    "",
    "---",
    row.repro ? `**Frequency:** ${row.repro}` : "",
    row.page ? `**Page:** ${row.page}` : "",
    row.device ? `**Device:** ${row.device}` : "",
    row.platform ? `**Platform:** ${row.platform}` : "",
    `**From:** ${profile?.email ?? "unknown"}${profile?.username ? ` (@${profile.username})` : ""}`,
    "",
    `_Submitted through Roamly in-app feedback · ticket \`${row.id}\`_`,
  ].filter(Boolean);

  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title,
        body: bodyLines.join("\n"),
        labels: ["user-feedback", CATEGORY_LABEL[category] ?? "other"],
      }),
    });
    if (!res.ok) {
      apiLog("feedback-github", "issue_create_failed", { status: res.status });
      return json({ ok: true, note: "issue_create_failed" }, 200);
    }
    const issue = (await res.json()) as { number: number; html_url: string };
    await admin.from("feedback")
      .update({ github_issue_number: issue.number, github_issue_url: issue.html_url })
      .eq("id", row.id);
    apiLog("feedback-github", "issue_created", { id: row.id, number: issue.number });
    return json({ ok: true, number: issue.number, url: issue.html_url }, 200);
  } catch (err) {
    apiLog("feedback-github", "issue_create_error", { message: (err as Error)?.message });
    return json({ ok: true, note: "issue_create_error" }, 200);
  }
}

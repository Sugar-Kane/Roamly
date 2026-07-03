import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const ALLOWED_MEDIA_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type MediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

const DEFAULT_TAGS = ["Pharm", "Cardio", "Clinical", "PANCE", "Anatomy"];
const FREE_MONTHLY_QUOTA = 3;
const STORAGE_BUCKET = "study-uploads";
const SIGNED_URL_TTL_SECONDS = 300;

const TASKS_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          tag: { type: "string", description: "Short subject label, one or two words (e.g. 'Cardio', 'Neuro')" },
          est: { type: "integer" },
        },
        required: ["title", "tag", "est"],
        additionalProperties: false,
      },
    },
  },
  required: ["tasks"],
  additionalProperties: false,
};

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export async function POST(request: Request): Promise<Response> {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !serviceRoleKey || !anthropicKey) {
    return jsonResponse({ error: "Task generation isn't set up yet." }, 503);
  }

  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return jsonResponse({ error: "Missing auth token" }, 401);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse({ error: "Invalid session" }, 401);
  }
  const user = userData.user;

  let body: { storagePath?: string; mediaType?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const { storagePath, mediaType } = body;
  // The client always uploads into its own `${user.id}/...` folder (enforced by
  // storage RLS), but the service-role client bypasses RLS entirely — so we must
  // re-check ownership here ourselves, or any signed-in user could pass another
  // user's storagePath and get a signed URL (and Claude's read) of their file.
  if (!storagePath || !storagePath.startsWith(`${user.id}/`)) {
    return jsonResponse({ error: "Invalid file reference" }, 403);
  }
  if (!mediaType || !(ALLOWED_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    return jsonResponse({ error: "Unsupported file type — upload a PDF or photo (JPEG/PNG/WebP/GIF)." }, 400);
  }
  const validatedMediaType = mediaType as MediaType;

  const { data: profileRow, error: profileError } = await admin
    .from("profiles")
    .select("is_premium, ai_uploads_count, ai_uploads_period")
    .eq("id", user.id)
    .single();
  if (profileError || !profileRow) {
    return jsonResponse({ error: "Could not load profile" }, 500);
  }

  const period = currentPeriod();
  const isPremium = profileRow.is_premium as boolean;
  const usedThisPeriod = profileRow.ai_uploads_period === period ? (profileRow.ai_uploads_count as number) : 0;

  if (!isPremium && usedThisPeriod >= FREE_MONTHLY_QUOTA) {
    return jsonResponse({ error: "quota_exceeded" }, 403);
  }

  // Give Claude a short-lived signed URL rather than pulling the file through this
  // function ourselves — keeps us well clear of Vercel's 4.5MB request-body limit
  // (which only applies to the incoming request, not what we hand to Claude).
  const { data: signed, error: signError } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed) {
    return jsonResponse({ error: "Couldn't read the uploaded file — try again." }, 500);
  }

  // The student's existing subjects steer Claude's tagging: reuse them when
  // they fit, invent an apt new one only when nothing matches. sort_order
  // continues the user's list; both queries tolerate the column not existing.
  let existingTags: string[] = DEFAULT_TAGS;
  let maxOrder = 0;
  {
    let q: { data: { tag?: string; sort_order?: number | null }[] | null; error: { message: string } | null } =
      await admin.from("tasks").select("tag, sort_order").eq("user_id", user.id);
    if (q.error) q = await admin.from("tasks").select("tag").eq("user_id", user.id);
    if (!q.error && q.data && q.data.length > 0) {
      existingTags = [...new Set(q.data.map((r) => r.tag).filter((t): t is string => !!t))];
      maxOrder = q.data.reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0);
    }
  }

  const anthropic = new Anthropic({ apiKey: anthropicKey });

  const fileBlock =
    validatedMediaType === "application/pdf"
      ? { type: "document" as const, source: { type: "url" as const, url: signed.signedUrl } }
      : { type: "image" as const, source: { type: "url" as const, url: signed.signedUrl } };

  let tasks: { title: string; tag: string; est: number }[] = [];
  let claudeError: Response | null = null;
  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      system:
        "You extract a concrete study task list from uploaded lecture slides, syllabi, or notes for a Physician Assistant (PA) student. " +
        "Return one task per distinct topic or section you find (e.g. 'Review heart failure pathways', 'Practice 20 questions on beta-blockers') — skip cover pages, tables of contents, and filler. " +
        `Assign each task a 'tag': a short subject label of one or two words. The student's existing subjects are: ${existingTags.join(", ")}. ` +
        "Reuse one of those subjects whenever the material fits it; only introduce a new subject when none of them match (e.g. a neurology deck for a student with no Neuro subject), and use that same new subject consistently across related tasks. " +
        "Estimate 'est' as a rough number of 25-minute focus sessions (Pomodoros) the task would take, between 1 and 6. " +
        "Return at most 15 tasks, ordered by how the material is organized.",
      messages: [
        {
          role: "user",
          content: [fileBlock, { type: "text" as const, text: "Extract study tasks from this material." }],
        },
      ],
      output_config: { format: { type: "json_schema", schema: TASKS_SCHEMA } },
    });

    const textBlock = message.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) throw new Error("No text block in Claude response");
    const parsed = JSON.parse(textBlock.text) as { tasks: { title: string; tag: string; est: number }[] };
    tasks = parsed.tasks
      .filter((t) => t.title?.trim())
      .slice(0, 15)
      .map((t) => ({
        title: t.title.trim(),
        tag: (t.tag ?? "").trim().replace(/\s+/g, " ").slice(0, 24) || "General",
        est: Math.max(1, Math.min(6, Math.round(t.est) || 2)),
      }));
  } catch (err) {
    console.warn("[Roamly] generate-tasks: Claude call failed", err);
    claudeError = jsonResponse({ error: "Couldn't read that file — try a clearer PDF or photo." }, 502);
  }

  // Best-effort cleanup now that Claude has (or hasn't) read the file — we don't
  // retain uploaded study material once it's been processed.
  try {
    await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
  } catch (err) {
    console.warn("[Roamly] generate-tasks: cleanup failed", err);
  }

  if (claudeError) return claudeError;

  if (tasks.length === 0) {
    return jsonResponse({ error: "Couldn't find any tasks in that file." }, 422);
  }

  const rows = tasks.map((t, i) => ({ user_id: user.id, title: t.title, tag: t.tag, est: t.est, sort_order: maxOrder + i + 1 }));
  let ins = await admin.from("tasks").insert(rows).select("*");
  if (ins.error && ins.error.message.includes("sort_order")) {
    // sort_order column not migrated in yet — insert without it.
    ins = await admin.from("tasks").insert(rows.map(({ sort_order: _so, ...r }) => r)).select("*");
  }
  const { data: inserted, error: insertError } = ins;
  if (insertError || !inserted) {
    return jsonResponse({ error: "Generated tasks but couldn't save them — try again." }, 500);
  }

  if (!isPremium) {
    await admin
      .from("profiles")
      .update({ ai_uploads_count: usedThisPeriod + 1, ai_uploads_period: period })
      .eq("id", user.id);
  }

  return jsonResponse({ tasks: inserted }, 200);
}

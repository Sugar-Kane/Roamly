import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import mammoth from "mammoth";
import JSZip from "jszip";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const ALLOWED_MEDIA_TYPES = [
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif",
  "text/plain", "text/markdown", "text/csv", DOCX, PPTX,
] as const;
type MediaType = (typeof ALLOWED_MEDIA_TYPES)[number];
const MAX_TEXT_CHARS = 60_000; // keep worst-case Claude input (and cost) bounded

const FREE_MONTHLY_QUOTA = 3;
// Premium is capped too — "unlimited" uploads would be an open tab on the
// Anthropic bill. Generous for real studying, hostile to abuse.
const PREMIUM_MONTHLY_QUOTA = 30;
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
    return jsonResponse({ error: "Unsupported file type — upload a PDF, photo, Word/PowerPoint file, or plain text." }, 400);
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
  const quota = isPremium ? PREMIUM_MONTHLY_QUOTA : FREE_MONTHLY_QUOTA;

  if (usedThisPeriod >= quota) {
    return jsonResponse({ error: "quota_exceeded" }, 403);
  }

  // Reserve the quota slot BEFORE the Claude call (refunded on failure below).
  // Incrementing after the call let parallel requests race past the cap.
  await admin
    .from("profiles")
    .update({ ai_uploads_count: usedThisPeriod + 1, ai_uploads_period: period })
    .eq("id", user.id);

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
  let existingTags: string[] = [];
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

  let tasks: { title: string; tag: string; est: number }[] = [];
  let claudeError: Response | null = null;
  try {
    // PDFs and images go to Claude by URL; Office/text files are extracted to
    // plain text here first (Claude's document block only accepts PDFs).
    let fileBlock:
      | { type: "document"; source: { type: "url"; url: string } }
      | { type: "image"; source: { type: "url"; url: string } }
      | { type: "text"; text: string };
    if (validatedMediaType === "application/pdf") {
      fileBlock = { type: "document", source: { type: "url", url: signed.signedUrl } };
    } else if (validatedMediaType.startsWith("image/")) {
      fileBlock = { type: "image", source: { type: "url", url: signed.signedUrl } };
    } else {
      const resp = await fetch(signed.signedUrl);
      if (!resp.ok) throw new Error(`file fetch failed (${resp.status})`);
      let text: string;
      if (validatedMediaType === DOCX) {
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(await resp.arrayBuffer()) });
        text = value;
      } else if (validatedMediaType === PPTX) {
        // A .pptx is a zip; slide text lives in <a:t> runs inside each slide's XML.
        const zip = await JSZip.loadAsync(await resp.arrayBuffer());
        const slideNames = Object.keys(zip.files)
          .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
          .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
        const slides: string[] = [];
        for (const name of slideNames) {
          const xml = await zip.files[name].async("string");
          const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
          if (runs.length > 0) slides.push(runs.join(" "));
        }
        text = slides.map((s, i) => `Slide ${i + 1}: ${s}`).join("\n");
      } else {
        text = await resp.text();
      }
      text = text.trim().slice(0, MAX_TEXT_CHARS);
      if (text.length < 20) {
        throw new Error("no extractable text");
      }
      fileBlock = { type: "text", text: `Study material (extracted from the student's uploaded file):\n\n${text}` };
    }
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      system:
        "You extract a concrete study task list from uploaded lecture slides, syllabi, or notes for a Physician Assistant (PA) student. " +
        "Return one task per distinct topic or section you find (e.g. 'Review heart failure pathways', 'Practice 20 questions on beta-blockers') — skip cover pages, tables of contents, and filler. " +
        "Assign each task a 'tag': a short subject label of one or two words. " +
        (existingTags.length > 0
          ? `The student's existing subjects are: ${existingTags.join(", ")}. Reuse one of those subjects whenever the material fits it; only introduce a new subject when none of them match, and use that same new subject consistently across related tasks. `
          : "The student has no subjects yet — create apt short subject labels from the material and use each consistently across related tasks. ") +
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
    console.warn("[Roamly] generate-tasks: read/Claude step failed", err);
    claudeError = jsonResponse({ error: "Couldn't read that file — try a clearer copy or a different format." }, 502);
  }

  // Best-effort cleanup now that Claude has (or hasn't) read the file — we don't
  // retain uploaded study material once it's been processed. Also sweep any
  // stale leftovers in this user's folder (uploads that never reached this
  // function would otherwise accumulate forever).
  try {
    await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
    const { data: leftovers } = await admin.storage.from(STORAGE_BUCKET).list(user.id);
    const stale = (leftovers ?? [])
      .filter((f) => f.created_at && Date.now() - new Date(f.created_at).getTime() > 60 * 60 * 1000)
      .map((f) => `${user.id}/${f.name}`);
    if (stale.length > 0) await admin.storage.from(STORAGE_BUCKET).remove(stale);
  } catch (err) {
    console.warn("[Roamly] generate-tasks: cleanup failed", err);
  }

  if (claudeError) {
    // Refund the reserved quota slot — the user got nothing for it.
    await admin
      .from("profiles")
      .update({ ai_uploads_count: usedThisPeriod, ai_uploads_period: period })
      .eq("id", user.id);
    return claudeError;
  }

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

  return jsonResponse({ tasks: inserted }, 200);
}

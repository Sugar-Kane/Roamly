import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const ALLOWED_MEDIA_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type MediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

const TAGS = ["Pharm", "Cardio", "Clinical", "PANCE", "Anatomy"] as const;
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const FREE_MONTHLY_QUOTA = 3;

const TASKS_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          tag: { type: "string", enum: [...TAGS] },
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

  let body: { fileBase64?: string; mediaType?: string };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body" }, 400);
  }

  const { fileBase64, mediaType } = body;
  if (!fileBase64 || !mediaType || !(ALLOWED_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    return jsonResponse({ error: "Unsupported file type — upload a PDF or photo (JPEG/PNG/WebP/GIF)." }, 400);
  }
  // Rough decoded-size check: base64 is ~4/3 the size of the raw bytes.
  if (fileBase64.length > (MAX_FILE_BYTES * 4) / 3) {
    return jsonResponse({ error: "That file is too large — try something under 15MB." }, 400);
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

  const anthropic = new Anthropic({ apiKey: anthropicKey });

  const fileBlock =
    validatedMediaType === "application/pdf"
      ? {
          type: "document" as const,
          source: { type: "base64" as const, media_type: "application/pdf" as const, data: fileBase64 },
        }
      : {
          type: "image" as const,
          source: { type: "base64" as const, media_type: validatedMediaType, data: fileBase64 },
        };

  let tasks: { title: string; tag: string; est: number }[];
  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      system:
        "You extract a concrete study task list from uploaded lecture slides, syllabi, or notes for a Physician Assistant (PA) student. " +
        "Return one task per distinct topic or section you find (e.g. 'Review heart failure pathways', 'Practice 20 questions on beta-blockers') — skip cover pages, tables of contents, and filler. " +
        "Pick the closest matching tag for each task from the allowed set. Estimate 'est' as a rough number of 25-minute focus sessions (Pomodoros) the task would take, between 1 and 6. " +
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
        tag: (TAGS as readonly string[]).includes(t.tag) ? t.tag : "Clinical",
        est: Math.max(1, Math.min(6, Math.round(t.est) || 2)),
      }));
  } catch (err) {
    console.warn("[Roamly] generate-tasks: Claude call failed", err);
    return jsonResponse({ error: "Couldn't read that file — try a clearer PDF or photo." }, 502);
  }

  if (tasks.length === 0) {
    return jsonResponse({ error: "Couldn't find any tasks in that file." }, 422);
  }

  const { data: inserted, error: insertError } = await admin
    .from("tasks")
    .insert(tasks.map((t) => ({ user_id: user.id, title: t.title, tag: t.tag, est: t.est })))
    .select("id, title, tag, done, poms, est");
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

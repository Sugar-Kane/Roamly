import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Check } from "lucide-react";
import { uploadStudyMaterial, getAccessToken } from "./db";

export const FREE_MONTHLY_UPLOAD_QUOTA = 3;
const MAX_UPLOAD_BYTES = 22 * 1024 * 1024;

// Keep in sync with ALLOWED_MEDIA_TYPES in api/generate-tasks.ts. Some
// platforms report an empty MIME for .md/.csv, so the extension map below is
// the fallback source of truth for the type we send.
const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  txt: "text/plain", md: "text/markdown", csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.gif,.txt,.md,.csv,.docx,.pptx";

function mediaTypeOf(file: File): string | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const byExt = EXT_TO_MIME[ext];
  // Prefer the extension mapping (browsers report odd MIMEs for md/csv);
  // fall back to the browser's type if the extension is unknown.
  if (byExt) return byExt;
  return Object.values(EXT_TO_MIME).includes(file.type) ? file.type : null;
}

export function currentUploadPeriod() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

type Stage = "idle" | "uploading" | "reading" | "done";

export function UploadTasksPanel({ profile, session, onImported, onUpgrade }: any) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const creep = useRef<number | null>(null);

  const isPremium = profile?.is_premium ?? false;
  const usedThisPeriod = profile?.ai_uploads_period === currentUploadPeriod() ? (profile?.ai_uploads_count ?? 0) : 0;
  const remaining = Math.max(0, FREE_MONTHLY_UPLOAD_QUOTA - usedThisPeriod);
  const loading = stage === "uploading" || stage === "reading";

  const stopCreep = () => { if (creep.current) { window.clearInterval(creep.current); creep.current = null; } };
  useEffect(() => stopCreep, []);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setQuotaExceeded(false);
    const mediaType = mediaTypeOf(file);
    if (!mediaType) {
      setError("Unsupported file type — upload a PDF, photo, Word/PowerPoint file, or plain text (.txt/.md/.csv).");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("That file is too large — try something under 22MB.");
      return;
    }
    const userId = session?.user.id;
    if (!userId) { setError("Sign in to upload study material."); return; }
    setStage("uploading");
    setProgress(8);
    try {
      // Upload straight to Storage first — the file never passes through our
      // serverless function, which is capped at a 4.5MB request body by Vercel.
      const storagePath = await uploadStudyMaterial(userId, file);
      if (!storagePath) { setError("Couldn't upload that file — try again."); setStage("idle"); return; }
      setProgress(40);
      setStage("reading");
      // The AI read takes ~5-30s with no progress events — creep the bar toward
      // 90% so the user can see it's alive; it jumps to 100% on completion.
      creep.current = window.setInterval(() => setProgress((p) => Math.min(90, p + 2)), 700);
      const token = await getAccessToken();
      if (!token) { setError("Sign in to upload study material."); setStage("idle"); return; }
      const res = await fetch("/api/generate-tasks", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ storagePath, mediaType }),
      });
      const result = await res.json();
      stopCreep();
      if (res.status === 403 && result.error === "quota_exceeded") {
        setQuotaExceeded(true);
        setStage("idle");
        return;
      }
      if (result.error === "ai_at_capacity") {
        setError("AI uploads are at capacity this month — they reset on the 1st. You can still add tasks manually.");
        setStage("idle");
        return;
      }
      if (!res.ok) {
        setError(result.error ?? "Something went wrong — try again.");
        setStage("idle");
        return;
      }
      setProgress(100);
      setDoneCount(result.tasks.length);
      setStage("done");
      onImported(result.tasks);
    } catch {
      stopCreep();
      setError("Couldn't reach the server. Try again soon.");
      setStage("idle");
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-card/60 p-4 text-left transition hover:border-primary/40">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Sparkles size={16} className="text-primary" /> Upload notes or slides — auto-generate tasks
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {isPremium ? "30 uploads a month" : `${remaining} of ${FREE_MONTHLY_UPLOAD_QUOTA} free left this month`}
        </span>
      </button>
    );
  }

  if (quotaExceeded) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/60 p-4">
        <p className="text-sm text-muted-foreground">You've used your {FREE_MONTHLY_UPLOAD_QUOTA} free uploads this month.</p>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={onUpgrade} className="rounded-full gradient-primary px-4 py-1.5 text-xs font-semibold text-white shadow-glow">Go Premium</button>
          <button onClick={() => setOpen(false)} className="text-xs text-muted-foreground underline">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/60 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Upload notes, slides, or a photo</span>
        <button onClick={() => { setOpen(false); setStage("idle"); setProgress(0); }} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">PDF, Word, PowerPoint, text, or photos.</p>
      {stage !== "done" && (
        <input type="file" accept={ACCEPT} disabled={loading}
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className="mt-3 block w-full text-xs text-muted-foreground file:mr-3 file:rounded-full file:border-0 file:bg-primary/10 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-primary" />
      )}
      {(loading || stage === "done") && (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-[hsl(var(--primary))] transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {stage === "uploading" && "Uploading your file…"}
            {stage === "reading" && "AI is reading your file and writing tasks…"}
            {stage === "done" && <><Check size={13} className="text-roamly-green" /> Done — {doneCount} task{doneCount === 1 ? "" : "s"} added to your list.</>}
          </p>
          {stage === "done" && (
            <button onClick={() => { setStage("idle"); setProgress(0); }} className="mt-1.5 text-xs text-primary underline-offset-2 hover:underline">
              Upload another
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </div>
  );
}

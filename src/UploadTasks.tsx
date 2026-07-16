import { useEffect, useRef, useState } from "react";
import { Sparkles, X, Check } from "lucide-react";
import { uploadStudyMaterial, getAccessToken, type Profile } from "./db";
import { InfoTip } from "./FocusMode";
import type { Task } from "./data";
import type { Session } from "@supabase/supabase-js";

export const FREE_MONTHLY_UPLOAD_QUOTA = 3;
// Mirrors PREMIUM_MONTHLY_QUOTA in api/generate-tasks.ts.
export const PREMIUM_MONTHLY_UPLOAD_QUOTA = 10;
// Mirrors MAX_UPLOAD_BYTES in api/generate-tasks.ts (the server re-checks, so
// this is UX, not the safeguard) — bounds a worst-case PDF's AI cost.
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const FILE_TOO_LARGE_MSG = "That file is over 12 MB. Split big decks into parts and upload them separately.";

// Explains the two credit pools without hard-coding a stale allowance: the
// number shown always comes from the caller's real plan (FREE_/PREMIUM_
// MONTHLY_UPLOAD_QUOTA, which mirror api/generate-tasks.ts). The backend
// enforces exactly these rollover rules: the monthly count resets each
// calendar month (ai_uploads_period) and never carries over, while purchased
// ai_credits persist until spent.
export function creditsExplainer(isPremium: boolean): string {
  const quota = isPremium ? PREMIUM_MONTHLY_UPLOAD_QUOTA : FREE_MONTHLY_UPLOAD_QUOTA;
  return `Your plan includes ${quota} AI uploads each month (${isPremium ? "Premium plan" : "free plan"}). Unused monthly uploads expire when the next month's allowance arrives — they do not roll over. Purchased top-up credits are separate: they never expire, carry over month to month, and are used automatically once the monthly allowance runs out.`;
}

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

export function UploadTasksPanel({ profile, session, onImported, onUpgrade, onBuyCredits }: {
  profile: Profile | null;
  session: Session | null;
  onImported: (tasks: Task[]) => void;
  onUpgrade: () => void;
  onBuyCredits?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [processingMode, setProcessingMode] = useState<"native_text" | "ocr_image" | "ocr_pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const creep = useRef<number | null>(null);

  const isPremium = profile?.is_premium ?? false;
  const usedThisPeriod = profile?.ai_uploads_period === currentUploadPeriod() ? (profile?.ai_uploads_count ?? 0) : 0;
  const monthlyQuota = isPremium ? PREMIUM_MONTHLY_UPLOAD_QUOTA : FREE_MONTHLY_UPLOAD_QUOTA;
  const monthlyRemaining = Math.max(0, monthlyQuota - usedThisPeriod);
  const credits = (profile?.ai_credits as number | undefined) ?? 0;
  // What the user can actually upload right now: this month's remaining free
  // allowance plus any purchased credits. Shown as one live number so buying a
  // top-up bumps it immediately (profiles is on the realtime subscription).
  const uploadsLeft = monthlyRemaining + credits;
  const loading = stage === "uploading" || stage === "reading";

  const stopCreep = () => { if (creep.current) { window.clearInterval(creep.current); creep.current = null; } };
  useEffect(() => stopCreep, []);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setProcessingMode(null);
    setQuotaExceeded(false);
    const mediaType = mediaTypeOf(file);
    if (!mediaType) {
      setError("Unsupported file type. Upload a PDF, photo, Word/PowerPoint file, or plain text (.txt/.md/.csv).");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(FILE_TOO_LARGE_MSG);
      return;
    }
    const userId = session?.user.id;
    if (!userId) { setError("Sign in to upload study material."); return; }
    setStage("uploading");
    setProgress(15);
    try {
      // Upload straight to Storage first — the file never passes through our
      // serverless function, which is capped at a 4.5MB request body by Vercel.
      const storagePath = await uploadStudyMaterial(userId, file);
      if (!storagePath) { setError("Couldn't upload that file. Try again."); setStage("idle"); return; }
      setProgress(40);
      setStage("reading");
      // The AI read takes ~5-30s with no progress events — creep the bar toward
      // 90% so the user can see it's alive; it jumps to 100% on completion.
      creep.current = window.setInterval(() => setProgress((p) => Math.min(90, p + 3)), 350);
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
        setError("AI uploads are at capacity this month. They reset on the 1st. You can still add tasks manually.");
        setStage("idle");
        return;
      }
      if (result.error === "file_too_large") {
        setError(FILE_TOO_LARGE_MSG);
        setStage("idle");
        return;
      }
      if (!res.ok) {
        setError(result.error ?? "Something went wrong. Try again.");
        setStage("idle");
        return;
      }
      setProgress(100);
      setDoneCount(result.tasks.length);
      setProcessingMode(result.processingMode ?? null);
      setStage("done");
      onImported(result.tasks);
    } catch {
      stopCreep();
      setError("Couldn't reach the server. Try again soon.");
      setStage("idle");
    }
  };

  if (!open) {
    // Signed-in users can top up anytime (stock up before running out).
    // Buying credits lifts uploadsLeft live, so the count updates without a reload.
    const canTopUp = !!session;
    return (
      <div className="w-full">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-card/60 px-3 py-2.5">
          <span className="flex items-center gap-2 text-xs text-muted-foreground"><Sparkles size={14} className="text-primary" /> Upload study material and AI will create editable tasks for you</span>
          <label className="cursor-pointer rounded-full gradient-primary px-3 py-1 text-xs font-semibold text-white shadow-glow transition active:scale-95">
            <input type="file" accept={ACCEPT} className="sr-only" aria-label="Choose study material"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null;
                if (!file) return;
                setOpen(true);
                void handleFile(file);
                event.currentTarget.value = "";
              }} />
            Choose file
          </label>
        </div>
        <p className="mt-1.5 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          {`You have ${uploadsLeft} upload${uploadsLeft === 1 ? "" : "s"} left`}
          {canTopUp && onBuyCredits && (
            <button onClick={onBuyCredits}
              className="rounded-full border border-primary/50 bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary transition hover:bg-primary/20 active:scale-95">
              Top up
            </button>
          )}
          <InfoTip text={creditsExplainer(isPremium)} />
        </p>
      </div>
    );
  }

  if (quotaExceeded) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/60 p-4">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          You've used your monthly AI uploads{isPremium ? "" : ` (${FREE_MONTHLY_UPLOAD_QUOTA} free)`}, and any purchased credits.
          <InfoTip text={creditsExplainer(isPremium)} />
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {!isPremium && (
            <button onClick={onUpgrade} className="rounded-full gradient-primary px-4 py-1.5 text-xs font-semibold text-white shadow-glow">Go Premium</button>
          )}
          {onBuyCredits && (
            <button onClick={onBuyCredits} className="rounded-full border border-primary/50 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20">
              Buy upload credits
            </button>
          )}
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
      <p className="mt-0.5 text-xs text-muted-foreground">Roamly AI reads your PDF, Word file, PowerPoint, text, screenshot, or photo and creates editable study tasks from the material. Files can be up to 12 MB; scans use OCR automatically and handwriting is best effort.</p>
      {stage !== "done" && (
        <input type="file" accept={ACCEPT} disabled={loading}
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className="themed-file-input mt-3 block w-full text-xs text-muted-foreground" />
      )}
      {(loading || stage === "done") && (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-border">
            <div className="h-full rounded-full bg-[hsl(var(--primary))] transition-all duration-200" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            {stage === "uploading" && "Uploading your file…"}
            {stage === "reading" && "Reading text and using OCR only if needed…"}
            {stage === "done" && <><Check size={13} className="text-roamly-green" /> Done: {doneCount} task{doneCount === 1 ? "" : "s"} added{processingMode === "ocr_pdf" || processingMode === "ocr_image" ? " using OCR" : ""}.</>}
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

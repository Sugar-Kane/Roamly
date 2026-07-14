// In-app feedback form, reachable from the profile menu. Asks the diagnostic
// questions up front (category, repro frequency) and silently attaches the
// context needed to reproduce a bug — current tab, device class, screen size
// and browser — so reports arrive actionable.

import { useState } from "react";
import { X, MessageSquare, Check } from "lucide-react";
import { submitFeedback, mirrorFeedbackToGitHub } from "./db";
import { deviceType, platformInfo, track } from "./track";
import { Modal } from "./Modal";

const CATEGORIES = [
  { id: "bug", label: "Something's broken" },
  { id: "confusing", label: "Something's confusing" },
  { id: "idea", label: "I have an idea" },
  { id: "other", label: "Other" },
];

const PLACEHOLDER: Record<string, string> = {
  bug: "What happened, and what did you expect instead? What did you tap right before it went wrong?",
  confusing: "What were you trying to do, and where did you get stuck?",
  idea: "What would you like Roamly to do?",
  other: "What's on your mind?",
};

const REPRO_OPTIONS = ["Every time", "Sometimes", "Happened once"];

export function FeedbackModal({ userId, page, onClose }: { userId: string; page: string; onClose: () => void }) {
  const [category, setCategory] = useState("bug");
  const [message, setMessage] = useState("");
  const [repro, setRepro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsRepro = category === "bug" || category === "confusing";

  const send = async () => {
    if (message.trim().length < 3) {
      setError("Tell me a little more. A sentence or two helps a lot.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await submitFeedback(userId, {
      category,
      message: message.trim().slice(0, 2000),
      repro: needsRepro ? repro : null,
      page,
      device: deviceType(),
      platform: platformInfo().slice(0, 160),
    });
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    track("feedback_sent");
    // Fire-and-forget: turn this into a GitHub ticket if the server has a
    // token. Never blocks the thank-you — the feedback is already saved.
    if (res.id) void mirrorFeedbackToGitHub(res.id);
    setDone(true);
  };

  return (
    <Modal label="Send feedback" onClose={onClose}
      overlayClassName="fixed inset-0 z-[130] grid place-items-center bg-foreground/30 p-5 backdrop-blur-sm"
      cardClassName="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl gradient-primary shadow-glow">
            <MessageSquare size={20} className="text-white" />
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X size={18} /></button>
        </div>

        {done ? (
          <div className="mt-4">
            <h3 className="font-display text-xl font-semibold">Thank you!</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Your feedback went straight to the team. It genuinely shapes what gets fixed and built next.
            </p>
            <button onClick={onClose} className="mt-5 w-full rounded-full gradient-primary py-2.5 font-semibold text-white shadow-glow transition active:scale-95">
              <span className="inline-flex items-center gap-1.5"><Check size={16} /> Done</span>
            </button>
          </div>
        ) : (
          <>
            <h3 className="mt-4 font-display text-xl font-semibold">Send feedback</h3>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button key={c.id} onClick={() => setCategory(c.id)} aria-pressed={category === c.id}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${category === c.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 text-muted-foreground hover:border-primary/40"}`}>
                  {c.label}
                </button>
              ))}
            </div>

            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4}
              placeholder={PLACEHOLDER[category]}
              className="mt-3 w-full rounded-xl border border-border bg-card px-3.5 py-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />

            {needsRepro && (
              <div className="mt-2">
                <p className="text-xs font-medium text-muted-foreground">Does it happen every time?</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {REPRO_OPTIONS.map((r) => (
                    <button key={r} onClick={() => setRepro(repro === r ? null : r)} aria-pressed={repro === r}
                      className={`rounded-full border px-3 py-1 text-xs transition ${repro === r ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 text-muted-foreground hover:border-primary/40"}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

            <button onClick={send} disabled={busy}
              className="mt-4 w-full rounded-full gradient-primary py-2.5 font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-50">
              {busy ? "Sending…" : "Send feedback"}
            </button>
            <p className="mt-2.5 text-center text-[11px] leading-snug text-muted-foreground">
              Sent along automatically: the tab you're on ({page}), whether you're on phone or PC, and your screen size & browser. It makes bugs much easier to reproduce.
            </p>
          </>
        )}
    </Modal>
  );
}

import { Check } from "lucide-react";
import { Modal } from "./Modal";
import { tagColor, type Task } from "./data";

export function TagPill({ tag }: { tag: string }) {
  const c = tagColor(tag);
  return (
    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${c}1f`, color: c }}>
      {tag}
    </span>
  );
}

export type DragState = { id: string; group: string; from: number; over: number; dy: number; height: number };

// Themed yes/no dialog, replacing bare window.confirm() pop-ups. onConfirm runs
// on the confirm click (still a user gesture, so iOS audio unlock survives).
export function ConfirmModal({ title, body, confirmLabel, onConfirm, onClose }: {
  title: string; body?: string; confirmLabel: string; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal label={title} onClose={onClose}
      overlayClassName="fixed inset-0 z-[140] grid place-items-center bg-foreground/30 p-5 backdrop-blur-sm"
      cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl">
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {body && <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={onClose} className="flex-1 rounded-full border border-border bg-card py-2 text-sm text-muted-foreground transition hover:border-primary/40">Cancel</button>
        <button autoFocus onClick={() => { onConfirm(); onClose(); }}
          className="flex-1 rounded-full gradient-primary py-2 text-sm font-semibold text-white shadow-glow transition active:scale-95">{confirmLabel}</button>
      </div>
    </Modal>
  );
}

// Themed picker opened from a task's subject badge: choose another existing
// subject to move the task into. New subjects are still created through the
// add-task row's "＋ New subject…" flow.
export function TaskCategoryModal({ task, tags, onPick, onClose }: {
  task: Task; tags: string[]; onPick: (tag: string) => void; onClose: () => void;
}) {
  return (
    <Modal label="Change subject" onClose={onClose} cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl">
      <h3 className="font-display text-lg font-semibold">Move to subject</h3>
      <p className="mt-1 truncate text-xs text-muted-foreground">“{task.title}”</p>
      <div className="mt-3 max-h-[50dvh] space-y-1.5 overflow-y-auto overscroll-contain">
        {tags.map((tag) => {
          const current = tag === task.tag;
          const c = tagColor(tag);
          return (
            <button key={tag} onClick={() => { if (!current) onPick(tag); onClose(); }} aria-pressed={current}
              className={`flex min-h-[2.75rem] w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition ${current ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 hover:border-primary/40"}`}>
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c }} />
              <span className="min-w-0 flex-1 break-words">{tag}</span>
              {current && <Check size={15} className="shrink-0 text-primary" />}
            </button>
          );
        })}
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">Need a new subject? Create it with “＋ New subject…” when adding a task.</p>
    </Modal>
  );
}

export function TaskEstModal({ task, onPick, onClose }: {
  task: Task; onPick: (n: number) => void; onClose: () => void;
}) {
  return (
    <Modal label="Focus sessions needed" onClose={onClose} cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl">
      <h3 className="font-display text-lg font-semibold">How many focus sessions to complete this task?</h3>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
          <button key={n} onClick={() => { onPick(n); onClose(); }} aria-pressed={task.est === n}
            className={`rounded-xl border py-2.5 font-mono text-sm transition ${task.est === n ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
            {n}
          </button>
        ))}
      </div>
    </Modal>
  );
}

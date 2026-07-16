import { useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Pencil, Trash2 } from "lucide-react";
import { Modal } from "./Modal";
import { ThemedSelect } from "./ThemedSelect";
import { InfoTip } from "./FocusMode";
import type { ExamSchedule } from "./db";

// Local-time YYYY-MM-DD (not toISOString, which is UTC and can be a day off).
export function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseLocalDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}

export function localDateValue(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function ThemedDatePicker({ value, min, onChange }: { value: string; min?: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = parseLocalDate(value);
  const today = new Date();
  const [visibleMonth, setVisibleMonth] = useState(() => new Date(selected?.year ?? today.getFullYear(), selected?.month ?? today.getMonth(), 1));
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    const nextSelected = parseLocalDate(value);
    if (nextSelected) setVisibleMonth(new Date(nextSelected.year, nextSelected.month, 1));
  }, [value]);

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const leading = new Date(year, month, 1).getDay();
  const dayCount = new Date(year, month + 1, 0).getDate();
  const display = selected
    ? new Date(selected.year, selected.month, selected.day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : "Choose exam date";

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button type="button" onClick={() => setOpen((current) => !current)} aria-label="Exam date" aria-haspopup="dialog" aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 text-left text-sm text-foreground transition hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30">
        <span className={selected ? "truncate" : "truncate text-muted-foreground"}>{display}</span>
        <CalendarClock size={16} className="shrink-0 text-primary" />
      </button>
      {open && (
        <div role="dialog" aria-label="Choose exam date"
          className="absolute left-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-3rem))] rounded-2xl border border-border bg-card p-4 text-foreground shadow-xl">
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setVisibleMonth(new Date(year, month - 1, 1))} aria-label="Previous month"
              className="grid h-8 w-8 place-items-center rounded-full border border-border bg-background/50 text-muted-foreground transition hover:border-primary/50 hover:text-primary">
              <ChevronLeft size={16} />
            </button>
            <span className="font-display text-sm font-semibold">{visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
            <button type="button" onClick={() => setVisibleMonth(new Date(year, month + 1, 1))} aria-label="Next month"
              className="grid h-8 w-8 place-items-center rounded-full border border-border bg-background/50 text-muted-foreground transition hover:border-primary/50 hover:text-primary">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {["S", "M", "T", "W", "T", "F", "S"].map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: leading }, (_, index) => <span key={`blank-${index}`} />)}
            {Array.from({ length: dayCount }, (_, index) => {
              const day = index + 1;
              const dateValue = localDateValue(year, month, day);
              const chosen = selected?.year === year && selected.month === month && selected.day === day;
              const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
              const disabled = !!min && dateValue < min;
              return <button key={day} type="button" disabled={disabled} onClick={() => { onChange(dateValue); setOpen(false); }} aria-pressed={chosen}
                className={`grid h-9 place-items-center rounded-xl text-sm transition ${chosen ? "gradient-primary font-semibold text-white shadow-glow" : isToday ? "border border-primary/50 bg-primary/10 font-semibold text-primary" : "hover:bg-primary/10 hover:text-primary"} disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-foreground`}>
                {day}
              </button>;
            })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <button type="button" onClick={() => {
                setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                onChange(localDateValue(today.getFullYear(), today.getMonth(), today.getDate()));
                setOpen(false);
              }} className="rounded-full px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10">Today</button>
              <button type="button" onClick={() => onChange("")} className="rounded-full px-3 py-1.5 text-xs text-muted-foreground hover:bg-background/60">Clear</button>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-full gradient-primary px-4 py-1.5 text-xs font-semibold text-white shadow-glow">Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// The board exams PA (and med) students most often count down to. "Custom…"
// covers everything else (shelf exams, finals, quizzes) with a free-text name.
const EXAM_OPTIONS = [
  "PANCE", "PANRE", "PACKRAT", "EOR (End of Rotation)",
  "Family Medicine EOR", "Internal Medicine EOR", "Emergency Medicine EOR",
  "General Surgery EOR", "Pediatrics EOR", "Psychiatry EOR", "Women's Health EOR",
  "USMLE Step 1", "USMLE Step 2 CK", "USMLE Step 3",
  "COMLEX Level 1", "COMLEX Level 2-CE", "COMLEX Level 3",
  "MCAT", "NCLEX-RN", "NCLEX-PN", "DAT", "GRE", "LSAT", "Bar Exam", "CPA Exam",
];

export function ExamSchedulePanel({ exams, onCreate, onUpdate, onDelete }: {
  exams: ExamSchedule[];
  onCreate: (name: string, date: string) => Promise<boolean>;
  onUpdate: (id: string, name: string, date: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draftDate, setDraftDate] = useState("");
  const [examPick, setExamPick] = useState("PANCE");
  const [customName, setCustomName] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExamSchedule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const todayStr = localTodayISO();
  const sorted = [...exams].sort((a, b) => a.exam_date.localeCompare(b.exam_date));
  const today = new Date(); today.setHours(0, 0, 0, 0);

  const resetDraft = () => {
    setEditingId(null);
    setDraftDate("");
    setExamPick("PANCE");
    setCustomName("");
    setMessage(null);
  };
  const startNew = () => {
    setDraftDate("");
    setExamPick("PANCE");
    setCustomName("");
    setMessage(null);
    setEditingId("new");
  };
  const startEdit = (exam: ExamSchedule) => {
    const listed = EXAM_OPTIONS.includes(exam.name);
    setDraftDate(exam.exam_date);
    setExamPick(listed ? exam.name : "custom");
    setCustomName(listed ? "" : exam.name);
    setMessage(null);
    setEditingId(exam.id);
  };
  const save = async () => {
    if (!draftDate || draftDate < todayStr) return;
    const name = examPick === "custom" ? customName.trim().slice(0, 60) : examPick;
    if (!name) {
      setMessage("Enter a name for this exam.");
      return;
    }
    setSaving(true);
    const saved = editingId === "new"
      ? await onCreate(name, draftDate)
      : editingId ? await onUpdate(editingId, name, draftDate) : false;
    setSaving(false);
    if (saved) resetDraft();
    else setMessage("Couldn't save that exam. Try again.");
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    if (!await onDelete(deleteTarget.id)) {
      setDeleteError("Couldn't delete that exam. Try again.");
      setDeleting(false);
      return;
    }
    if (editingId === deleteTarget.id) resetDraft();
    setDeleting(false);
    setDeleteTarget(null);
  };

  return (
    <section className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock size={16} className="text-primary" /> Exam schedule
            <InfoTip text="Track as many board exams, rotation exams, finals, or custom tests as you need. Roamly orders them by date and keeps a live countdown for each one." />
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Keep every upcoming test and countdown together.</p>
        </div>
        {editingId !== "new" && (
          <button onClick={startNew} className="flex items-center gap-1.5 rounded-full gradient-primary px-3 py-1.5 text-xs font-semibold text-white shadow-glow">
            <Plus size={13} /> Add exam
          </button>
        )}
      </div>

      {editingId && (
        <Modal label={editingId === "new" ? "Add an exam" : "Edit exam"} onClose={resetDraft}
          cardClassName="w-full max-w-xl rounded-3xl border border-border bg-card p-6 shadow-xl">
          <div className="grid h-11 w-11 place-items-center rounded-2xl gradient-primary text-white shadow-glow"><CalendarClock size={20} /></div>
          <h3 className="mt-4 font-display text-xl font-semibold">{editingId === "new" ? "Add an exam" : "Edit exam"}</h3>
          <p className="mt-1 text-sm text-muted-foreground">Choose the exam and date Roamly should track.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 gap-2">
              <ThemedSelect value={examPick} onChange={setExamPick} ariaLabel="Which exam" className="flex-1"
                options={[...EXAM_OPTIONS.map((name) => ({ value: name, label: name })), { value: "custom", label: "Custom…" }]} />
              {examPick === "custom" && (
                <input value={customName} onChange={(event) => setCustomName(event.target.value)} maxLength={60}
                  aria-label="Custom exam name" placeholder="Exam name"
                  className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
              )}
            </div>
            <ThemedDatePicker value={draftDate} min={todayStr} onChange={setDraftDate} />
            <div className="flex items-center gap-2 sm:col-span-2">
              <button onClick={resetDraft} className="flex-1 rounded-full border border-border bg-card py-2.5 text-sm text-muted-foreground transition hover:border-primary/40">Cancel</button>
              <button onClick={save} disabled={saving || !draftDate || draftDate < todayStr || (examPick === "custom" && !customName.trim())}
                className="flex-1 rounded-full gradient-primary px-4 py-2.5 text-sm font-semibold text-white shadow-glow disabled:opacity-40">
                {saving ? "Saving…" : editingId === "new" ? "Add" : "Save"}
              </button>
            </div>
          </div>
          {draftDate && draftDate < todayStr && <p className="mt-1.5 text-xs text-destructive">Pick today or a future date.</p>}
          {message && <p className="mt-1.5 text-xs text-destructive">{message}</p>}
        </Modal>
      )}
      {message && !editingId && <p className="mt-2 text-xs text-destructive">{message}</p>}

      {sorted.length === 0 && editingId !== "new" && <p className="mt-3 text-sm text-muted-foreground">No exams scheduled yet.</p>}
      {sorted.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {sorted.map((exam, index) => {
            const examDay = new Date(`${exam.exam_date}T00:00:00`);
            const days = Math.ceil((examDay.getTime() - today.getTime()) / 86400000);
            return (
              <article key={exam.id} className={`rounded-xl border p-3 ${index === 0 && days >= 0 ? "border-primary/45 bg-primary/5" : "border-border bg-card/60"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{exam.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{examDay.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button onClick={() => startEdit(exam)} aria-label={`Edit ${exam.name}`} className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary"><Pencil size={13} /></button>
                    <button onClick={() => { setDeleteError(null); setDeleteTarget(exam); }} aria-label={`Delete ${exam.name}`} className="grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 size={13} /></button>
                  </div>
                </div>
                <p className="mt-2 text-sm">
                  {days > 0 && <><span className="font-display text-xl font-semibold text-primary">{days}</span> day{days === 1 ? "" : "s"} remaining</>}
                  {days === 0 && <span className="font-semibold text-primary">Today. You've got this!</span>}
                  {days < 0 && <span className="text-muted-foreground">Exam date passed</span>}
                </p>
              </article>
            );
          })}
        </div>
      )}
      {deleteTarget && (
        <Modal label="Delete exam" onClose={() => { if (!deleting) setDeleteTarget(null); }}
          cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-destructive/10 text-destructive"><Trash2 size={20} /></div>
          <h3 className="mt-4 font-display text-xl font-semibold">Delete {deleteTarget.name}?</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">This removes the exam date and countdown from your schedule.</p>
          {deleteError && <p className="mt-2 text-xs text-destructive">{deleteError}</p>}
          <div className="mt-5 flex gap-2">
            <button onClick={() => setDeleteTarget(null)} disabled={deleting}
              className="flex-1 rounded-full border border-border bg-card py-2.5 text-sm text-muted-foreground transition hover:border-primary/40 disabled:opacity-50">
              Cancel
            </button>
            <button onClick={confirmDelete} disabled={deleting}
              className="flex-1 rounded-full bg-destructive py-2.5 text-sm font-semibold text-destructive-foreground transition active:scale-95 disabled:opacity-50">
              {deleting ? "Deleting…" : "Delete exam"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

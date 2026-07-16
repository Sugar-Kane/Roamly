import { useEffect, useRef, useState } from "react";
import { Crown, Plus, X, Check, Timer, ChevronDown, GripVertical, Play, Flame } from "lucide-react";
import { sortTasks, tagColor, type Task } from "../data";
import { loadPref, savePref } from "../storage";
import { InfoTip } from "../FocusMode";
import { ThemedSelect } from "../ThemedSelect";
import { UploadTasksPanel } from "../UploadTasks";
import { PlannedStudyPanel } from "../StudyInsights";
import { SignInPrompt, NumberField } from "../commonUi";
import { TagPill, TaskCategoryModal, TaskEstModal, type DragState } from "../taskModals";
import type { Profile, PlannedStudyUpdate } from "../db";
import type { PlannedStudySession, PlannedStudyDraft } from "../release3";
import type { Session } from "@supabase/supabase-js";

export function TasksView({ tasks, activeTask, addTask, editTask, setTaskTag, setTaskEst, toggleTask, removeTask, reorderTask, onFocusTask, session, onSignIn, tasksLoaded, profile, addImportedTasks, onSubscribe, onBuyCredits, guestLimit, autoCompleteEstimates, onToggleAutoComplete, plannedSessions, onCreatePlan, onUpdatePlan, onDeletePlan }: {
  tasks: Task[];
  activeTask: string | null;
  setActiveTask: (id: string | null) => void;
  addTask: (title: string, tag: string) => void;
  editTask: (id: string, title: string) => void;
  setTaskTag: (id: string, tag: string) => void;
  setTaskEst: (id: string, est: number) => void;
  toggleTask: (id: string) => void;
  removeTask: (id: string) => void;
  reorderTask: (id: string, targetIndex: number) => void;
  onFocusTask: (id: string) => void;
  session: Session | null;
  onSignIn: () => void;
  tasksLoaded: boolean;
  profile: Profile | null;
  addImportedTasks: (rows: Task[]) => void;
  onSubscribe: (choice?: "small" | "large" | "monthly" | "annual") => void;
  onBuyCredits: () => void;
  guestLimit: number;
  autoCompleteEstimates: boolean;
  onToggleAutoComplete: () => void;
  plannedSessions: PlannedStudySession[];
  onCreatePlan: (row: PlannedStudyDraft) => Promise<PlannedStudySession | null>;
  onUpdatePlan: (id: string, fields: PlannedStudyUpdate) => Promise<boolean>;
  onDeletePlan: (id: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState("");
  const [tag, setTag] = useState("");
  const [customTag, setCustomTag] = useState<string | null>(null); // non-null while typing a new subject
  const [showDone, setShowDone] = useState(false);
  const [estTarget, setEstTarget] = useState<Task | null>(null);   // themed sessions picker
  const [tagPickTarget, setTagPickTarget] = useState<Task | null>(null); // themed subject picker

  // --- Inline title editing (click the task name; Enter saves, Esc cancels) ---
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const startEdit = (t: Task) => { setEditingId(t.id); setEditDraft(t.title); };
  const cancelEdit = () => setEditingId(null);
  const commitEdit = () => {
    if (!editingId) return;
    const next = editDraft.trim();
    const current = tasks.find((t: Task) => t.id === editingId);
    // An empty title is never saved — the original is restored instead.
    if (next && current && next !== current.title) editTask(editingId, next);
    setEditingId(null);
  };

  // --- Drag reordering (grip handle, or press-and-hold anywhere on the row) ---
  // Grab the ⋮⋮ handle (instant with a mouse, ~0.1s on touch) or hold the row
  // ~0.3s to lift it, drag to a new spot in its subject group, release to
  // drop. A quick tap or an immediate move (scrolling) never triggers the
  // row-body path, and the arrow buttons remain as the accessible alternative.
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  useEffect(() => { dragRef.current = drag; }, [drag]);
  const press = useRef<{ id: string; group: string; groupIds: string[]; index: number; y: number; el: HTMLDivElement; pointerId: number; timer: number; fromHandle: boolean } | null>(null);
  const rects = useRef<{ id: string; mid: number }[]>([]);
  const justDragged = useRef(false);

  const onRowPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string, group: string, groupIds: string[], index: number) => {
    if ((e.target as HTMLElement).closest("[data-nodrag]")) return;
    if (press.current) return;
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    // The grip handle can't scroll the page (touch-action: none), so it lifts
    // near-instantly — and immediately for a mouse, where press-and-hold is an
    // alien gesture. The row body keeps a hold delay so touch scrolling wins.
    const fromHandle = !!(e.target as HTMLElement).closest("[data-drag-handle]");
    const holdMs = fromHandle ? (e.pointerType === "mouse" ? 0 : 120) : 300;
    const timer = window.setTimeout(() => {
      const p = press.current;
      if (!p) return;
      rects.current = p.groupIds.map((gid) => {
        const r = rowRefs.current.get(gid)?.getBoundingClientRect();
        return { id: gid, mid: r ? r.top + r.height / 2 : 0 };
      });
      try { p.el.setPointerCapture(p.pointerId); } catch { /* pointer already gone */ }
      (navigator as any).vibrate?.(10);
      setDrag({ id: p.id, group: p.group, from: p.index, over: p.index, dy: 0, height: p.el.getBoundingClientRect().height });
    }, holdMs);
    press.current = { id, group, groupIds, index, y: e.clientY, el, pointerId, timer, fromHandle };
  };

  const onRowPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = press.current;
    if (!p) return;
    const d = dragRef.current;
    if (!d) {
      // Moved before the hold completed → it's a scroll, not a drag. Presses
      // that started on the grip handle can't be scrolls, so they never cancel.
      if (!p.fromHandle && Math.abs(e.clientY - p.y) > 12) { clearTimeout(p.timer); press.current = null; }
      return;
    }
    const dy = e.clientY - p.y;
    const center = rects.current[d.from]?.mid + dy;
    let over = d.from, best = Infinity;
    rects.current.forEach((r, i) => {
      const dist = Math.abs(center - r.mid);
      if (dist < best) { best = dist; over = i; }
    });
    setDrag({ ...d, dy, over });
  };

  const onRowPointerUp = () => {
    const p = press.current;
    const d = dragRef.current;
    if (p) clearTimeout(p.timer);
    press.current = null;
    if (d) {
      if (d.over !== d.from) reorderTask(d.id, d.over);
      justDragged.current = true;
      window.setTimeout(() => { justDragged.current = false; }, 80);
      setDrag(null);
    }
  };

  const onRowPointerCancel = () => {
    const p = press.current;
    if (p) clearTimeout(p.timer);
    press.current = null;
    if (dragRef.current) setDrag(null);
  };

  // While a drag is live, stop the page from scrolling under the finger.
  useEffect(() => {
    if (!drag) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", stop, { passive: false });
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("touchmove", stop);
      document.body.style.userSelect = "";
    };
  }, [drag !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const dragStyleFor = (group: string, id: string, index: number): React.CSSProperties | undefined => {
    if (!drag || drag.group !== group) return undefined;
    if (id === drag.id) {
      return { transform: `translateY(${drag.dy}px) scale(1.02)`, zIndex: 20, position: "relative", boxShadow: "0 10px 28px rgba(0,0,0,0.18)", transition: "none" };
    }
    const shift = drag.height + 8; // 8px = space-y-2 gap
    if (index > drag.from && index <= drag.over) return { transform: `translateY(${-shift}px)`, transition: "transform 0.15s ease" };
    if (index < drag.from && index >= drag.over) return { transform: `translateY(${shift}px)`, transition: "transform 0.15s ease" };
    return { transition: "transform 0.15s ease" };
  };

  // No preset subjects: the dropdown offers exactly the subjects the user's
  // own tasks carry. A subject disappears when its last task does.
  const tags: string[] = [...new Set<string>(tasks.map((t: Task) => t.tag))];
  const selectedTag = tags.includes(tag) ? tag : (tags[0] ?? "");
  const noSubjectsYet = tags.length === 0;
  // Free-typed subject input: explicit "＋ New subject…" pick, or forced when
  // there are no subjects at all (very first task).
  const showCustom = customTag !== null || noSubjectsYet;

  const add = () => {
    const chosenTag = showCustom ? (customTag ?? "").trim().slice(0, 24) : selectedTag;
    if (!draft.trim() || !chosenTag || (!session && tasks.length >= guestLimit)) return;
    addTask(draft.trim(), chosenTag);
    setDraft("");
    if (showCustom) { setTag(chosenTag); setCustomTag(null); }
  };

  const sorted = sortTasks(tasks);
  const open = sorted.filter((t: Task) => !t.done);
  const doneTasks = sorted.filter((t: Task) => t.done);
  const groupNames: string[] = [...new Set<string>(open.map((t: Task) => t.tag))];
  // Subject groups themselves can be reordered — drag the header's ⋮⋮ handle
  // (arrow keys work on it too) — and the order persists on this device.
  // Unlisted subjects keep their natural position.
  const [tagOrder, setTagOrder] = useState<string[]>(() => { try { return JSON.parse(loadPref("roamly-tag-order") ?? "[]") as string[]; } catch { return []; } });
  const groupRank = (g: string) => { const i = tagOrder.indexOf(g); return i === -1 ? 1000 + groupNames.indexOf(g) : i; };
  const orderedGroupNames = [...groupNames].sort((a, b) => groupRank(a) - groupRank(b));
  const applyGroupOrder = (next: string[]) => {
    setTagOrder(next);
    savePref("roamly-tag-order", JSON.stringify(next));
  };
  const moveGroup = (g: string, dir: -1 | 1) => {
    const cur = orderedGroupNames.slice();
    const i = cur.indexOf(g); const j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    [cur[i], cur[j]] = [cur[j], cur[i]];
    applyGroupOrder(cur);
  };

  // Collapsed subject sections (click a header to toggle); persists per device.
  const [collapsedTags, setCollapsedTags] = useState<string[]>(() => { try { return JSON.parse(loadPref("roamly-collapsed-tags") ?? "[]") as string[]; } catch { return []; } });
  const toggleCollapsed = (g: string) => setCollapsedTags((prev) => {
    const next = prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g];
    savePref("roamly-collapsed-tags", JSON.stringify(next));
    return next;
  });

  // --- Drag reordering for whole subject sections (via the header handle) ---
  // Same pointer mechanics as task rows: lift, translate with the pointer,
  // find the nearest section midpoint, drop to commit. Dragging never toggles
  // collapse because the handle is a separate control from the header button.
  const groupRefs = useRef(new Map<string, HTMLElement>());
  const [groupDrag, setGroupDrag] = useState<{ g: string; from: number; over: number; dy: number; height: number } | null>(null);
  const groupDragRef = useRef<typeof groupDrag>(null);
  useEffect(() => { groupDragRef.current = groupDrag; }, [groupDrag]);
  const groupPress = useRef<{ g: string; index: number; y: number; el: HTMLElement; pointerId: number; timer: number } | null>(null);
  const groupRects = useRef<{ g: string; mid: number }[]>([]);

  const onGroupHandleDown = (e: React.PointerEvent<HTMLButtonElement>, g: string, index: number) => {
    if (groupPress.current) return;
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    const holdMs = e.pointerType === "mouse" ? 0 : 120;
    const timer = window.setTimeout(() => {
      const p = groupPress.current;
      if (!p) return;
      groupRects.current = orderedGroupNames.map((name) => {
        const r = groupRefs.current.get(name)?.getBoundingClientRect();
        return { g: name, mid: r ? r.top + r.height / 2 : 0 };
      });
      try { p.el.setPointerCapture(p.pointerId); } catch { /* pointer already gone */ }
      (navigator as any).vibrate?.(10);
      const height = groupRefs.current.get(g)?.getBoundingClientRect().height ?? 0;
      setGroupDrag({ g, from: p.index, over: p.index, dy: 0, height });
    }, holdMs);
    groupPress.current = { g, index, y: e.clientY, el, pointerId, timer };
  };

  const onGroupHandleMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const p = groupPress.current;
    const d = groupDragRef.current;
    if (!p || !d) return;
    const dy = e.clientY - p.y;
    const center = groupRects.current[d.from]?.mid + dy;
    let over = d.from, best = Infinity;
    groupRects.current.forEach((r, i) => {
      const dist = Math.abs(center - r.mid);
      if (dist < best) { best = dist; over = i; }
    });
    setGroupDrag({ ...d, dy, over });
  };

  const onGroupHandleUp = () => {
    const p = groupPress.current;
    const d = groupDragRef.current;
    if (p) clearTimeout(p.timer);
    groupPress.current = null;
    if (d) {
      if (d.over !== d.from) {
        const next = orderedGroupNames.slice();
        next.splice(d.from, 1);
        next.splice(d.over, 0, d.g);
        applyGroupOrder(next);
      }
      setGroupDrag(null);
    }
  };

  // While a section drag is live, stop the page from scrolling under the finger.
  useEffect(() => {
    if (!groupDrag) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", stop, { passive: false });
    document.body.style.userSelect = "none";
    return () => {
      document.removeEventListener("touchmove", stop);
      document.body.style.userSelect = "";
    };
  }, [groupDrag !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const groupDragStyle = (g: string, index: number): React.CSSProperties | undefined => {
    if (!groupDrag) return undefined;
    if (g === groupDrag.g) {
      return { transform: `translateY(${groupDrag.dy}px)`, zIndex: 30, position: "relative", boxShadow: "0 12px 32px rgba(0,0,0,0.18)", transition: "none" };
    }
    const shift = groupDrag.height + 24; // 24px = mt-6 between sections
    if (index > groupDrag.from && index <= groupDrag.over) return { transform: `translateY(${-shift}px)`, transition: "transform 0.15s ease" };
    if (index < groupDrag.from && index >= groupDrag.over) return { transform: `translateY(${shift}px)`, transition: "transform 0.15s ease" };
    return { transition: "transform 0.15s ease" };
  };

  return (
    <div className="mx-auto max-w-2xl" data-tour="tasks">
      <h1 className="font-display text-3xl font-semibold">Tasks</h1>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
        Queue what you'll study. Pick one to focus on.
        <InfoTip text="Click a task's name to edit it (Enter saves, Esc cancels). The n/n counter shows focus sessions done vs. planned — tap it to change the plan. Press ▶ to start focusing on a task. Tap a subject header to collapse it, drag ⋮⋮ to reorder tasks or whole subjects, and tap a task's subject badge to move it to another subject." />
      </p>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-card/70 px-3 py-2.5">
        <span className="min-w-0"><span className="block text-sm font-medium">Complete tasks automatically</span><span className="block text-[11px] text-muted-foreground">When on, a task is checked off as soon as it reaches its planned focus-session count.</span></span>
        <button role="switch" aria-label="Complete tasks automatically" aria-checked={autoCompleteEstimates} onClick={onToggleAutoComplete} className={`relative h-6 w-11 shrink-0 rounded-full transition ${autoCompleteEstimates ? "bg-primary" : "bg-border"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${autoCompleteEstimates ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>
      {tasks.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{doneTasks.length} of {tasks.length} done</span>
            {doneTasks.length === tasks.length && <span className="text-roamly-green">All clear 🎉</span>}
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full" style={{ background: "hsl(var(--border))" }}
            role="progressbar" aria-valuemin={0} aria-valuemax={tasks.length}
            aria-valuenow={doneTasks.length} aria-label={`${doneTasks.length} of ${tasks.length} tasks done`}>
            <div className="h-full rounded-full bg-roamly-green" style={{ width: `${tasks.length ? (doneTasks.length / tasks.length) * 100 : 0}%`, transition: "width 0.4s ease" }} />
          </div>
        </div>
      )}
      {!session && (
        <div className="mt-4">
          <>
            <SignInPrompt onSignIn={onSignIn} message={`Guest tasks stay on this device (${tasks.length}/${guestLimit}). Sign in to sync across devices.`} />
            <p className="mt-2 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
              <Crown size={12} className="mr-1 inline text-primary" />
              Signed-in users can also generate tasks with AI: upload lecture notes, slides, or
              even photos of handwritten pages and Roamly turns them into a task list (3 uploads/month free, 10 with Premium).
            </p>
          </>
        </div>
      )}
      {session && (
        <div className="mt-4">
          <UploadTasksPanel profile={profile} session={session} onImported={addImportedTasks} onUpgrade={onSubscribe} onBuyCredits={onBuyCredits} />
        </div>
      )}
      {/* On phones the task input takes the full row and the subject + add
          button drop to a second line; side-by-side from sm up. */}
      <div className="mt-6 flex flex-wrap gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Add a study task…"
          className="w-full min-w-0 rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 sm:w-auto sm:flex-1" />
        {showCustom ? (
          <span className="flex items-center gap-1">
            <input value={customTag ?? ""} onChange={(e) => setCustomTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder={noSubjectsYet ? "Subject, e.g. Pharm" : "New subject"} maxLength={24} autoFocus={customTag !== null} aria-label="New subject name"
              className="w-32 rounded-xl border border-primary bg-card px-3 py-3 text-sm outline-none ring-2 ring-primary/20" />
            {!noSubjectsYet && (
              <button onClick={() => setCustomTag(null)} aria-label="Cancel new subject"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:text-foreground">
                <X size={15} />
              </button>
            )}
          </span>
        ) : (
          <ThemedSelect value={selectedTag} ariaLabel="Subject" className="w-40 min-w-0 flex-1 sm:flex-none"
            onChange={(v) => (v === "__new__" ? setCustomTag("") : setTag(v))}
            options={[
              ...tags.map((t) => ({ value: t, label: t, accent: tagColor(t) })),
              { value: "__new__", label: "＋ New subject…" },
            ]} />
        )}
        <button onClick={add} disabled={!session && tasks.length >= guestLimit} aria-label="Add task" className="grid w-12 shrink-0 place-items-center rounded-xl gradient-primary text-white shadow-glow transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={20} /></button>
      </div>
      {!session && tasks.length >= guestLimit && <p role="status" className="mt-2 text-sm text-muted-foreground">You reached the 5-task guest limit. Sign in to create and sync more tasks.</p>}
      <PlannedStudyPanel tasks={tasks} plans={plannedSessions} userId={session?.user.id ?? null}
        isPremium={session ? (profile ? !!profile.is_premium : null) : false}
        onSignIn={onSignIn} onUpgrade={onBuyCredits}
        onCreatePlan={onCreatePlan} onUpdatePlan={onUpdatePlan} onDeletePlan={onDeletePlan} />

      {session && !tasksLoaded && (
        <p className="mt-6 rounded-2xl border border-dashed border-border bg-card/60 p-4 text-center text-sm text-muted-foreground">
          Loading your tasks…
        </p>
      )}

      {tasksLoaded && open.length === 0 && tasks.length > 0 && (
        <p className="mt-6 rounded-2xl border border-dashed border-border bg-card/60 p-4 text-center text-sm text-muted-foreground">
          Everything's done. Add your next study task above.
        </p>
      )}

      {(!session || tasksLoaded) && orderedGroupNames.map((g, gi) => {
        const groupTasks = open.filter((t: Task) => t.tag === g);
        const groupIds = groupTasks.map((t: Task) => t.id);
        const c = tagColor(g);
        const collapsed = collapsedTags.includes(g);
        const beingGroupDragged = groupDrag?.g === g;
        return (
          <section key={g} className={`mt-6 ${beingGroupDragged ? "rounded-2xl bg-card/95 p-2 ring-2 ring-primary/50" : ""}`}
            ref={(el) => { if (el) groupRefs.current.set(g, el); else groupRefs.current.delete(g); }}
            style={groupDragStyle(g, gi)}>
            <div className="flex items-center gap-1">
              <button data-group-handle onPointerDown={(e) => onGroupHandleDown(e, g, gi)} onPointerMove={onGroupHandleMove}
                onPointerUp={onGroupHandleUp} onPointerCancel={onGroupHandleUp}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp") { e.preventDefault(); moveGroup(g, -1); }
                  if (e.key === "ArrowDown") { e.preventDefault(); moveGroup(g, 1); }
                }}
                onContextMenu={(e) => e.preventDefault()}
                aria-label={`Reorder subject ${g}. Drag, or press the up and down arrow keys.`}
                className="grid h-8 w-6 shrink-0 cursor-grab place-items-center rounded-md text-muted-foreground/60 transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 active:cursor-grabbing"
                style={{ touchAction: "none", WebkitTouchCallout: "none" }}>
                <GripVertical size={14} />
              </button>
              <button onClick={() => toggleCollapsed(g)} aria-expanded={!collapsed}
                aria-label={`${collapsed ? "Expand" : "Collapse"} subject ${g} (${groupTasks.length} task${groupTasks.length === 1 ? "" : "s"})`}
                className="flex min-h-[2.5rem] min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-1.5 py-1 text-left transition hover:bg-primary/5">
                <span className="flex min-w-0 items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: c }} />
                  <span className="min-w-0 truncate">{g}</span> · {groupTasks.length}
                </span>
                <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${collapsed ? "-rotate-90" : ""}`} />
              </button>
            </div>
            {!collapsed && (
            <div className="mt-2 space-y-2">
              {groupTasks.map((t: Task, i: number) => {
                const active = activeTask === t.id;
                const beingDragged = drag?.id === t.id;
                return (
                  <div key={t.id}
                    ref={(el) => { if (el) rowRefs.current.set(t.id, el); else rowRefs.current.delete(t.id); }}
                    onPointerDown={(e) => onRowPointerDown(e, t.id, g, groupIds, i)}
                    onPointerMove={onRowPointerMove}
                    onPointerUp={onRowPointerUp}
                    onPointerCancel={onRowPointerCancel}
                    onContextMenu={(e) => { if (press.current || dragRef.current) e.preventDefault(); }}
                    style={{ WebkitTouchCallout: "none", touchAction: "pan-y", ...dragStyleFor(g, t.id, i) }}
                    className={`select-none rounded-xl border p-3 transition ${beingDragged ? "border-primary bg-card" : active ? "border-primary bg-primary/5" : "border-border bg-card/70"}`}>
                    {/* Phones: checkbox + title on the first line, the control
                        cluster on its own right-aligned line below (titles were
                        wrapping 3 lines against 6 inline controls). Inline
                        again from sm up. */}
                    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
                      <button data-drag-handle onContextMenu={(e) => e.preventDefault()}
                        onKeyDown={(e) => {
                          if (e.key === "ArrowUp") { e.preventDefault(); reorderTask(t.id, i - 1); }
                          if (e.key === "ArrowDown") { e.preventDefault(); reorderTask(t.id, i + 1); }
                        }}
                        aria-label={`Reorder task ${t.title}. Drag, or press the up and down arrow keys.`}
                        className="-ml-1 -mr-2 mt-0.5 grid h-6 w-5 shrink-0 cursor-grab place-items-center rounded-md text-muted-foreground/50 transition hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 active:cursor-grabbing"
                        style={{ touchAction: "none" }}>
                        <GripVertical size={14} />
                      </button>
                      <button data-nodrag onClick={() => toggleTask(t.id)} aria-label={`Mark ${t.title} done`}
                        className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border border-muted-foreground/40 transition hover:border-primary" />
                      {editingId === t.id ? (
                        <span data-nodrag className="min-w-0 flex-1 basis-52">
                          <input autoFocus value={editDraft} onChange={(e) => setEditDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") cancelEdit(); }}
                            onBlur={commitEdit} aria-label={`Edit task title, currently ${t.title}`}
                            className="w-full rounded-lg border border-primary bg-card px-2 py-1 text-sm outline-none ring-2 ring-primary/20" />
                          <span className="mt-1 block text-[10px] text-muted-foreground">Enter saves · Esc cancels · empty titles aren't saved</span>
                        </span>
                      ) : (
                        <button onClick={() => { if (!justDragged.current) startEdit(t); }} className="min-w-0 flex-1 basis-52 rounded-lg text-left transition hover:bg-primary/5"
                          aria-label={`${t.title} — edit task title`} title="Click to edit">
                          <span className="block min-w-0 break-words text-sm leading-snug">{t.title}</span>
                          {active && (
                            <span className="mt-1 flex items-center gap-2">
                              <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                                <Timer size={10} /> Focusing
                              </span>
                            </span>
                          )}
                        </button>
                      )}
                      <button data-nodrag onClick={() => setTagPickTarget(t)} aria-label={`Change subject for ${t.title}, currently ${t.tag}`}
                        title="Click to move this task to another subject"
                        className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold transition hover:ring-2 hover:ring-primary/30"
                        style={{ background: `${tagColor(t.tag)}1f`, color: tagColor(t.tag) }}>
                        {t.tag}
                      </button>
                      <div data-nodrag className="ml-auto flex shrink-0 items-center gap-0.5">
                        {!active && (
                          <button onClick={() => onFocusTask(t.id)} aria-label={`Focus on ${t.title}`}
                            className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition hover:bg-primary/10 hover:text-primary">
                            <Play size={13} />
                          </button>
                        )}
                        <button data-nodrag onClick={() => setEstTarget(t)} title="Focus sessions done / planned. Click to change"
                          className="rounded-md px-1.5 py-0.5 text-center font-mono text-xs text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                          aria-label={`${t.poms} of ${t.est} focus sessions done for ${t.title}. Change estimate`}>
                          {t.poms}/{t.est}
                        </button>
                        <button onClick={() => removeTask(t.id)} aria-label={`Delete ${t.title}`}
                          className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition hover:text-destructive">
                          <X size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </section>
        );
      })}

      {doneTasks.length > 0 && (
        <section className="mt-8">
          <button onClick={() => setShowDone((s) => !s)}
            className="flex w-full items-center justify-between rounded-xl border border-border bg-card/60 px-3 py-2.5 text-left text-sm text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
            <span className="flex items-center gap-2"><Check size={14} className="text-roamly-green" /> Completed · {doneTasks.length}</span>
            <ChevronDown size={15} className={`transition-transform ${showDone ? "rotate-180" : ""}`} />
          </button>
          {showDone && (
            <div className="mt-2 space-y-2">
              {doneTasks.map((t: Task) => (
                <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/50 p-3">
                  <button onClick={() => toggleTask(t.id)} aria-label={`Mark ${t.title} not done`}
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-roamly-green bg-roamly-green transition hover:opacity-80">
                    <Check size={14} className="text-white" />
                  </button>
                  <span className="min-w-0 flex-1 break-words text-sm text-muted-foreground line-through">{t.title}</span>
                  <TagPill tag={t.tag} />
                  <button onClick={() => removeTask(t.id)} aria-label={`Delete ${t.title}`}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:text-destructive">
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tagPickTarget && <TaskCategoryModal task={tagPickTarget} tags={tags} onPick={(next: string) => setTaskTag(tagPickTarget.id, next)} onClose={() => setTagPickTarget(null)} />}
      {estTarget && <TaskEstModal task={estTarget} onPick={(n: number) => setTaskEst(estTarget.id, n)} onClose={() => setEstTarget(null)} />}
    </div>
  );
}

export function DailyGoalCard({ streak, todayMinutes, dailyGoal, setDailyGoal }: {
  streak: number; todayMinutes: number; dailyGoal: number; setDailyGoal: (minutes: number) => void;
}) {
  const pct = Math.min(100, Math.round((todayMinutes / dailyGoal) * 100));
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">Your progress
          <InfoTip text="Minutes count when a focus block finishes. Hit your daily goal to fill the bar, and focus at least once a day to keep your streak flame alive." />
        </h2>
        {streak > 0 && (
          <span className="flex items-center gap-1 text-xs text-primary"><Flame size={13} /> {streak}-day streak</span>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Today</span>
        <span className="font-mono">{todayMinutes} / {dailyGoal} min</span>
      </div>
      <div className="mt-2 h-3 w-full overflow-hidden rounded-full" style={{ background: "hsl(var(--border))" }}
        role="progressbar" aria-valuemin={0} aria-valuemax={dailyGoal}
        aria-valuenow={Math.min(todayMinutes, dailyGoal)} aria-label={`Daily goal: ${todayMinutes} of ${dailyGoal} minutes`}>
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%`, transition: "width 0.4s ease" }} />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-sm text-muted-foreground">Daily goal</span>
        <NumberField value={dailyGoal} unit="min" min={5} max={600} label="Daily goal" onChange={setDailyGoal} />
      </div>
    </div>
  );
}

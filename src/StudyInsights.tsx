import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarPlus, Check, ChevronLeft, ChevronRight, Clock3, Crown, ExternalLink, Lock, LogIn, Pencil, Trash2, Users, X } from "lucide-react";
import type { Task } from "./data";
import type { FocusSession } from "./streaks";
import { MISSED_REASONS, type MissedReason, type PlannedStudyDraft, type PlannedStudyInvite, type PlannedStudySession, type PlannedStudyTarget, type StudyEvent } from "./release3";
import { fetchFriendships, fetchIncomingPlannedStudyInvites, getPublicProfiles, inviteFriendsToPlannedStudy, respondPlannedStudyInvite, type PublicProfile } from "./rooms";
import { SearchableSelect, ThemedSelect } from "./ThemedSelect";
import { tagColor } from "./data";

type Range = "day" | "week" | "month" | "all";
const RANGE_LABEL: Record<Range, string> = { day: "Day", week: "Week", month: "Month", all: "All time" };

function cutoff(range: Range): number {
  if (range === "all") return 0;
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (range === "week") d.setDate(d.getDate() - 6);
  if (range === "month") d.setDate(d.getDate() - 29);
  return d.getTime();
}

const duration = (min: number) => min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
const longDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (remainder || !hours) parts.push(`${remainder} minute${remainder === 1 ? "" : "s"}`);
  return parts.join(" ");
};

export function StudyInsights({ events, daily, plans }: { events: StudyEvent[]; daily: FocusSession[]; plans: PlannedStudySession[] }) {
  const [range, setRange] = useState<Range>("week");
  const filtered = useMemo(() => events.filter((e) => new Date(e.completed_at).getTime() >= cutoff(range)), [events, range]);
  const detailedMinutes = filtered.reduce((sum, e) => sum + e.minutes, 0);
  const aggregateMinutes = daily.filter((row) => {
    if (range === "all") return true;
    return new Date(`${row.date}T00:00:00`).getTime() >= cutoff(range);
  }).reduce((sum, row) => sum + row.minutes, 0);
  const legacyMinutes = Math.max(0, aggregateMinutes - detailedMinutes);

  const summarize = (key: "category" | "task_title") => {
    const map = new Map<string, { minutes: number; sessions: number }>();
    for (const event of filtered) {
      const name = event[key] || "Uncategorized";
      const value = map.get(name) ?? { minutes: 0, sessions: 0 };
      map.set(name, { minutes: value.minutes + event.minutes, sessions: value.sessions + 1 });
    }
    if (key === "category" && legacyMinutes > 0) {
      const value = map.get("Uncategorized") ?? { minutes: 0, sessions: 0 };
      map.set("Uncategorized", { minutes: value.minutes + legacyMinutes, sessions: value.sessions });
    }
    return [...map.entries()].sort((a, b) => b[1].minutes - a[1].minutes).slice(0, 8);
  };
  const categories = summarize("category");
  const taskRows = summarize("task_title");
  const total = aggregateMinutes;
  const sessionCount = filtered.length;
  const average = sessionCount ? Math.round(detailedMinutes / sessionCount) : 0;
  const trendGroups = useMemo(() => {
    const rows = daily.map((row) => ({ ...row, dateObj: new Date(`${row.date}T12:00:00`) })).sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());
    const dailyRows = rows.slice(-7).map((r) => ({ label: r.dateObj.toLocaleDateString(undefined, { weekday: "short" }), minutes: r.minutes }));
    const group = (mode: "week" | "month", count: number) => {
      const map = new Map<string, { label: string; minutes: number; time: number }>();
      for (const row of rows) {
        const d = new Date(row.dateObj);
        if (mode === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const key = mode === "week" ? d.toISOString().slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const label = mode === "week" ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : d.toLocaleDateString(undefined, { month: "short" });
        const value = map.get(key) ?? { label, minutes: 0, time: d.getTime() };
        value.minutes += row.minutes; map.set(key, value);
      }
      return [...map.values()].sort((a, b) => a.time - b.time).slice(-count);
    };
    return { daily: dailyRows, weekly: group("week", 6), monthly: group("month", 6) };
  }, [daily]);

  return <div className="mt-6 space-y-6">
    <section className="rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-sm font-semibold">Study breakdown</h2><p className="mt-0.5 text-xs text-muted-foreground">Task and category detail is recorded from Release 3 onward; older time stays Uncategorized.</p></div>
        <div className="flex rounded-full border border-border bg-card p-1">{(Object.keys(RANGE_LABEL) as Range[]).map((r) => <button key={r} onClick={() => setRange(r)} aria-pressed={range === r} className={`rounded-full px-3 py-1 text-xs ${range === r ? "bg-primary text-white" : "text-muted-foreground"}`}>{RANGE_LABEL[r]}</button>)}</div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3"><Metric label="Focus time" value={duration(total)} /><Metric label="Sessions" value={String(sessionCount)} /><Metric label="Average" value={average ? duration(average) : "-"} /></div>
      <div className="mt-5 grid gap-5 md:grid-cols-2"><Breakdown title="Study time by category" rows={categories} categorySummary /><Breakdown title="Study time by task" rows={taskRows} /></div>
      <div className="mt-5 grid gap-4 md:grid-cols-3"><Trend title="Daily trend" rows={trendGroups.daily} /><Trend title="Weekly trend" rows={trendGroups.weekly} /><Trend title="Monthly trend" rows={trendGroups.monthly} /></div>
    </section>

    <StudyPostMortem plans={plans} range={range} />
  </div>;
}

const REASON_GUIDANCE: Record<MissedReason, string> = {
  Traveling: "This reflects a change in circumstances, not a lack of commitment. Plan a lighter travel option next time.",
  Sick: "Recovery is productive too. Give yourself room to rest before scheduling the next session.",
  "Too vague": "Make the next plan smaller and specific, such as one chapter, problem set, or task.",
  "Bad timing": "Try moving similar sessions to a time when your energy and schedule are more reliable.",
  "Too tired": "Try a shorter block or schedule it earlier in the day.",
  "Schedule conflict": "Protect a different time window or leave a buffer around the next session.",
  Forgot: "Add the event to your calendar and use a reminder before the session starts.",
  "Lost motivation": "Shrink the first step until it feels easy to begin, then build momentum from there.",
  "Too difficult": "Split the work into a smaller first step or plan support before starting.",
  Other: "Review what happened and adjust one part of the next plan.",
};

function StudyPostMortem({ plans, range }: { plans: PlannedStudySession[]; range: Range }) {
  const analysis = useMemo(() => {
    const rangeCutoff = cutoff(range);
    const outcomes = plans.filter((plan) => {
      const scheduled = new Date(plan.scheduled_for).getTime();
      return scheduled >= rangeCutoff && (plan.status === "completed" || plan.status === "missed");
    });
    const completed = outcomes.filter((plan) => plan.status === "completed").length;
    const missed = outcomes.filter((plan) => plan.status === "missed");
    const tagged = missed.filter((plan) => plan.missed_reason);
    const reasons = new Map<MissedReason, number>();
    const categories = new Map<string, number>();
    for (const plan of tagged) {
      const reason = plan.missed_reason!;
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      categories.set(plan.category || "Uncategorized", (categories.get(plan.category || "Uncategorized") ?? 0) + 1);
    }
    return {
      completed,
      missed: missed.length,
      tagged: tagged.length,
      completionRate: outcomes.length ? Math.round((completed / outcomes.length) * 100) : null,
      reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
      categories: [...categories.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    };
  }, [plans, range]);
  const topReason = analysis.reasons[0];
  const maxReasonCount = Math.max(1, ...analysis.reasons.map(([, count]) => count));

  return <section className="rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
    <div>
      <h2 className="text-sm font-semibold">Study post-mortem</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Skipped sessions are feedback, not failure. Tag what got in the way and Roamly Flow will turn it into patterns you can use.</p>
    </div>
    <div className="mt-4 grid grid-cols-3 gap-3">
      <Metric label="Follow-through" value={analysis.completionRate === null ? "-" : `${analysis.completionRate}%`} />
      <Metric label="Completed plans" value={String(analysis.completed)} />
      <Metric label="Tagged misses" value={String(analysis.tagged)} />
    </div>
    {topReason ? (
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <h3 className="text-xs font-semibold">What gets in the way</h3>
          <div className="mt-2 space-y-2">
            {analysis.reasons.map(([reason, count]) => (
              <div key={reason}>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span>{reason}</span>
                  <span className="font-mono text-muted-foreground">{count} · {Math.round((count / analysis.tagged) * 100)}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-primary" style={{ width: `${(count / maxReasonCount) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-xs font-semibold">Pattern to try next</h3>
          <div className="mt-2 rounded-xl bg-secondary p-3">
            <p className="text-xs font-semibold text-foreground">Most common blocker: {topReason[0]}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{REASON_GUIDANCE[topReason[0]]}</p>
          </div>
          {analysis.categories.length > 0 && <div className="mt-3">
            <p className="text-[11px] font-medium text-muted-foreground">Tagged misses by category</p>
            <p className="mt-1 break-words text-xs text-foreground">{analysis.categories.map(([category, count]) => `${category} (${count})`).join(" · ")}</p>
          </div>}
        </div>
      </div>
    ) : (
      <div className="mt-4 rounded-xl bg-secondary p-3">
        <p className="text-xs font-medium">No post-mortem pattern yet</p>
        <p className="mt-1 text-xs text-muted-foreground">When a planned session is missed, tag why. After the first tag, your reason and a practical next step will appear here.</p>
      </div>
    )}
    {analysis.missed > analysis.tagged && <p className="mt-3 text-[11px] text-muted-foreground">{analysis.missed - analysis.tagged} missed session{analysis.missed - analysis.tagged === 1 ? " has" : "s have"} no reason yet. Tagging it will make these patterns more useful.</p>}
  </section>;
}

function calendarDetails(plan: PlannedStudySession) {
  const start = new Date(plan.scheduled_for);
  const end = new Date(start.getTime() + plan.expected_minutes * 60_000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const taskList = plan.included_task_titles?.length ? `\nTasks: ${plan.included_task_titles.join(", ")}` : "";
  return {
    title: plan.task_title || `Study: ${plan.category}`,
    description: `Planned in Roamly Flow · ${plan.expected_minutes} minutes${taskList}`,
    start,
    end,
    dates: `${stamp(start)}/${stamp(end)}`,
  };
}

function addToCalendar(plan: PlannedStudySession, provider: "google" | "outlook" | "apple") {
  const event = calendarDetails(plan);
  if (provider === "google") {
    window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${event.dates}&details=${encodeURIComponent(event.description)}`, "_blank", "noopener,noreferrer");
    return;
  }
  if (provider === "outlook") {
    window.open(`https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(event.title)}&startdt=${encodeURIComponent(event.start.toISOString())}&enddt=${encodeURIComponent(event.end.toISOString())}&body=${encodeURIComponent(event.description)}`, "_blank", "noopener,noreferrer");
    return;
  }
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Roamly Flow//Planned Study//EN", "BEGIN:VEVENT", `UID:${plan.id}@roamlyflow.com`, `DTSTART:${event.dates.split("/")[0]}`, `DTEND:${event.dates.split("/")[1]}`, `SUMMARY:${event.title.replace(/[\\,;]/g, "\\$&")}`, `DESCRIPTION:${event.description.replace(/\n/g, "\\n").replace(/[\\,;]/g, "\\$&")}`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "roamly-study.ics";
  link.click();
  URL.revokeObjectURL(url);
}

function toDateTimeLocal(iso: string): string {
  const d = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}


function parseDateTimeLocal(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]), hour: Number(match[4]), minute: Number(match[5]) };
}

function localDateTimeValue(year: number, month: number, day: number, hour: number, minute: number) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return [year, "-", pad(month + 1), "-", pad(day), "T", pad(hour), ":", pad(minute)].join("");
}

function ThemedDateTimePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = parseDateTimeLocal(value);
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
    const nextSelected = parseDateTimeLocal(value);
    if (nextSelected) setVisibleMonth(new Date(nextSelected.year, nextSelected.month, 1));
  }, [value]);

  const commitDate = (day: number) => {
    const base = selected ?? { hour: Math.min(23, today.getHours() + 1), minute: 0 };
    onChange(localDateTimeValue(visibleMonth.getFullYear(), visibleMonth.getMonth(), day, base.hour, base.minute));
    setOpen(false);
  };
  const commitTime = (hour: number, minute: number) => {
    const base = selected ?? { year: today.getFullYear(), month: today.getMonth(), day: today.getDate() };
    const wholeHour = Number.isFinite(hour) ? Math.trunc(hour) : 0;
    const wholeMinute = Number.isFinite(minute) ? Math.trunc(minute) : 0;
    onChange(localDateTimeValue(base.year, base.month, base.day, Math.max(0, Math.min(23, wholeHour)), Math.max(0, Math.min(59, wholeMinute))));
  };

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const leading = new Date(year, month, 1).getDay();
  const dayCount = new Date(year, month + 1, 0).getDate();
  const hour24 = selected?.hour ?? Math.min(23, today.getHours() + 1);
  const hour12 = hour24 % 12 || 12;
  const minute = selected?.minute ?? 0;
  const isPm = hour24 >= 12;
  const display = selected
    ? new Date(selected.year, selected.month, selected.day, selected.hour, selected.minute).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Choose a date and time";

  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen((current) => !current)} aria-haspopup="dialog" aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card px-3 py-2 text-left text-sm text-foreground transition hover:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30">
        <span className={selected ? "" : "text-muted-foreground"}>{display}</span>
        <CalendarPlus size={16} className="shrink-0 text-primary" />
      </button>
      {open && (
        <div role="dialog" aria-label="Choose planned study date and time"
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
              const chosen = selected?.year === year && selected.month === month && selected.day === day;
              const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
              return <button key={day} type="button" onClick={() => commitDate(day)} aria-pressed={chosen}
                className={`grid h-9 place-items-center rounded-xl text-sm transition ${chosen ? "gradient-primary font-semibold text-white shadow-glow" : isToday ? "border border-primary/50 bg-primary/10 font-semibold text-primary" : "hover:bg-primary/10 hover:text-primary"}`}>
                {day}
              </button>;
            })}
          </div>
          <div className="mt-4 rounded-xl border border-border bg-background/40 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Clock3 size={13} /> Time</div>
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={12} value={hour12} aria-label="Hour"
                onChange={(event) => {
                  const typedHour = Number(event.target.value);
                  const next12 = Number.isFinite(typedHour) ? Math.max(1, Math.min(12, Math.trunc(typedHour))) : 1;
                  commitTime((next12 % 12) + (isPm ? 12 : 0), minute);
                }}
                className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-2 text-center text-sm outline-none focus:border-primary" />
              <span className="font-semibold text-muted-foreground">:</span>
              <input type="number" min={0} max={59} value={String(minute).padStart(2, "0")} aria-label="Minute"
                onChange={(event) => commitTime(hour24, Number(event.target.value))}
                className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2 py-2 text-center text-sm outline-none focus:border-primary" />
              <button type="button" onClick={() => commitTime(isPm ? hour24 - 12 : hour24 + 12, minute)}
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-primary transition hover:border-primary/50">
                {isPm ? "PM" : "AM"}
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="flex gap-1">
              <button type="button" onClick={() => {
                setVisibleMonth(new Date(today.getFullYear(), today.getMonth(), 1));
                onChange(localDateTimeValue(today.getFullYear(), today.getMonth(), today.getDate(), hour24, minute));
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

function personName(person: PublicProfile | undefined): string {
  return person?.display_name || person?.username || "Roamly Flow friend";
}

type PlanUpdate = Partial<PlannedStudyDraft> & {
  status?: PlannedStudySession["status"];
  missed_reason?: MissedReason | null;
};

export function PlannedStudyPanel({ tasks, plans, userId, isPremium, onSignIn, onUpgrade, onCreatePlan, onUpdatePlan, onDeletePlan, bare = false }: {
  tasks: Task[];
  plans: PlannedStudySession[];
  userId: string | null;
  isPremium: boolean | null;
  onSignIn: () => void;
  onUpgrade: () => void;
  onCreatePlan: (row: PlannedStudyDraft) => Promise<PlannedStudySession | null>;
  onUpdatePlan: (id: string, fields: PlanUpdate) => Promise<boolean>;
  onDeletePlan: (id: string) => Promise<boolean>;
  // When true, drop the standalone card chrome (border/margin/padding) so the
  // panel can nest inside another disclosure — e.g. under Task preferences.
  bare?: boolean;
}) {
  const [when, setWhen] = useState("");
  const [targetType, setTargetType] = useState<PlannedStudyTarget>("task");
  const [taskId, setTaskId] = useState("");
  const [category, setCategory] = useState("");
  const [includeAllTasks, setIncludeAllTasks] = useState(true);
  const [minutes, setMinutes] = useState(25);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [selectedFriendIds, setSelectedFriendIds] = useState<string[]>([]);
  const [friends, setFriends] = useState<PublicProfile[]>([]);
  const [incomingInvites, setIncomingInvites] = useState<PlannedStudyInvite[]>([]);
  const [inviteActors, setInviteActors] = useState<Map<string, PublicProfile>>(new Map());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const openTasks = useMemo(() => tasks.filter((task) => !task.done), [tasks]);
  const categories = useMemo(() => [...new Set(openTasks.map((task) => task.tag))], [openTasks]);
  const effectiveTaskId = openTasks.some((task) => task.id === taskId) ? taskId : (openTasks[0]?.id ?? "");
  const effectiveCategory = categories.includes(category) ? category : (categories[0] ?? "");
  const categoryTasks = useMemo(
    () => openTasks.filter((task) => task.tag === effectiveCategory),
    [openTasks, effectiveCategory],
  );

  useEffect(() => {
    if (!userId || isPremium !== true) {
      setFriends([]);
      setIncomingInvites([]);
      setInviteActors(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const [friendships, invitations] = await Promise.all([
        fetchFriendships(),
        fetchIncomingPlannedStudyInvites(userId),
      ]);
      if (cancelled) return;
      const friendIds = friendships
        .filter((friendship) => friendship.status === "accepted")
        .map((friendship) => friendship.requester === userId ? friendship.addressee : friendship.requester);
      const actorIds = invitations.map((invitation) => invitation.inviter_id);
      const profiles = await getPublicProfiles([...new Set([...friendIds, ...actorIds])]);
      if (cancelled) return;
      setFriends(friendIds.map((id) => profiles.get(id)).filter((profile): profile is PublicProfile => !!profile));
      setIncomingInvites(invitations);
      setInviteActors(profiles);
    })();
    return () => { cancelled = true; };
  }, [userId, isPremium]);

  const planned = plans
    .filter((plan) => plan.status === "planned")
    .sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
  const overdue = planned.filter((plan) => !dismissed.includes(plan.id) && new Date(plan.scheduled_for).getTime() + plan.expected_minutes * 60_000 < Date.now());
  const missed = plans.filter((plan) => plan.status === "missed" && plan.missed_reason);
  const reasonCounts = new Map<string, number>();
  for (const plan of missed) reasonCounts.set(plan.missed_reason!, (reasonCounts.get(plan.missed_reason!) ?? 0) + 1);
  const commonReason = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  const resetForm = () => {
    setWhen("");
    setEditingId(null);
    setSelectedFriendIds([]);
    setMessage(null);
  };

  const buildDraft = (): PlannedStudyDraft | null => {
    if (!when) return null;
    if (targetType === "task") {
      const task = openTasks.find((row) => row.id === effectiveTaskId);
      if (!task) return null;
      return {
        task_id: task.id,
        task_title: task.title,
        category: task.tag,
        target_type: "task",
        include_all_category_tasks: false,
        included_task_ids: [task.id],
        included_task_titles: [task.title],
        scheduled_for: new Date(when).toISOString(),
        expected_minutes: minutes,
      };
    }
    if (!effectiveCategory) return null;
    const attached = includeAllTasks ? categoryTasks : [];
    return {
      task_id: null,
      task_title: null,
      category: effectiveCategory,
      target_type: "category",
      include_all_category_tasks: includeAllTasks,
      included_task_ids: attached.map((task) => task.id),
      included_task_titles: attached.map((task) => task.title),
      scheduled_for: new Date(when).toISOString(),
      expected_minutes: minutes,
    };
  };

  const save = async () => {
    const draft = buildDraft();
    if (!draft || !userId) return;
    setSaving(true);
    setMessage(null);
    if (editingId) {
      const updated = await onUpdatePlan(editingId, draft);
      setSaving(false);
      if (updated) resetForm();
      else setMessage("Couldn't update that event. Try again.");
      return;
    }
    const created = await onCreatePlan(draft);
    if (!created) {
      setSaving(false);
      setMessage("Couldn't save that event. Try again.");
      return;
    }
    const inviteError = await inviteFriendsToPlannedStudy(created.id, userId, selectedFriendIds);
    setSaving(false);
    setWhen("");
    setSelectedFriendIds([]);
    setMessage(inviteError ?? (selectedFriendIds.length ? "Event planned and invitations sent." : "Event planned."));
  };

  const beginEdit = (plan: PlannedStudySession) => {
    setEditingId(plan.id);
    setWhen(toDateTimeLocal(plan.scheduled_for));
    setMinutes(plan.expected_minutes);
    setTargetType(plan.target_type ?? (plan.task_id ? "task" : "category"));
    setTaskId(plan.task_id ?? "");
    setCategory(plan.category);
    setIncludeAllTasks(plan.include_all_category_tasks ?? false);
    setSelectedFriendIds([]);
    setMessage("Editing this event. Existing friend invitations stay attached.");
  };

  const remove = async (id: string) => {
    if (await onDeletePlan(id)) {
      setDeleteConfirmId(null);
      if (editingId === id) resetForm();
    } else {
      setMessage("Couldn't delete that event. Try again.");
    }
  };

  const respondToInvite = async (id: string, status: "accepted" | "declined") => {
    if (!await respondPlannedStudyInvite(id, status)) return;
    setIncomingInvites((current) => status === "declined"
      ? current.filter((invitation) => invitation.id !== id)
      : current.map((invitation) => invitation.id === id ? { ...invitation, status } : invitation));
  };

  if (!userId) {
    return <section className={bare ? "" : "mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm"}>
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-primary"><Lock size={15} /></span>
        <div>
          <h2 className="text-sm font-semibold">Planned study</h2>
          <p className="text-[11px] font-medium text-primary">Account required</p>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Sign in to plan study days, attach tasks or full categories, invite friends, and sync events across devices and calendars.</p>
      <button onClick={onSignIn} className="mt-3 flex items-center gap-1.5 rounded-full gradient-primary px-4 py-2 text-xs font-semibold text-white shadow-glow">
        <LogIn size={13} /> Sign in to plan
      </button>
    </section>;
  }

  if (isPremium === null) {
    return <section aria-label="Loading planned study" className={bare ? "animate-pulse" : "mt-6 animate-pulse rounded-2xl border border-border bg-card/80 p-5 shadow-sm"}>
      <div className="h-4 w-32 rounded-full bg-border/60" />
      <div className="mt-3 h-3 w-3/4 rounded-full bg-border/40" />
    </section>;
  }

  if (!isPremium) {
    return <section className={bare ? "" : "mt-6 rounded-2xl border border-primary/30 bg-card/80 p-5 shadow-sm"}>
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-primary"><Crown size={15} /></span>
        <div>
          <h2 className="text-sm font-semibold">Planned study</h2>
          <p className="text-[11px] font-medium text-primary">Premium feature</p>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Upgrade to schedule study days, attach tasks or full categories, invite friends, and sync events across devices and calendars.</p>
      <button onClick={onUpgrade} className="mt-3 flex items-center gap-1.5 rounded-full gradient-primary px-4 py-2 text-xs font-semibold text-white shadow-glow">
        <Crown size={13} /> Unlock with Premium
      </button>
    </section>;
  }

  const canSave = !!when && (targetType === "task" ? !!effectiveTaskId : !!effectiveCategory);

  return <section className={bare ? "" : "mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm"}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><CalendarPlus size={15} className="text-primary" /> Planned study</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Plan a task or a full category, invite friends, then add the event to Google, Apple, or Outlook.</p>
      </div>
      {editingId && <button onClick={resetForm} className="flex items-center gap-1 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground"><X size={11} /> Cancel edit</button>}
    </div>

    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1 text-[11px] font-medium text-muted-foreground">
        <span>Date and time</span>
        <ThemedDateTimePicker value={when} onChange={setWhen} />
      </div>
      <div className="grid gap-1 text-[11px] font-medium text-muted-foreground">
        <span>Plan target</span>
        <ThemedSelect value={targetType} onChange={(v) => setTargetType(v as PlannedStudyTarget)} ariaLabel="Plan target"
          options={[
            { value: "task", label: "One task" },
            { value: "category", label: "Full category" },
          ]} />
      </div>
      {targetType === "task" ? (
        // Full-width row: task titles are long, and a half-width control clips
        // them in the closed state. The combobox is searchable by task name.
        <div className="grid gap-1 text-[11px] font-medium text-muted-foreground sm:col-span-2">
          <span>Task</span>
          <SearchableSelect value={effectiveTaskId} onChange={setTaskId} ariaLabel="Planned task"
            placeholder="No open tasks" searchPlaceholder="Search tasks…"
            options={openTasks.map((task) => ({ value: task.id, label: task.title, hint: task.tag, accent: tagColor(task.tag) }))} />
        </div>
      ) : (
        <div className="grid gap-1 text-[11px] font-medium text-muted-foreground">
          <span>Category</span>
          <ThemedSelect value={effectiveCategory} onChange={setCategory} ariaLabel="Planned category"
            placeholder="No categories"
            options={categories.map((name) => ({ value: name, label: name, accent: tagColor(name) }))} />
        </div>
      )}
      <label className="grid gap-1 text-[11px] font-medium text-muted-foreground">
        Duration (minutes)
        <span className="flex min-h-[2.5rem] items-center rounded-xl border border-border bg-card pr-3 transition focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20 hover:border-primary/50">
          <input type="number" min={5} max={480} value={minutes} onChange={(event) => setMinutes(Math.max(5, Math.min(480, Number(event.target.value))))} aria-label="Duration in minutes" className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-foreground outline-none" />
          <span className="text-xs text-muted-foreground">min</span>
        </span>
      </label>
    </div>
    <p className="mt-1.5 text-[11px] text-muted-foreground">Duration sets the calendar block length and when Roamly Flow considers the planned event overdue.</p>

    {targetType === "category" && (
      <label className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-card/60 p-3">
        <input type="checkbox" checked={includeAllTasks} onChange={(event) => setIncludeAllTasks(event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
        <span className="text-xs">
          <span className="block font-medium">Attach all {categoryTasks.length} open task{categoryTasks.length === 1 ? "" : "s"} in {effectiveCategory || "this category"}</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">Turn this off to plan the category without attaching individual tasks. Attached tasks are saved as a snapshot.</span>
        </span>
      </label>
    )}

    {!editingId && (
      <div className="mt-3 rounded-xl border border-border bg-card/60 p-3">
        <p className="flex items-center gap-1.5 text-xs font-medium"><Users size={13} className="text-primary" /> Invite friends</p>
        {friends.length === 0 ? (
          <p className="mt-1 text-[11px] text-muted-foreground">No accepted friends yet. Add friends from your profile menu, then return here to invite them.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {friends.map((friend) => {
              const checked = selectedFriendIds.includes(friend.id);
              return <label key={friend.id} className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${checked ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                <input type="checkbox" checked={checked} onChange={() => setSelectedFriendIds((current) => checked ? current.filter((id) => id !== friend.id) : [...current, friend.id])} className="h-3.5 w-3.5 accent-primary" />
                {personName(friend)}
              </label>;
            })}
          </div>
        )}
      </div>
    )}

    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button onClick={save} disabled={!canSave || saving}
        className="rounded-full gradient-primary px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50">
        {saving ? "Saving…" : editingId ? "Save changes" : "Plan event"}
      </button>
      {message && <p role="status" className={`text-xs ${message.startsWith("Couldn't") ? "text-destructive" : "text-muted-foreground"}`}>{message}</p>}
    </div>

    {incomingInvites.length > 0 && (
      <div className="mt-5">
        <h3 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Invitations</h3>
        <div className="mt-2 space-y-2">
          {incomingInvites.map((invitation) => {
            const plan = invitation.plan;
            if (!plan) return null;
            return <div key={invitation.id} className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <p className="text-sm font-medium">{personName(inviteActors.get(invitation.inviter_id))} invited you to {plan.task_title || plan.category}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{new Date(plan.scheduled_for).toLocaleString()} · {plan.expected_minutes} min</p>
              {plan.included_task_titles?.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">Tasks: {plan.included_task_titles.join(", ")}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {invitation.status === "pending" ? <>
                  <button onClick={() => respondToInvite(invitation.id, "accepted")} className="rounded-full gradient-primary px-3 py-1 text-xs font-semibold text-white">Accept</button>
                  <button onClick={() => respondToInvite(invitation.id, "declined")} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">Decline</button>
                </> : <span className="rounded-full bg-roamly-green/10 px-2.5 py-1 text-xs text-roamly-green">Accepted</span>}
                {invitation.status === "accepted" && (["google", "apple", "outlook"] as const).map((provider) => <button key={provider} onClick={() => addToCalendar(plan, provider)} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground"><ExternalLink size={10} className="mr-1 inline" />{provider === "apple" ? "Apple" : provider[0].toUpperCase() + provider.slice(1)}</button>)}
              </div>
            </div>;
          })}
        </div>
      </div>
    )}

    {planned.slice(0, 5).map((plan) => {
      const scope = plan.target_type === "category"
        ? plan.include_all_category_tasks
          ? `Full category · ${plan.included_task_titles?.length ?? 0} attached task${plan.included_task_titles?.length === 1 ? "" : "s"}`
          : "Full category · no individual tasks attached"
        : "Single task";
      return <div key={plan.id} className="mt-3 rounded-xl border border-border bg-card/70 p-3">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-sm font-medium">{plan.task_title || plan.category}</span>
            <span className="block text-xs text-muted-foreground">{new Date(plan.scheduled_for).toLocaleString()} · {plan.expected_minutes} min</span>
            <span className="mt-0.5 block text-[11px] text-muted-foreground">{scope}</span>
          </span>
          <span className="flex shrink-0 gap-1">
            <button onClick={() => beginEdit(plan)} aria-label={`Edit ${plan.task_title || plan.category}`} className="grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground"><Pencil size={11} /></button>
            <button onClick={() => setDeleteConfirmId(plan.id)} aria-label={`Delete ${plan.task_title || plan.category}`} className="grid h-7 w-7 place-items-center rounded-full border border-border text-muted-foreground hover:text-destructive"><Trash2 size={11} /></button>
          </span>
        </div>
        {plan.included_task_titles?.length > 0 && plan.target_type === "category" && <p className="mt-1.5 text-[11px] text-muted-foreground">Tasks: {plan.included_task_titles.join(", ")}</p>}
        {deleteConfirmId === plan.id && <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-destructive/10 p-2 text-xs"><span className="text-destructive">Delete this planned event?</span><button onClick={() => remove(plan.id)} className="rounded-full bg-destructive px-3 py-1 font-semibold text-white">Delete</button><button onClick={() => setDeleteConfirmId(null)} className="rounded-full border border-border px-3 py-1 text-muted-foreground">Cancel</button></div>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(["google", "apple", "outlook"] as const).map((provider) => <button key={provider} onClick={() => addToCalendar(plan, provider)} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/40"><ExternalLink size={10} className="mr-1 inline" />{provider === "apple" ? "Apple" : provider[0].toUpperCase() + provider.slice(1)}</button>)}
          {overdue.includes(plan) && <button onClick={() => onUpdatePlan(plan.id, { status: "completed", missed_reason: null })} className="rounded-full border border-roamly-green/40 px-2.5 py-1 text-xs text-roamly-green"><Check size={11} className="inline" /> Completed</button>}
        </div>
        {overdue.includes(plan) && <div className="mt-2 rounded-xl bg-secondary/70 p-2.5"><p className="mb-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">What got in the way?</span> Tagging this helps Roamly Flow spot patterns. No guilt, just useful data.</p><div className="flex flex-wrap gap-1.5">{MISSED_REASONS.map((reason) => <button key={reason} onClick={() => onUpdatePlan(plan.id, { status: "missed", missed_reason: reason })} className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-primary">{reason}</button>)}<button onClick={() => setDismissed((ids) => [...ids, plan.id])} className="text-[11px] text-muted-foreground underline">Not now</button></div></div>}
      </div>;
    })}
    {missed.length >= 3 && commonReason && <p className="mt-3 rounded-xl bg-secondary p-3 text-xs text-muted-foreground"><Clock3 size={13} className="mr-1 inline text-primary" />Across {missed.length} tagged misses, your most common reason is <span className="font-semibold text-foreground">{commonReason[0]}</span> ({commonReason[1]}).</p>}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-secondary p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 font-mono text-lg font-semibold">{value}</p></div>; }
function Breakdown({ title, rows, categorySummary = false }: { title: string; rows: [string, { minutes: number; sessions: number }][]; categorySummary?: boolean }) { return <div><h3 className="text-xs font-semibold">{title}</h3><div className="mt-2 space-y-2">{rows.length ? rows.map(([name, value]) => <div key={name} className="rounded-lg bg-secondary/60 px-3 py-2 text-xs"><div className="flex items-center justify-between gap-3"><span className="min-w-0 truncate font-medium">{name}</span><span className="shrink-0 font-mono text-muted-foreground">{value.sessions} session{value.sessions === 1 ? "" : "s"}</span></div><p className="mt-0.5 break-words text-[11px] text-muted-foreground">{categorySummary ? `You studied ${longDuration(value.minutes)} on ${name}.` : `${longDuration(value.minutes)} studied`}</p></div>) : <p className="text-xs text-muted-foreground">Complete a session to see this breakdown.</p>}</div></div>; }
function Trend({ title, rows }: { title: string; rows: { label: string; minutes: number }[] }) { const max = Math.max(1, ...rows.map((r) => r.minutes)); return <div><h3 className="text-xs font-semibold">{title}</h3><div className="mt-2 space-y-1.5">{rows.length ? rows.map((row) => <div key={row.label} className="grid grid-cols-[42px_1fr_42px] items-center gap-2 text-[10px]"><span className="truncate text-muted-foreground">{row.label}</span><span className="h-1.5 overflow-hidden rounded-full bg-border"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(3, row.minutes / max * 100)}%` }} /></span><span className="text-right font-mono text-muted-foreground">{row.minutes}m</span></div>) : <p className="text-xs text-muted-foreground">No trend yet.</p>}</div></div>; }

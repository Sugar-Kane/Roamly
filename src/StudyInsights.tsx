import { useMemo, useState } from "react";
import { CalendarPlus, Check, Clock3, ExternalLink } from "lucide-react";
import type { Task } from "./data";
import type { FocusSession } from "./streaks";
import { MISSED_REASONS, type MissedReason, type PlannedStudySession, type StudyEvent } from "./release3";

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

export function StudyInsights({ events, daily }: { events: StudyEvent[]; daily: FocusSession[] }) {
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
      <div className="mt-4 grid grid-cols-3 gap-3"><Metric label="Focus time" value={duration(total)} /><Metric label="Sessions" value={String(sessionCount)} /><Metric label="Average" value={average ? duration(average) : "—"} /></div>
      <div className="mt-5 grid gap-5 md:grid-cols-2"><Breakdown title="By category" rows={categories} /><Breakdown title="By task" rows={taskRows} /></div>
      <div className="mt-5 grid gap-4 md:grid-cols-3"><Trend title="Daily trend" rows={trendGroups.daily} /><Trend title="Weekly trend" rows={trendGroups.weekly} /><Trend title="Monthly trend" rows={trendGroups.monthly} /></div>
    </section>

  </div>;
}

function calendarDetails(plan: PlannedStudySession) {
  const start = new Date(plan.scheduled_for);
  const end = new Date(start.getTime() + plan.expected_minutes * 60_000);
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return { title: plan.task_title || `Study: ${plan.category}`, start, end, dates: `${stamp(start)}/${stamp(end)}` };
}

function addToCalendar(plan: PlannedStudySession, provider: "google" | "outlook" | "apple") {
  const event = calendarDetails(plan);
  if (provider === "google") {
    window.open(`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${event.dates}&details=${encodeURIComponent("Planned in Roamly Flow")}`, "_blank", "noopener,noreferrer");
    return;
  }
  if (provider === "outlook") {
    window.open(`https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(event.title)}&startdt=${encodeURIComponent(event.start.toISOString())}&enddt=${encodeURIComponent(event.end.toISOString())}&body=${encodeURIComponent("Planned in Roamly Flow")}`, "_blank", "noopener,noreferrer");
    return;
  }
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Roamly Flow//Planned Study//EN", "BEGIN:VEVENT", `UID:${plan.id}@roamlyflow.com`, `DTSTART:${event.dates.split("/")[0]}`, `DTEND:${event.dates.split("/")[1]}`, `SUMMARY:${event.title.replace(/[\\,;]/g, "\\$&")}`, "DESCRIPTION:Planned in Roamly Flow", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "roamly-study.ics"; link.click(); URL.revokeObjectURL(url);
}

export function PlannedStudyPanel({ tasks, plans, signedIn, onCreatePlan, onUpdatePlan }: {
  tasks: Task[]; plans: PlannedStudySession[]; signedIn: boolean;
  onCreatePlan: (row: Pick<PlannedStudySession, "task_id" | "task_title" | "category" | "scheduled_for" | "expected_minutes">) => void;
  onUpdatePlan: (id: string, fields: { status?: PlannedStudySession["status"]; missed_reason?: MissedReason | null }) => void;
}) {
  const [when, setWhen] = useState("");
  const [taskId, setTaskId] = useState("");
  const [minutes, setMinutes] = useState(25);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const planned = plans.filter((p) => p.status === "planned").sort((a, b) => new Date(a.scheduled_for).getTime() - new Date(b.scheduled_for).getTime());
  const overdue = planned.filter((p) => !dismissed.includes(p.id) && new Date(p.scheduled_for).getTime() + p.expected_minutes * 60_000 < Date.now());
  const missed = plans.filter((p) => p.status === "missed" && p.missed_reason);
  const reasonCounts = new Map<string, number>(); for (const p of missed) reasonCounts.set(p.missed_reason!, (reasonCounts.get(p.missed_reason!) ?? 0) + 1);
  const commonReason = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const create = () => {
    if (!when) return;
    const task = tasks.find((t) => t.id === taskId);
    onCreatePlan({ task_id: task?.id ?? null, task_title: task?.title ?? null, category: task?.tag || "Uncategorized", scheduled_for: new Date(when).toISOString(), expected_minutes: minutes });
    setWhen("");
  };
  return <section className="mt-6 rounded-2xl border border-border bg-card/80 p-5 shadow-sm">
    <h2 className="flex items-center gap-1.5 text-sm font-semibold"><CalendarPlus size={15} className="text-primary" /> Planned study</h2>
    <p className="mt-0.5 text-xs text-muted-foreground">Plan work beside your task list, then add it to Google Calendar, Apple Calendar, or Outlook.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_110px_auto]">
      <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Planned study time" className="rounded-xl border border-border bg-card px-3 py-2 text-sm" />
      <select value={taskId} onChange={(e) => setTaskId(e.target.value)} aria-label="Planned task" className="rounded-xl border border-border bg-card px-3 py-2 text-sm"><option value="">No task</option>{tasks.filter((t) => !t.done).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
      <input type="number" min={5} max={480} value={minutes} onChange={(e) => setMinutes(Math.max(5, Math.min(480, Number(e.target.value))))} aria-label="Expected minutes" className="rounded-xl border border-border bg-card px-3 py-2 text-sm" />
      <button onClick={create} disabled={!when} className="rounded-xl gradient-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Plan</button>
    </div>
    {!signedIn && <p className="mt-2 text-[11px] text-muted-foreground">Guest plans stay on this device.</p>}
    {planned.slice(0, 5).map((plan) => <div key={plan.id} className="mt-3 rounded-xl border border-border bg-card/70 p-3">
      <p className="text-sm font-medium">{plan.task_title || plan.category} · {new Date(plan.scheduled_for).toLocaleString()}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(["google", "apple", "outlook"] as const).map((provider) => <button key={provider} onClick={() => addToCalendar(plan, provider)} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-primary/40"><ExternalLink size={10} className="mr-1 inline" />{provider === "apple" ? "Apple" : provider[0].toUpperCase() + provider.slice(1)}</button>)}
        {overdue.includes(plan) && <button onClick={() => onUpdatePlan(plan.id, { status: "completed", missed_reason: null })} className="rounded-full border border-roamly-green/40 px-2.5 py-1 text-xs text-roamly-green"><Check size={11} className="inline" /> Completed</button>}
      </div>
      {overdue.includes(plan) && <div className="mt-2 flex flex-wrap gap-1.5"><span className="text-xs text-muted-foreground">Missed?</span>{MISSED_REASONS.map((reason) => <button key={reason} onClick={() => onUpdatePlan(plan.id, { status: "missed", missed_reason: reason })} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">{reason}</button>)}<button onClick={() => setDismissed((ids) => [...ids, plan.id])} className="text-[11px] text-muted-foreground underline">Not now</button></div>}
    </div>)}
    {missed.length >= 3 && commonReason && <p className="mt-3 rounded-xl bg-secondary p-3 text-xs text-muted-foreground"><Clock3 size={13} className="mr-1 inline text-primary" />Across {missed.length} tagged misses, your most common reason is <span className="font-semibold text-foreground">{commonReason[0]}</span> ({commonReason[1]}).</p>}
  </section>;
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-secondary p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 font-mono text-lg font-semibold">{value}</p></div>; }
function Breakdown({ title, rows }: { title: string; rows: [string, { minutes: number; sessions: number }][] }) { return <div><h3 className="text-xs font-semibold">{title}</h3><div className="mt-2 space-y-2">{rows.length ? rows.map(([name, value]) => <div key={name} className="flex items-center justify-between gap-3 text-xs"><span className="truncate">{name}</span><span className="shrink-0 font-mono text-muted-foreground">{duration(value.minutes)} · {value.sessions} session{value.sessions === 1 ? "" : "s"}</span></div>) : <p className="text-xs text-muted-foreground">Complete a session to see this breakdown.</p>}</div></div>; }
function Trend({ title, rows }: { title: string; rows: { label: string; minutes: number }[] }) { const max = Math.max(1, ...rows.map((r) => r.minutes)); return <div><h3 className="text-xs font-semibold">{title}</h3><div className="mt-2 space-y-1.5">{rows.length ? rows.map((row) => <div key={row.label} className="grid grid-cols-[42px_1fr_42px] items-center gap-2 text-[10px]"><span className="truncate text-muted-foreground">{row.label}</span><span className="h-1.5 overflow-hidden rounded-full bg-border"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(3, row.minutes / max * 100)}%` }} /></span><span className="text-right font-mono text-muted-foreground">{row.minutes}m</span></div>) : <p className="text-xs text-muted-foreground">No trend yet.</p>}</div></div>; }

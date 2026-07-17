// Admin BI dashboard — Phase 1 shell, global filters, and Overview.
//
// Security: every number here comes from the is_admin()-gated SECURITY DEFINER
// RPCs in db.ts (admin_kpi_summary / admin_active_series / admin_conversion_
// funnel). The client never selects raw user rows. The dashboard chrome is only
// rendered for admins (AdminView checks isAdmin before mounting this).
//
// This file is intentionally standalone (it imports no section components), so
// Admin.tsx wires the existing Users/Feedback/Errors/Ads views into the shell
// without a circular import.

import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LayoutDashboard, Users, Activity, BarChart3, DollarSign, MessageSquare,
  AlertTriangle, Megaphone, Mail, Table2, Download, RefreshCw, ChevronRight,
  ArrowUp, ArrowDown, Minus, Info, X, Menu,
} from "lucide-react";
import {
  adminKpiSummary, adminActiveSeries, adminConversionFunnel,
  type AdminKpiSummary, type AdminActivityDay, type AdminFunnel,
  type AdminPlanScope, type AdminDeviceScope,
} from "./db";
import { ThemedSelect } from "./ThemedSelect";
import { resolveRange, pctChange, fmtMinutes, buildInsights, type AdminFilters } from "./adminMetrics";

const AdminTrendChart = lazy(() => import("./Charts").then((m) => ({ default: m.AdminTrendChart })));
const AdminStackedBars = lazy(() => import("./Charts").then((m) => ({ default: m.AdminStackedBars })));

// ---------------------------------------------------------------------------
// Sections (order = nav order). Consumers supply the node for each.
// ---------------------------------------------------------------------------
export type AdminSectionId =
  | "overview" | "users" | "engagement" | "features" | "revenue"
  | "feedback" | "errors" | "ads" | "invites" | "explorer";

export const ADMIN_SECTIONS: { id: AdminSectionId; label: string; icon: typeof Users }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "users", label: "Users", icon: Users },
  { id: "engagement", label: "Engagement", icon: Activity },
  { id: "features", label: "Features", icon: BarChart3 },
  { id: "revenue", label: "Revenue", icon: DollarSign },
  { id: "feedback", label: "Feedback", icon: MessageSquare },
  { id: "errors", label: "Errors", icon: AlertTriangle },
  { id: "ads", label: "Ads", icon: Megaphone },
  { id: "invites", label: "Invites", icon: Mail },
  { id: "explorer", label: "Data Explorer", icon: Table2 },
];

// ---------------------------------------------------------------------------
// Global filter state (persisted per device). Retained across section switches
// because it lives in AdminView, above the shell.
// ---------------------------------------------------------------------------
const DEFAULT_FILTERS: AdminFilters = { range: "30d", customStart: "", customEnd: "", compare: true, plan: "all", device: "all" };
const FILTER_KEY = "roamly-admin-filters";

export function useAdminFilters() {
  const [filters, setFilters] = useState<AdminFilters>(() => {
    try { return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem(FILTER_KEY) ?? "{}") }; }
    catch { return DEFAULT_FILTERS; }
  });
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => { try { localStorage.setItem(FILTER_KEY, JSON.stringify(filters)); } catch { /* ignore */ } }, [filters]);
  const patch = (p: Partial<AdminFilters>) => setFilters((f) => ({ ...f, ...p }));
  const clear = () => setFilters(DEFAULT_FILTERS);
  const refresh = () => setRefreshKey((k) => k + 1);
  const resolved = useMemo(() => resolveRange(filters), [filters]);
  return { filters, patch, clear, refresh, refreshKey, resolved };
}
export type AdminFilterState = ReturnType<typeof useAdminFilters>;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
export function csvDownload(filename: string, rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const fmt = (n: number) => n.toLocaleString();

// ---------------------------------------------------------------------------
// FilterBar — affects every card/chart on filter-aware pages.
// ---------------------------------------------------------------------------
export function FilterBar({ state, updatedAt, onExport }: { state: AdminFilterState; updatedAt: number | null; onExport?: () => void }) {
  const { filters, patch, clear, refresh, resolved } = state;
  const [ago, setAgo] = useState("");
  useEffect(() => {
    if (!updatedAt) { setAgo(""); return; }
    const tick = () => {
      const s = Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
      setAgo(s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`);
    };
    tick(); const id = setInterval(tick, 5000); return () => clearInterval(id);
  }, [updatedAt]);

  return (
    <div className="sticky top-0 z-20 -mx-1 mb-4 rounded-2xl border border-border bg-card/95 p-2.5 backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Date range">
          {(["today", "7d", "14d", "30d", "90d"] as const).map((r) => (
            <button key={r} onClick={() => patch({ range: r })} aria-pressed={filters.range === r}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${filters.range === r ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40"}`}>
              {r === "today" ? "Today" : r}
            </button>
          ))}
          <button onClick={() => patch({ range: "custom" })} aria-pressed={filters.range === "custom"}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${filters.range === "custom" ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40"}`}>
            Custom
          </button>
        </div>

        {filters.range === "custom" && (
          <span className="flex items-center gap-1 text-xs">
            <input type="date" value={filters.customStart} onChange={(e) => patch({ customStart: e.target.value })} aria-label="Custom start date"
              className="rounded-lg border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary" />
            <span className="text-muted-foreground">→</span>
            <input type="date" value={filters.customEnd} onChange={(e) => patch({ customEnd: e.target.value })} aria-label="Custom end date"
              className="rounded-lg border border-border bg-card px-2 py-1 text-xs outline-none focus:border-primary" />
          </span>
        )}

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={filters.compare} onChange={(e) => patch({ compare: e.target.checked })} className="accent-[hsl(var(--primary))]" />
          Compare to previous
        </label>

        <span className="w-28"><ThemedSelect value={filters.plan} ariaLabel="User plan"
          onChange={(v) => patch({ plan: v as AdminPlanScope })}
          options={[{ value: "all", label: "All plans" }, { value: "free", label: "Free" }, { value: "premium", label: "Premium" }]} /></span>
        <span className="w-28"><ThemedSelect value={filters.device} ariaLabel="Device type"
          onChange={(v) => patch({ device: v as AdminDeviceScope })}
          options={[{ value: "all", label: "All devices" }, { value: "phone", label: "Phone" }, { value: "tablet", label: "Tablet" }, { value: "pc", label: "Computer" }]} /></span>

        <div className="ml-auto flex items-center gap-1">
          {updatedAt && <span className="hidden text-[11px] text-muted-foreground sm:inline">Updated {ago}</span>}
          <button onClick={refresh} aria-label="Refresh data" className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground"><RefreshCw size={14} /></button>
          {onExport && <button onClick={onExport} aria-label="Export current view to CSV" className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground"><Download size={14} /></button>}
          <button onClick={clear} className="rounded-lg border border-border bg-card px-2 py-1.5 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground">Clear</button>
        </div>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-muted-foreground">{resolved.label} · UTC{filters.compare ? " · vs previous period" : ""}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KpiCard — value, comparison delta, trend arrow, sparkline, tooltip, drill.
// ---------------------------------------------------------------------------
export function KpiCard({ label, value, prev, format = fmt, spark, tip, onClick, primary = false, suffix }: {
  label: string; value: number; prev?: number | null; format?: (n: number) => string;
  spark?: number[]; tip: string; onClick?: () => void; primary?: boolean; suffix?: string;
}) {
  const change = prev == null ? null : pctChange(value, prev);
  const dir = change == null ? 0 : change > 0.5 ? 1 : change < -0.5 ? -1 : 0;
  const Arrow = dir > 0 ? ArrowUp : dir < 0 ? ArrowDown : Minus;
  const changeColor = dir > 0 ? "text-roamly-green" : dir < 0 ? "text-destructive" : "text-muted-foreground";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick}
      className={`group relative flex flex-col rounded-xl border border-border bg-card/80 p-3 text-left transition ${onClick ? "hover:border-primary/40" : ""} ${primary ? "sm:p-4" : ""}`}>
      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
        {label}
        <span className="relative inline-flex" tabIndex={0} aria-label={tip}>
          <Info size={11} className="opacity-50" />
          <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 hidden w-52 -translate-x-1/2 rounded-lg border border-border bg-card p-2 text-[11px] font-normal leading-snug text-muted-foreground shadow-lg group-hover:block [span:focus>&]:block">{tip}</span>
        </span>
      </span>
      <span className={`mt-1 font-display font-semibold ${primary ? "text-2xl sm:text-3xl" : "text-xl"}`}>{format(value)}{suffix}</span>
      <span className="mt-1 flex items-center gap-2">
        {prev !== undefined && (
          <span className={`flex items-center gap-0.5 text-[11px] font-medium ${changeColor}`}>
            <Arrow size={11} />{change == null ? "new" : `${change >= 0 ? "+" : ""}${change.toFixed(0)}%`}
          </span>
        )}
        {spark && spark.length > 1 && <Sparkline values={spark} />}
      </span>
    </Tag>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 52, h = 16, max = Math.max(...values, 1), min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - ((v - min) / range) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="opacity-70" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Generic shell: collapsible sidebar (desktop) / drawer (mobile).
// ---------------------------------------------------------------------------
export function AdminShell({ active, setActive, children, badges }: {
  active: AdminSectionId; setActive: (id: AdminSectionId) => void; children: ReactNode;
  badges?: Partial<Record<AdminSectionId, number>>;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("roamly-admin-nav-collapsed") === "1");
  const toggleCollapsed = () => setCollapsed((c) => { localStorage.setItem("roamly-admin-nav-collapsed", c ? "0" : "1"); return !c; });
  const activeLabel = ADMIN_SECTIONS.find((s) => s.id === active)?.label ?? "Overview";

  const NavList = ({ onPick }: { onPick?: () => void }) => (
    <nav className="flex flex-col gap-0.5" aria-label="Admin sections">
      {ADMIN_SECTIONS.map((s) => {
        const Icon = s.icon; const on = active === s.id; const badge = badges?.[s.id];
        return (
          <button key={s.id} onClick={() => { setActive(s.id); onPick?.(); }} aria-current={on ? "page" : undefined}
            className={`flex min-h-[2.5rem] items-center gap-2.5 rounded-lg px-2.5 text-sm transition ${on ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"}`}
            title={collapsed ? s.label : undefined}>
            <Icon size={17} className="shrink-0" />
            {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{s.label}</span>}
            {!collapsed && badge ? <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">{badge}</span> : null}
          </button>
        );
      })}
    </nav>
  );

  return (
    <div className="mx-auto w-full max-w-6xl">
      {/* Mobile: section selector + drawer trigger */}
      <div className="mb-4 flex items-center gap-2 lg:hidden">
        <button onClick={() => setDrawerOpen(true)} aria-label="Open admin sections"
          className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium">
          <Menu size={16} /> {activeLabel} <ChevronRight size={14} className="text-muted-foreground" />
        </button>
      </div>

      <div className="flex gap-5">
        {/* Desktop sidebar */}
        <aside className={`hidden shrink-0 lg:block ${collapsed ? "w-14" : "w-48"}`}>
          <div className="sticky top-4">
            <button onClick={toggleCollapsed} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="mb-2 grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-muted-foreground transition hover:text-foreground">
              <Menu size={15} />
            </button>
            <NavList />
          </div>
        </aside>

        <div className="min-w-0 flex-1">{children}</div>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-[130] lg:hidden" onClick={() => setDrawerOpen(false)}>
          <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" />
          <div className="absolute inset-y-0 left-0 w-64 max-w-[80%] border-r border-border bg-card p-3 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between">
              <span className="font-display text-sm font-semibold">Admin</span>
              <button onClick={() => setDrawerOpen(false)} aria-label="Close sections" className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary"><X size={16} /></button>
            </div>
            <NavList onPick={() => setDrawerOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

// A simple "this section arrives in a later phase" placeholder that still names
// what it will contain, so the nav is complete without faking data.
export function SectionPlaceholder({ title, phase, contains }: { title: string; phase: string; contains: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/60 p-6 text-center">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{contains}</p>
      <p className="mt-3 inline-block rounded-full bg-secondary/60 px-3 py-1 text-[11px] font-medium text-muted-foreground">Arriving in {phase}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview page
// ---------------------------------------------------------------------------
export function AdminOverviewPage({ state, onDrill }: { state: AdminFilterState; onDrill: (id: AdminSectionId) => void }) {
  const { resolved, filters, refreshKey } = state;
  const [cur, setCur] = useState<AdminKpiSummary | null>(null);
  const [prev, setPrev] = useState<AdminKpiSummary | null>(null);
  const [series, setSeries] = useState<AdminActivityDay[]>([]);
  const [funnel, setFunnel] = useState<AdminFunnel | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    const { startISO, endISO, prevStartISO, prevEndISO } = resolved;
    Promise.all([
      adminKpiSummary(startISO, endISO, filters.plan, filters.device),
      filters.compare ? adminKpiSummary(prevStartISO, prevEndISO, filters.plan, filters.device) : Promise.resolve(null),
      adminActiveSeries(startISO, endISO, filters.plan, filters.device),
      adminConversionFunnel(startISO, endISO),
    ]).then(([c, p, s, f]) => {
      if (!alive) return;
      if (!c) { setStatus("error"); return; }
      setCur(c); setPrev(p); setSeries(s); setFunnel(f);
      setUpdatedAt(Date.now()); setStatus("ready");
    }).catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [resolved, filters.plan, filters.device, filters.compare, refreshKey]);

  const trendData = useMemo(() => series.map((d) => ({
    day: new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
    Active: d.dau, Focused: d.sessions_completed,
    New: d.new_users, Returning: d.returning_users,
    Minutes: d.focus_minutes,
  })), [series]);

  const deviceTotals = useMemo(() => {
    const p = series.reduce((a, d) => a + d.phone_events, 0);
    const t = series.reduce((a, d) => a + d.tablet_events, 0);
    const c = series.reduce((a, d) => a + d.pc_events, 0);
    return [
      { name: "Phone", value: p, color: "hsl(var(--primary))" },
      { name: "Tablet", value: t, color: "hsl(var(--primary) / 0.6)" },
      { name: "Computer", value: c, color: "hsl(var(--primary) / 0.3)" },
    ].filter((x) => x.value > 0);
  }, [series]);

  const insights = useMemo(() => (cur && prev ? buildInsights(cur, prev, funnel) : []), [cur, prev, funnel]);

  const exportCsv = () => {
    if (!cur) return;
    const rows: (string | number)[][] = [["metric", "current", "previous"]];
    (Object.keys(cur) as (keyof AdminKpiSummary)[]).forEach((k) => rows.push([k, cur[k], prev ? prev[k] : ""]));
    rows.push([]); rows.push(["day", "dau", "new_users", "returning_users", "focus_minutes", "sessions_started", "sessions_completed"]);
    series.forEach((d) => rows.push([d.day, d.dau, d.new_users, d.returning_users, d.focus_minutes, d.sessions_started, d.sessions_completed]));
    csvDownload(`roamly-overview-${resolved.startISO.slice(0, 10)}_${resolved.endISO.slice(0, 10)}.csv`, rows);
  };

  const dauSpark = series.map((d) => d.dau);
  const minSpark = series.map((d) => d.focus_minutes);
  const P = (k: keyof AdminKpiSummary) => (filters.compare && prev ? prev[k] : undefined);
  const convRate = cur && cur.new_users > 0 && funnel ? (funnel.converted_paid / funnel.signed_up) * 100 : 0;
  const focusCompletion = cur && cur.focus_sessions_started > 0 ? (cur.focus_blocks_done / cur.focus_sessions_started) * 100 : 0;

  return (
    <div>
      <FilterBar state={state} updatedAt={updatedAt} onExport={exportCsv} />

      {status === "error" && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">Couldn't load dashboard data. Check your admin access and try Refresh.</div>
      )}

      {status === "loading" && <OverviewSkeleton />}

      {status === "ready" && cur && (
        <>
          {/* Primary business metrics */}
          <section aria-label="Key metrics">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Key metrics</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <KpiCard primary label="Total users" value={cur.total_users} prev={P("total_users")} tip="Registered accounts created on or before the end of the selected window (UTC)." onClick={() => onDrill("users")} />
              <KpiCard primary label="DAU" value={cur.dau} prev={P("dau")} spark={dauSpark} tip="Distinct users who fired a tracked event or logged focus minutes in the last 24h of the window." onClick={() => onDrill("engagement")} />
              <KpiCard primary label="WAU" value={cur.wau} prev={P("wau")} tip="Distinct active users in the trailing 7 days ending the window (UTC)." onClick={() => onDrill("engagement")} />
              <KpiCard primary label="MAU" value={cur.mau} prev={P("mau")} tip="Distinct active users in the trailing 30 days ending the window (UTC)." onClick={() => onDrill("engagement")} />
              <KpiCard primary label="Premium" value={cur.premium_users} prev={P("premium_users")} tip="Users with an active premium entitlement as of the window end (subscription, trial, credit, or admin grant)." onClick={() => onDrill("revenue")} />
              <KpiCard primary label="Paid conversion" value={convRate} format={(n) => n.toFixed(1)} suffix="%" tip="Of users who registered in this window, the share with a subscription entitlement. Cohort-based; small windows are noisy." onClick={() => onDrill("revenue")} />
            </div>
          </section>

          {/* Charts */}
          <section className="mt-5 grid gap-3 lg:grid-cols-2" aria-label="Trends">
            <ChartCard title="Active users over time" subtitle="Daily active users vs. completed focus blocks (UTC).">
              <Suspense fallback={<ChartSkeleton />}><AdminTrendChart data={trendData} series={[{ key: "Active", label: "Active users", color: "hsl(var(--primary))" }, { key: "Focused", label: "Completed blocks", color: "hsl(var(--primary) / 0.4)" }]} /></Suspense>
            </ChartCard>
            <ChartCard title="New vs returning" subtitle="Daily composition of active users.">
              <Suspense fallback={<ChartSkeleton />}><AdminStackedBars data={trendData} series={[{ key: "Returning", label: "Returning", color: "hsl(var(--primary) / 0.4)" }, { key: "New", label: "New", color: "hsl(var(--primary))" }]} /></Suspense>
            </ChartCard>
            <ChartCard title="Conversion funnel" subtitle="Cohort of users who registered in this window.">
              <FunnelBars funnel={funnel} />
            </ChartCard>
            <ChartCard title="Focus minutes over time" subtitle="Total minutes logged per day (UTC).">
              <Suspense fallback={<ChartSkeleton />}><AdminTrendChart data={trendData} series={[{ key: "Minutes", label: "Focus minutes", color: "hsl(var(--primary))" }]} /></Suspense>
            </ChartCard>
          </section>

          {/* Supporting metrics */}
          <section className="mt-5" aria-label="Supporting metrics">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Product & engagement</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <KpiCard label="New registrations" value={cur.new_users} prev={P("new_users")} tip="Accounts created within the selected window (UTC)." />
              <KpiCard label="Returning users" value={cur.returning_users} prev={P("returning_users")} tip="Active users in the window who registered before the window started." />
              <KpiCard label="Trial users" value={cur.trial_users} prev={P("trial_users")} tip="Users with an active trial entitlement as of the window end." />
              <KpiCard label="Stickiness" value={cur.mau > 0 ? (cur.dau / cur.mau) * 100 : 0} format={(n) => n.toFixed(0)} suffix="%" tip="DAU ÷ MAU — how often monthly users show up on a given day." />
              <KpiCard label="Focus minutes" value={cur.focus_minutes} prev={P("focus_minutes")} format={fmtMinutes} spark={minSpark} tip="Sum of focus_sessions.minutes over the window." />
              <KpiCard label="Focus completion" value={focusCompletion} format={(n) => n.toFixed(0)} suffix="%" tip="Completed focus blocks ÷ timer starts. Approximate — start events are throttled to 1 / 30s." />
              <KpiCard label="Blocks completed" value={cur.focus_blocks_done} prev={P("focus_blocks_done")} tip="focus_block_done events in the window (throttled)." />
              <KpiCard label="Tasks created" value={cur.tasks_created} prev={P("tasks_created")} tip="Tasks with created_at in the window." />
              <KpiCard label="Tasks completed" value={cur.tasks_completed} prev={P("tasks_completed")} tip="Tasks marked done with updated_at in the window (approximate)." />
              <KpiCard label="Room joins" value={cur.room_joins} prev={P("room_joins")} tip="room_join events in the window (throttled)." />
              <KpiCard label="Note uploads" value={cur.note_uploads} prev={P("note_uploads")} tip="task_ai_upload events in the window." />
              <KpiCard label="Credit purchases" value={cur.credit_purchases} prev={P("credit_purchases")} tip="credit_ledger rows with reason='purchase' in the window (authoritative)." onClick={() => onDrill("revenue")} />
              <KpiCard label="Feedback" value={cur.feedback_count} prev={P("feedback_count")} tip="Feedback submissions in the window." onClick={() => onDrill("feedback")} />
              <KpiCard label="Errors" value={cur.error_count} prev={P("error_count")} tip="Client errors logged in the window." onClick={() => onDrill("errors")} />
            </div>
          </section>

          {/* Insights + device */}
          <section className="mt-5 grid gap-3 lg:grid-cols-[1fr_260px]" aria-label="Insights and device split">
            <div className="rounded-2xl border border-border bg-card/70 p-4">
              <h3 className="text-sm font-semibold">Insights</h3>
              {insights.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">{filters.compare ? "Not enough change to report yet." : "Turn on “Compare to previous” for period-over-period insights."}</p>
              ) : (
                <ul className="mt-2 space-y-1.5">{insights.map((t, i) => <li key={i} className="flex gap-2 text-sm text-muted-foreground"><ChevronRight size={15} className="mt-0.5 shrink-0 text-primary" /><span>{t}</span></li>)}</ul>
              )}
            </div>
            <div className="rounded-2xl border border-border bg-card/70 p-4">
              <h3 className="text-sm font-semibold">Device split</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Share of tracked events.</p>
              {deviceTotals.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No events yet.</p> : (
                <ul className="mt-3 space-y-1.5">
                  {deviceTotals.map((d) => {
                    const total = deviceTotals.reduce((a, x) => a + x.value, 0);
                    return (
                      <li key={d.name} className="text-sm">
                        <div className="flex items-center justify-between"><span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />{d.name}</span><span className="font-mono text-xs text-muted-foreground">{Math.round((d.value / total) * 100)}%</span></div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full" style={{ width: `${(d.value / total) * 100}%`, background: d.color }} /></div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function FunnelBars({ funnel }: { funnel: AdminFunnel | null }) {
  if (!funnel || funnel.signed_up === 0) return <div className="grid h-full min-h-[8rem] place-items-center text-sm text-muted-foreground">No registrations in this window.</div>;
  const steps = [
    { label: "Signed up", v: funnel.signed_up },
    { label: "Focused", v: funnel.focused },
    { label: "Created a task", v: funnel.created_task },
    { label: "Started trial", v: funnel.started_trial },
    { label: "Converted to paid", v: funnel.converted_paid },
  ];
  const max = funnel.signed_up || 1;
  return (
    <div className="flex h-full flex-col justify-center gap-2 py-1">
      {steps.map((s) => (
        <div key={s.label} className="text-xs">
          <div className="flex items-center justify-between"><span>{s.label}</span><span className="font-mono text-muted-foreground">{s.v} · {Math.round((s.v / max) * 100)}%</span></div>
          <div className="mt-1 h-3 overflow-hidden rounded bg-border"><div className="h-full rounded bg-primary" style={{ width: `${(s.v / max) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
      <div className="mt-3 h-44">{children}</div>
    </div>
  );
}
function ChartSkeleton() { return <div className="h-full w-full animate-pulse rounded-xl bg-border/40" />; }
function OverviewSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-border/40" />)}</div>
      <div className="grid gap-3 lg:grid-cols-2">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-56 animate-pulse rounded-2xl bg-border/40" />)}</div>
    </div>
  );
}

// Admin BI dashboard — Phase 2: Features and Engagement analytics pages.
// Same security model as Phase 1 (is_admin()-gated RPCs via db.ts). Human
// event names come from adminLabels; raw names only appear in the technical
// detail drawer.

import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Search, ArrowUpDown, SlidersHorizontal } from "lucide-react";
import {
  adminFeatureStats, adminFeatureTrend, adminActivityHeatmap, adminRetentionCohorts, adminKpiSummary,
  type AdminFeatureStat, type AdminFeatureTrendPoint, type AdminHeatCell, type AdminCohortRow, type AdminKpiSummary,
} from "./db";
import { FilterBar, KpiCard, csvDownload, type AdminFilterState } from "./adminDashboard";
import { featureLabel, featureCategory, FEATURE_CATEGORIES } from "./adminLabels";
import { fmtMinutes } from "./adminMetrics";
import { ThemedSelect } from "./ThemedSelect";
import { Drawer } from "./Drawer";

const AdminTrendChart = lazy(() => import("./Charts").then((m) => ({ default: m.AdminTrendChart })));

// ===========================================================================
// FEATURES
// ===========================================================================
type FeatureRow = AdminFeatureStat & { active: number };
type SortKey = "label" | "total" | "unique_users" | "perActive" | "adoption" | "delta" | "free_uses" | "premium_uses" | "mobile" | "desktop" | "last_at";

const COLUMNS: { key: SortKey; label: string; tip?: string; always?: boolean }[] = [
  { key: "label", label: "Feature", always: true },
  { key: "total", label: "Total uses", always: true },
  { key: "unique_users", label: "Users" },
  { key: "perActive", label: "Per active user", tip: "Total uses ÷ active users in the window." },
  { key: "adoption", label: "Adoption", tip: "Unique users ÷ active users." },
  { key: "delta", label: "Δ vs prev" },
  { key: "free_uses", label: "Free" },
  { key: "premium_uses", label: "Premium" },
  { key: "mobile", label: "Mobile" },
  { key: "desktop", label: "Desktop" },
  { key: "last_at", label: "Last active" },
];

function relTime(iso: string | null): string {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "1d ago";
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
const val = (r: FeatureRow, k: SortKey): number | string => {
  switch (k) {
    case "label": return featureLabel(r.name).toLowerCase();
    case "perActive": return r.active ? r.total / r.active : 0;
    case "adoption": return r.active ? r.unique_users / r.active : 0;
    case "delta": return r.prev_total ? (r.total - r.prev_total) / r.prev_total : (r.total ? Infinity : 0);
    case "mobile": return r.phone + r.tablet;
    case "desktop": return r.pc;
    case "last_at": return r.last_at ? new Date(r.last_at).getTime() : 0;
    default: return r[k as keyof AdminFeatureStat] as number;
  }
};

export function FeaturesPage({ state }: { state: AdminFilterState }) {
  const { resolved, filters, refreshKey } = state;
  const [rows, setRows] = useState<FeatureRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "total", dir: "desc" });
  const [hidden, setHidden] = useState<Set<SortKey>>(new Set(["free_uses", "premium_uses"]));
  const [showCols, setShowCols] = useState(false);
  const [detail, setDetail] = useState<FeatureRow | null>(null);
  const [compare, setCompare] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true; setStatus("loading");
    const { startISO, endISO, prevStartISO, prevEndISO } = resolved;
    Promise.all([
      adminFeatureStats(startISO, endISO, prevStartISO, prevEndISO, filters.plan, filters.device),
      adminKpiSummary(startISO, endISO, filters.plan, filters.device),
    ]).then(([f, k]) => {
      if (!alive) return;
      const active = k?.active_users ?? 0;
      setRows(f.map((r) => ({ ...r, active })));
      setUpdatedAt(Date.now()); setStatus("ready");
    }).catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [resolved, filters.plan, filters.device, refreshKey]);

  const filtered = useMemo(() => {
    let list = rows;
    if (q.trim()) list = list.filter((r) => featureLabel(r.name).toLowerCase().includes(q.toLowerCase()));
    if (cat !== "all") list = list.filter((r) => featureCategory(r.name) === cat);
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = val(a, sort.key), vb = val(b, sort.key);
      if (typeof va === "string" && typeof vb === "string") return va < vb ? -dir : va > vb ? dir : 0;
      return ((va as number) - (vb as number)) * dir;
    });
  }, [rows, q, cat, sort]);

  const toggleSort = (k: SortKey) => setSort((s) => ({ key: k, dir: s.key === k && s.dir === "desc" ? "asc" : "desc" }));
  const exportCsv = () => {
    const cols = COLUMNS.filter((c) => !hidden.has(c.key));
    const header = cols.map((c) => c.label).concat("Category", "Event name");
    const body = filtered.map((r) => cols.map((c) => cell(r, c.key, true)).concat(featureCategory(r.name), r.name));
    csvDownload(`roamly-features-${resolved.startISO.slice(0, 10)}.csv`, [header, ...body]);
  };

  return (
    <div>
      <FilterBar state={state} updatedAt={updatedAt} onExport={exportCsv} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="relative flex-1 min-w-[10rem]">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search features…" aria-label="Search features"
            className="w-full rounded-lg border border-border bg-card py-1.5 pl-8 pr-2 text-sm outline-none focus:border-primary" />
        </span>
        <span className="w-40"><ThemedSelect value={cat} ariaLabel="Feature category" onChange={setCat}
          options={[{ value: "all", label: "All categories" }, ...FEATURE_CATEGORIES.map((c) => ({ value: c, label: c }))]} /></span>
        <span className="relative">
          <button onClick={() => setShowCols((s) => !s)} className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs text-muted-foreground transition hover:border-primary/40"><SlidersHorizontal size={13} /> Columns</button>
          {showCols && (
            <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-border bg-card p-2 shadow-lg">
              {COLUMNS.filter((c) => !c.always).map((c) => (
                <label key={c.key} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-secondary/60">
                  <input type="checkbox" checked={!hidden.has(c.key)} className="accent-[hsl(var(--primary))]"
                    onChange={() => setHidden((h) => { const n = new Set(h); n.has(c.key) ? n.delete(c.key) : n.add(c.key); return n; })} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </span>
      </div>

      {status === "error" && <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">Couldn't load feature analytics.</div>}
      {status === "loading" && <div className="h-64 animate-pulse rounded-2xl bg-border/40" />}
      {status === "ready" && filtered.length === 0 && <div className="rounded-2xl border border-dashed border-border bg-card/60 p-6 text-center text-sm text-muted-foreground">No feature activity matches these filters.</div>}

      {status === "ready" && filtered.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card/70">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="w-8 px-2 py-2"></th>
                {COLUMNS.filter((c) => !hidden.has(c.key)).map((c) => (
                  <th key={c.key} scope="col" className={`px-3 py-2 font-medium ${c.key === "label" ? "" : "text-right"}`}>
                    <button onClick={() => toggleSort(c.key)} title={c.tip} className={`inline-flex items-center gap-1 hover:text-foreground ${sort.key === c.key ? "text-foreground" : ""}`}>
                      {c.label}<ArrowUpDown size={11} className="opacity-40" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.name} className="border-b border-border/50 last:border-0 hover:bg-primary/5">
                  <td className="px-2 py-2"><input type="checkbox" aria-label={`Compare ${featureLabel(r.name)}`} checked={compare.has(r.name)} className="accent-[hsl(var(--primary))]"
                    onChange={() => setCompare((c) => { const n = new Set(c); n.has(r.name) ? n.delete(r.name) : n.add(r.name); return n; })} /></td>
                  {COLUMNS.filter((c) => !hidden.has(c.key)).map((c) => (
                    <td key={c.key} className={`px-3 py-2 ${c.key === "label" ? "" : "text-right tabular-nums"}`}>
                      {c.key === "label" ? (
                        <button onClick={() => setDetail(r)} className="flex items-center gap-2 text-left hover:text-primary">
                          <span className="font-medium">{featureLabel(r.name)}</span>
                          <span className="rounded-full bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">{featureCategory(r.name)}</span>
                        </button>
                      ) : c.key === "delta" ? <DeltaCell r={r} /> : cell(r, c.key, false)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {compare.size >= 2 && <CompareBar rows={rows.filter((r) => compare.has(r.name))} onClear={() => setCompare(new Set())} />}
      {detail && <FeatureDetail row={detail} state={state} onClose={() => setDetail(null)} />}
    </div>
  );
}

function cell(r: FeatureRow, k: SortKey, csv: boolean): string {
  switch (k) {
    case "total": return String(r.total);
    case "unique_users": return String(r.unique_users);
    case "perActive": return r.active ? (r.total / r.active).toFixed(1) : "—";
    case "adoption": return r.active ? `${Math.round((r.unique_users / r.active) * 100)}%` : "—";
    case "free_uses": return String(r.free_uses);
    case "premium_uses": return String(r.premium_uses);
    case "mobile": return String(r.phone + r.tablet);
    case "desktop": return String(r.pc);
    case "last_at": return csv ? (r.last_at ?? "") : relTime(r.last_at);
    case "delta": return r.prev_total ? `${Math.round(((r.total - r.prev_total) / r.prev_total) * 100)}%` : "new";
    default: return "";
  }
}
function DeltaCell({ r }: { r: FeatureRow }) {
  if (!r.prev_total) return <span className="text-muted-foreground">new</span>;
  const pct = Math.round(((r.total - r.prev_total) / r.prev_total) * 100);
  return <span className={pct > 0 ? "text-roamly-green" : pct < 0 ? "text-destructive" : "text-muted-foreground"}>{pct >= 0 ? "+" : ""}{pct}%</span>;
}

function CompareBar({ rows, onClear }: { rows: FeatureRow[]; onClear: () => void }) {
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div className="mt-4 rounded-2xl border border-border bg-card/70 p-4">
      <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-semibold">Comparing {rows.length} features</h3>
        <button onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">Clear</button></div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.name} className="text-xs">
            <div className="flex justify-between"><span>{featureLabel(r.name)}</span><span className="font-mono text-muted-foreground">{r.total} uses · {r.unique_users} users</span></div>
            <div className="mt-1 h-2.5 overflow-hidden rounded bg-border"><div className="h-full rounded bg-primary" style={{ width: `${(r.total / max) * 100}%` }} /></div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeatureDetail({ row, state, onClose }: { row: FeatureRow; state: AdminFilterState; onClose: () => void }) {
  const [trend, setTrend] = useState<AdminFeatureTrendPoint[]>([]);
  const [showRaw, setShowRaw] = useState(false);
  useEffect(() => { adminFeatureTrend(row.name, state.resolved.startISO, state.resolved.endISO).then(setTrend); }, [row.name, state.resolved]);
  const trendData = trend.map((t) => ({ day: new Date(`${t.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }), Uses: t.uses }));
  const mobile = row.phone + row.tablet;
  const bar = (label: string, a: number, b: number) => {
    const t = a + b || 1;
    return <div className="text-xs"><div className="flex justify-between"><span>{label}</span><span className="font-mono text-muted-foreground">{a} / {a + b}</span></div>
      <div className="mt-1 h-2 overflow-hidden rounded bg-border"><div className="h-full rounded bg-primary" style={{ width: `${(a / t) * 100}%` }} /></div></div>;
  };
  return (
    <Drawer label={featureLabel(row.name)} onClose={onClose} testId="feature-detail">
      <div className="grid grid-cols-2 gap-2">
        <Mini label="Total uses" value={row.total} />
        <Mini label="Unique users" value={row.unique_users} />
        <Mini label="Per active user" value={row.active ? +(row.total / row.active).toFixed(1) : 0} />
        <Mini label="Last active" value={relTime(row.last_at)} />
      </div>
      <div className="mt-4"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Daily trend</h3>
        <div className="mt-2 h-36"><Suspense fallback={<div className="h-full animate-pulse rounded-xl bg-border/40" />}><AdminTrendChart data={trendData} series={[{ key: "Uses", label: "Uses", color: "hsl(var(--primary))" }]} /></Suspense></div></div>
      <div className="mt-4 space-y-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Breakdown</h3>
        {bar("Free vs Premium", row.free_uses, row.premium_uses)}
        {bar("Mobile vs Desktop", mobile, row.pc)}
      </div>
      <button onClick={() => setShowRaw((s) => !s)} className="mt-4 text-[11px] text-muted-foreground underline-offset-2 hover:underline">{showRaw ? "Hide" : "Show"} technical details</button>
      {showRaw && <p className="mt-1 font-mono text-[11px] text-muted-foreground">event: {row.name} · category: {featureCategory(row.name)}</p>}
    </Drawer>
  );
}
function Mini({ label, value }: { label: string; value: number | string }) {
  return <div className="rounded-xl border border-border bg-card/60 p-2.5"><div className="text-[11px] text-muted-foreground">{label}</div><div className="mt-0.5 font-display text-lg font-semibold">{value}</div></div>;
}

// ===========================================================================
// ENGAGEMENT
// ===========================================================================
export function EngagementPage({ state }: { state: AdminFilterState }) {
  const { resolved, filters, refreshKey } = state;
  const [kpi, setKpi] = useState<AdminKpiSummary | null>(null);
  const [free, setFree] = useState<AdminKpiSummary | null>(null);
  const [prem, setPrem] = useState<AdminKpiSummary | null>(null);
  const [heat, setHeat] = useState<AdminHeatCell[]>([]);
  const [cohorts, setCohorts] = useState<AdminCohortRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true; setStatus("loading");
    const { startISO, endISO } = resolved;
    Promise.all([
      adminKpiSummary(startISO, endISO, "all", filters.device),
      adminKpiSummary(startISO, endISO, "free", filters.device),
      adminKpiSummary(startISO, endISO, "premium", filters.device),
      adminActivityHeatmap(startISO, endISO, filters.plan, filters.device),
      adminRetentionCohorts(8),
    ]).then(([k, f, p, h, c]) => {
      if (!alive) return;
      if (!k) { setStatus("error"); return; }
      setKpi(k); setFree(f); setPrem(p); setHeat(h); setCohorts(c);
      setUpdatedAt(Date.now()); setStatus("ready");
    }).catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [resolved, filters.plan, filters.device, refreshKey]);

  const stickiness = kpi && kpi.mau ? (kpi.dau / kpi.mau) * 100 : 0;
  const returningRate = kpi && kpi.active_users ? (kpi.returning_users / kpi.active_users) * 100 : 0;
  const avgDuration = kpi && kpi.focus_blocks_done ? kpi.focus_minutes / kpi.focus_blocks_done : 0;
  const completion = kpi && kpi.focus_sessions_started ? (kpi.focus_blocks_done / kpi.focus_sessions_started) * 100 : 0;
  const tasksPerUser = kpi && kpi.active_users ? kpi.tasks_completed / kpi.active_users : 0;

  return (
    <div>
      <FilterBar state={state} updatedAt={updatedAt} />
      {status === "error" && <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">Couldn't load engagement analytics.</div>}
      {status === "loading" && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-border/40" />)}</div>}
      {status === "ready" && kpi && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard primary label="DAU" value={kpi.dau} tip="Distinct active users in the last 24h of the window." />
            <KpiCard primary label="WAU" value={kpi.wau} tip="Distinct active users in the trailing 7 days." />
            <KpiCard primary label="MAU" value={kpi.mau} tip="Distinct active users in the trailing 30 days." />
            <KpiCard primary label="Stickiness" value={stickiness} format={(n) => n.toFixed(0)} suffix="%" tip="DAU ÷ MAU." />
            <KpiCard primary label="Returning rate" value={returningRate} format={(n) => n.toFixed(0)} suffix="%" tip="Returning ÷ active users in the window." />
            <KpiCard label="Avg focus / block" value={avgDuration} format={(n) => fmtMinutes(Math.round(n))} tip="Focus minutes ÷ completed blocks." />
            <KpiCard label="Focus completion" value={completion} format={(n) => n.toFixed(0)} suffix="%" tip="Completed blocks ÷ timer starts (throttled — approximate)." />
            <KpiCard label="Tasks / active user" value={tasksPerUser} format={(n) => n.toFixed(1)} tip="Tasks completed ÷ active users." />
            <KpiCard label="New users" value={kpi.new_users} tip="Registered in the window." />
            <KpiCard label="Returning users" value={kpi.returning_users} tip="Active users who registered before the window." />
          </div>

          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-card/70 p-4">
              <h3 className="text-sm font-semibold">Engagement by plan</h3>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <PlanCol label="Free" k={free} />
                <PlanCol label="Premium" k={prem} />
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card/70 p-4">
              <h3 className="text-sm font-semibold">Activity heatmap</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Tracked events by weekday × hour (UTC).</p>
              <Heatmap cells={heat} />
            </div>
          </div>

          <div className="mt-5 rounded-2xl border border-border bg-card/70 p-4">
            <h3 className="text-sm font-semibold">Weekly retention cohorts</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Share of each signup week's users active in later weeks (UTC).</p>
            <CohortGrid rows={cohorts} />
          </div>
        </>
      )}
    </div>
  );
}

function PlanCol({ label, k }: { label: string; k: AdminKpiSummary | null }) {
  const perUser = k && k.active_users ? Math.round(k.focus_minutes / k.active_users) : 0;
  return (
    <div className="rounded-xl border border-border bg-card/60 p-3">
      <div className="text-xs font-semibold">{label}</div>
      <dl className="mt-1.5 space-y-1 text-xs text-muted-foreground">
        <div className="flex justify-between"><dt>Active users</dt><dd className="font-mono text-foreground">{k?.active_users ?? 0}</dd></div>
        <div className="flex justify-between"><dt>Focus min/user</dt><dd className="font-mono text-foreground">{perUser}</dd></div>
        <div className="flex justify-between"><dt>Blocks done</dt><dd className="font-mono text-foreground">{k?.focus_blocks_done ?? 0}</dd></div>
        <div className="flex justify-between"><dt>Tasks done</dt><dd className="font-mono text-foreground">{k?.tasks_completed ?? 0}</dd></div>
      </dl>
    </div>
  );
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function Heatmap({ cells }: { cells: AdminHeatCell[] }) {
  const grid = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    let max = 1;
    cells.forEach((c) => { if (c.dow >= 0 && c.dow < 7 && c.hour >= 0 && c.hour < 24) { g[c.dow][c.hour] = c.events; max = Math.max(max, c.events); } });
    return { g, max };
  }, [cells]);
  if (cells.length === 0) return <p className="mt-3 text-sm text-muted-foreground">No activity in this window.</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <div className="min-w-[520px]">
        {grid.g.map((rowArr, d) => (
          <div key={d} className="flex items-center gap-0.5">
            <span className="w-8 shrink-0 text-[10px] text-muted-foreground">{DOW[d]}</span>
            {rowArr.map((v, h) => (
              <span key={h} title={`${DOW[d]} ${h}:00 — ${v} events`} aria-label={`${DOW[d]} ${h}:00, ${v} events`}
                className="h-3.5 flex-1 rounded-[2px]" style={{ background: v === 0 ? "hsl(var(--border))" : `hsl(var(--primary) / ${0.15 + 0.85 * (v / grid.max)})` }} />
            ))}
          </div>
        ))}
        <div className="mt-1 flex gap-0.5"><span className="w-8 shrink-0" />{Array.from({ length: 24 }).map((_, h) => <span key={h} className="flex-1 text-center text-[8px] text-muted-foreground">{h % 6 === 0 ? h : ""}</span>)}</div>
      </div>
    </div>
  );
}

function CohortGrid({ rows }: { rows: AdminCohortRow[] }) {
  const { weeks, byCohort, maxOffset } = useMemo(() => {
    const byCohort = new Map<string, { size: number; offsets: Map<number, number> }>();
    let maxOffset = 0;
    rows.forEach((r) => {
      if (!byCohort.has(r.cohort_week)) byCohort.set(r.cohort_week, { size: r.cohort_size, offsets: new Map() });
      byCohort.get(r.cohort_week)!.offsets.set(r.week_offset, r.retained);
      maxOffset = Math.max(maxOffset, r.week_offset);
    });
    return { weeks: [...byCohort.keys()].sort(), byCohort, maxOffset };
  }, [rows]);
  if (rows.length === 0) return <p className="mt-3 text-sm text-muted-foreground">Not enough history for cohorts yet.</p>;
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="text-xs">
        <thead><tr className="text-[10px] uppercase text-muted-foreground"><th className="px-2 py-1 text-left">Cohort</th><th className="px-2 py-1">Users</th>{Array.from({ length: maxOffset + 1 }).map((_, i) => <th key={i} className="px-2 py-1">W{i}</th>)}</tr></thead>
        <tbody>
          {weeks.map((w) => {
            const c = byCohort.get(w)!;
            return (
              <tr key={w}>
                <td className="px-2 py-1 text-muted-foreground">{new Date(`${w}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}</td>
                <td className="px-2 py-1 text-center font-mono">{c.size}</td>
                {Array.from({ length: maxOffset + 1 }).map((_, i) => {
                  const r = c.offsets.get(i);
                  if (r == null) return <td key={i} className="px-2 py-1" />;
                  const pct = Math.round((r / c.size) * 100);
                  return <td key={i} className="px-1 py-1"><span className="grid h-6 w-10 place-items-center rounded text-[10px] font-medium" style={{ background: `hsl(var(--primary) / ${0.12 + 0.8 * (pct / 100)})`, color: pct > 55 ? "white" : "inherit" }}>{pct}%</span></td>;
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

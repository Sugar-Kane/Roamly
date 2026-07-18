// Admin BI dashboard — Phase 6: Data Explorer.
// Pick a whitelisted additive metric, bucket by day/week/month, scope by the
// global plan/device filters, then chart + table + export. Read-only, backed
// by the is_admin()-gated admin_explore_metric RPC.

import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { adminExploreMetric, type AdminExplorePoint } from "./db";
import { FilterBar, csvDownload, type AdminFilterState } from "./adminDashboard";
import { EXPLORE_METRICS, exploreMetric, type ExploreGrain } from "./adminMetrics";
import { ThemedSelect } from "./ThemedSelect";

const AdminTrendChart = lazy(() => import("./Charts").then((m) => ({ default: m.AdminTrendChart })));
const AdminStackedBars = lazy(() => import("./Charts").then((m) => ({ default: m.AdminStackedBars })));

const GRAINS: { value: ExploreGrain; label: string }[] = [
  { value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" },
];

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
      <div className="mt-3 h-56">{children}</div>
    </div>
  );
}
const ChartSkeleton = () => <div className="h-full w-full animate-pulse rounded-xl bg-border/40" />;

function bucketLabel(iso: string, grain: ExploreGrain): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (grain === "month") return d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function ExplorerPage({ state }: { state: AdminFilterState }) {
  const { resolved, filters, refreshKey } = state;
  const [metric, setMetric] = useState<string>(() => localStorage.getItem("roamly-admin-explore-metric") || "active_events");
  const [grain, setGrain] = useState<ExploreGrain>(() => (localStorage.getItem("roamly-admin-explore-grain") as ExploreGrain) || "day");
  const [chart, setChart] = useState<"line" | "bar">("bar");
  const [points, setPoints] = useState<AdminExplorePoint[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const meta = exploreMetric(metric);
  const setMetricPersist = (m: string) => { setMetric(m); localStorage.setItem("roamly-admin-explore-metric", m); };
  const setGrainPersist = (g: ExploreGrain) => { setGrain(g); localStorage.setItem("roamly-admin-explore-grain", g); };

  useEffect(() => {
    let alive = true; setStatus("loading");
    const { startISO, endISO } = resolved;
    // Device only affects app_events-derived metrics; pass "all" otherwise so
    // the label doesn't imply a filter that isn't applied.
    const device = meta?.deviceAware ? filters.device : "all";
    adminExploreMetric(metric, startISO, endISO, grain, filters.plan, device)
      .then((p) => { if (!alive) return; setPoints(p); setUpdatedAt(Date.now()); setStatus("ready"); })
      .catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [metric, grain, resolved, filters.plan, filters.device, refreshKey, meta?.deviceAware]);

  const label = meta?.label ?? metric;
  const data = useMemo(() => points.map((p) => ({ day: bucketLabel(p.bucket, grain), [label]: p.value })), [points, grain, label]);
  const total = points.reduce((a, p) => a + p.value, 0);
  const peak = points.reduce((a, p) => Math.max(a, p.value), 0);

  const exportCsv = () => {
    const rows: (string | number)[][] = [["bucket", metric]];
    points.forEach((p) => rows.push([p.bucket, p.value]));
    csvDownload(`roamly-explore-${metric}-${grain}-${resolved.startISO.slice(0, 10)}_${resolved.endISO.slice(0, 10)}.csv`, rows);
  };

  return (
    <div>
      <FilterBar state={state} updatedAt={updatedAt} onExport={exportCsv} />

      {/* Metric + grain controls */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card/70 p-3">
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          Metric
          <ThemedSelect value={metric} onChange={setMetricPersist} ariaLabel="Explorer metric" className="w-52"
            options={EXPLORE_METRICS.map((m) => ({ value: m.key, label: m.label }))} />
        </label>
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        <div className="flex items-center gap-1" role="group" aria-label="Bucket grain">
          {GRAINS.map((g) => (
            <button key={g.value} onClick={() => setGrainPersist(g.value)} aria-pressed={grain === g.value}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${grain === g.value ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40"}`}>
              {g.label}
            </button>
          ))}
        </div>
        <span aria-hidden className="mx-1 h-5 w-px bg-border" />
        <div className="flex items-center gap-1" role="group" aria-label="Chart type">
          {(["bar", "line"] as const).map((c) => (
            <button key={c} onClick={() => setChart(c)} aria-pressed={chart === c}
              className={`rounded-full border px-3 py-1 text-xs font-medium capitalize transition ${chart === c ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40"}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      {meta && <p className="mb-3 text-xs text-muted-foreground">{meta.hint}{!meta.deviceAware ? " The device filter doesn't apply to this metric." : ""}</p>}

      {status === "error" && <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">Couldn't load explorer data.</div>}
      {status === "loading" && <div className="h-56 animate-pulse rounded-2xl bg-border/40" />}
      {status === "ready" && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-card/60 p-3"><div className="text-[11px] text-muted-foreground">Total</div><div className="mt-0.5 font-display text-xl font-semibold tabular-nums">{total.toLocaleString()}</div></div>
            <div className="rounded-xl border border-border bg-card/60 p-3"><div className="text-[11px] text-muted-foreground">Peak {grain}</div><div className="mt-0.5 font-display text-xl font-semibold tabular-nums">{peak.toLocaleString()}</div></div>
            <div className="rounded-xl border border-border bg-card/60 p-3"><div className="text-[11px] text-muted-foreground">Buckets</div><div className="mt-0.5 font-display text-xl font-semibold tabular-nums">{points.length}</div></div>
          </div>

          <ChartCard title={label} subtitle={`Per ${grain} (UTC) · ${filters.plan === "all" ? "all plans" : filters.plan}${meta?.deviceAware && filters.device !== "all" ? ` · ${filters.device}` : ""}.`}>
            {total === 0 ? (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">No data in this window.</div>
            ) : (
              <Suspense fallback={<ChartSkeleton />}>
                {chart === "bar"
                  ? <AdminStackedBars data={data} series={[{ key: label, label, color: "hsl(var(--primary))" }]} />
                  : <AdminTrendChart data={data} series={[{ key: label, label, color: "hsl(var(--primary))" }]} />}
              </Suspense>
            )}
          </ChartCard>

          {/* Data table */}
          <div className="mt-4 overflow-x-auto rounded-2xl border border-border">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-card/80 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">Bucket</th>
                <th className="px-3 py-2 text-right font-medium">{label}</th>
              </tr></thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.bucket} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-1.5">{bucketLabel(p.bucket, grain)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{p.value.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

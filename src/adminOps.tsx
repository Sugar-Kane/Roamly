// Admin BI dashboard — Phase 5: operational views (Invites + Errors).
// Read-only, is_admin()-gated data via db.ts. Invites gets a proper volume +
// acceptance view; Errors gets a grouped "top recurring" summary and a trend
// on top of the existing raw log. Feedback and Ads keep their working inboxes
// (rendered elsewhere in Admin.tsx).

import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  adminInviteSummary, adminInviteSeries, adminErrorGroups, adminErrorSeries, adminListErrors,
  type AdminInviteSummary, type AdminInviteDay, type AdminErrorGroup, type AdminErrorDay, type ErrorRow,
} from "./db";
import { FilterBar, KpiCard, csvDownload, type AdminFilterState } from "./adminDashboard";
import { ratePct } from "./adminMetrics";

const AdminTrendChart = lazy(() => import("./Charts").then((m) => ({ default: m.AdminTrendChart })));

function relTime(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>
      <div className="mt-3 h-40">{children}</div>
    </div>
  );
}
const ChartSkeleton = () => <div className="h-full w-full animate-pulse rounded-xl bg-border/40" />;

// ===========================================================================
// INVITES
// ===========================================================================
export function InvitesPage({ state }: { state: AdminFilterState }) {
  const { resolved, filters, refreshKey } = state;
  const [cur, setCur] = useState<AdminInviteSummary | null>(null);
  const [prev, setPrev] = useState<AdminInviteSummary | null>(null);
  const [series, setSeries] = useState<AdminInviteDay[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true; setStatus("loading");
    const { startISO, endISO, prevStartISO, prevEndISO } = resolved;
    Promise.all([
      adminInviteSummary(startISO, endISO),
      filters.compare ? adminInviteSummary(prevStartISO, prevEndISO) : Promise.resolve(null),
      adminInviteSeries(startISO, endISO),
    ]).then(([c, p, s]) => {
      if (!alive) return;
      if (!c) { setStatus("error"); return; }
      setCur(c); setPrev(p); setSeries(s);
      setUpdatedAt(Date.now()); setStatus("ready");
    }).catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [resolved, filters.compare, refreshKey]);

  const trend = useMemo(() => series.map((d) => ({
    day: new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
    Sent: d.sent, Accepted: d.accepted,
  })), [series]);

  const exportCsv = () => {
    if (!cur) return;
    const rows: (string | number)[][] = [["metric", "value"]];
    (Object.keys(cur) as (keyof AdminInviteSummary)[]).forEach((k) => rows.push([k, cur[k]]));
    rows.push([]); rows.push(["day", "sent", "accepted"]);
    series.forEach((d) => rows.push([d.day, d.sent, d.accepted]));
    csvDownload(`roamly-invites-${resolved.startISO.slice(0, 10)}_${resolved.endISO.slice(0, 10)}.csv`, rows);
  };

  const P = (k: keyof AdminInviteSummary) => (filters.compare && prev ? prev[k] : undefined);
  const windowRate = cur ? ratePct(cur.accepted_in_window, cur.sent_in_window) : 0;

  return (
    <div>
      <FilterBar state={state} updatedAt={updatedAt} onExport={exportCsv} />
      {status === "error" && <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">Couldn't load invite analytics.</div>}
      {status === "loading" && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-border/40" />)}</div>}
      {status === "ready" && cur && (
        <>
          <section aria-label="Invite totals">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">All-time (as of window end)</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <KpiCard primary label="Total invites" value={cur.total_invites} prev={P("total_invites")} tip="All invitations created on or before the window end." />
              <KpiCard primary label="Accepted" value={cur.accepted} prev={P("accepted")} tip="Invitations whose recipient has since joined (invited_user_id is set)." />
              <KpiCard primary label="Acceptance rate" value={ratePct(cur.accepted, cur.total_invites)} format={(n) => n.toFixed(0)} suffix="%" tip="Accepted ÷ total invitations, all-time." />
              <KpiCard primary label="Unique inviters" value={cur.unique_inviters} prev={P("unique_inviters")} tip="Distinct users who have sent at least one invite." />
            </div>
          </section>

          <section className="mt-5" aria-label="Invites in window">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">In this window</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <KpiCard label="Invites sent" value={cur.sent_in_window} prev={P("sent_in_window")} tip="Invitations created within the window (UTC)." />
              <KpiCard label="Accepted (cohort)" value={cur.accepted_in_window} prev={P("accepted_in_window")} tip="Of invites sent in this window, how many have since been accepted. Cohort-based — invitations have no accept timestamp." />
              <KpiCard label="Cohort acceptance" value={windowRate} format={(n) => n.toFixed(0)} suffix="%" tip="Accepted ÷ sent for invitations created in this window." />
              <KpiCard label="Still pending" value={cur.pending} prev={P("pending")} tip="All-time invitations with no recipient yet (invited_user_id is null)." />
            </div>
          </section>

          <section className="mt-5" aria-label="Invite trend">
            <ChartCard title="Invites sent vs accepted" subtitle="Per day by invite creation date (UTC). Accepted is cohort-based.">
              <Suspense fallback={<ChartSkeleton />}><AdminTrendChart data={trend} series={[{ key: "Sent", label: "Sent", color: "hsl(var(--primary))" }, { key: "Accepted", label: "Accepted", color: "hsl(var(--primary) / 0.4)" }]} /></Suspense>
            </ChartCard>
          </section>
        </>
      )}
    </div>
  );
}

// ===========================================================================
// ERRORS
// ===========================================================================
export function ErrorsPage({ state }: { state: AdminFilterState }) {
  const { resolved, refreshKey } = state;
  const [groups, setGroups] = useState<AdminErrorGroup[]>([]);
  const [series, setSeries] = useState<AdminErrorDay[]>([]);
  const [recent, setRecent] = useState<ErrorRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [openStack, setOpenStack] = useState<string | null>(null);

  useEffect(() => {
    let alive = true; setStatus("loading");
    const { startISO, endISO } = resolved;
    Promise.all([
      adminErrorGroups(startISO, endISO, 50),
      adminErrorSeries(startISO, endISO),
      adminListErrors(100),
    ]).then(([g, s, r]) => {
      if (!alive) return;
      setGroups(g); setSeries(s); setRecent(r);
      setUpdatedAt(Date.now()); setStatus("ready");
    }).catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [resolved, refreshKey]);

  const trend = useMemo(() => series.map((d) => ({
    day: new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
    Errors: d.errors, Users: d.affected_users,
  })), [series]);
  const totalInWindow = series.reduce((a, d) => a + d.errors, 0);

  const exportCsv = () => {
    const rows: (string | number)[][] = [["message", "page", "occurrences", "affected_users", "first_seen", "last_seen"]];
    groups.forEach((g) => rows.push([g.message, g.page, g.occurrences, g.affected_users, g.first_seen, g.last_seen]));
    csvDownload(`roamly-errors-${resolved.startISO.slice(0, 10)}_${resolved.endISO.slice(0, 10)}.csv`, rows);
  };

  return (
    <div>
      <FilterBar state={state} updatedAt={updatedAt} onExport={exportCsv} />
      {status === "error" && <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">Couldn't load error analytics.</div>}
      {status === "loading" && <div className="h-40 animate-pulse rounded-2xl bg-border/40" />}
      {status === "ready" && (
        <>
          {totalInWindow === 0 && groups.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border bg-card/60 p-4 text-sm text-roamly-green">No client errors in this window. 🎉</p>
          ) : (
            <ChartCard title="Errors over time" subtitle={`${totalInWindow} error${totalInWindow === 1 ? "" : "s"} in this window — daily volume and distinct affected users (UTC).`}>
              <Suspense fallback={<ChartSkeleton />}><AdminTrendChart data={trend} series={[{ key: "Errors", label: "Errors", color: "hsl(var(--destructive))" }, { key: "Users", label: "Affected users", color: "hsl(var(--primary) / 0.5)" }]} /></Suspense>
            </ChartCard>
          )}

          {groups.length > 0 && (
            <section className="mt-5" aria-label="Top recurring errors">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Top recurring errors</h2>
              <div className="space-y-2">
                {groups.map((g, i) => (
                  <div key={i} className="rounded-xl border border-border bg-card/70 p-3">
                    <div className="flex items-start gap-2">
                      <span className="break-words text-sm font-medium text-destructive">{g.message}</span>
                      <span className="ml-auto shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">×{g.occurrences}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {g.affected_users} user{g.affected_users === 1 ? "" : "s"}
                      {g.page ? ` · on ${g.page}` : ""} · first {relTime(g.first_seen)} · last {relTime(g.last_seen)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {recent.length > 0 && (
            <section className="mt-5" aria-label="Recent error log">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent log</h2>
              <div className="space-y-2">
                {recent.map((e) => (
                  <div key={e.id} className="rounded-2xl border border-border bg-card/70 p-4">
                    <div className="flex items-start gap-2">
                      <span className="break-words text-sm font-medium text-destructive">{e.message}</span>
                      <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{new Date(e.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
                    </div>
                    <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                      {e.email ?? "unknown"}{e.username ? ` · @${e.username}` : ""}{e.page ? ` · on ${e.page}` : ""}{e.device ? ` · ${e.device}` : ""}
                    </p>
                    {e.platform && <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{e.platform}</p>}
                    {e.stack && (
                      <>
                        <button onClick={() => setOpenStack(openStack === e.id ? null : e.id)}
                          className="mt-2 text-[11px] text-primary underline-offset-2 hover:underline">
                          {openStack === e.id ? "Hide" : "Show"} details
                        </button>
                        {openStack === e.id && (
                          <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg border border-border bg-background/60 p-2.5 text-[10px] leading-snug text-muted-foreground">{e.stack}</pre>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// Bug Intelligence — the operator surface for the self-healing platform.
//
// Design intent: this page exists to make ONE decision fast — "ship this fix or
// not". Everything else is supporting evidence, reachable by drilling in but
// never in the way. The list is ordered so that anything waiting on a human
// sits at the top, because a patch nobody notices is worse than no patch.
//
// Security: every read here is an is_admin()-gated RPC and every consequential
// write goes through /api/selfheal (op: "action"). Rendering is gated on isAdmin by
// AdminView before this component ever mounts, but that is defence in depth,
// not the control — the control is server-side.

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lazyChunk } from "./lazyChunk";
import {
  AlertTriangle, CheckCircle2, XCircle, GitPullRequest, Sparkles, Play, RotateCcw,
  ShieldAlert, Clock, Users, Activity, ChevronRight, ExternalLink, Power, Search,
} from "lucide-react";
import {
  shOverview, shIncidents, shIncidentDetail, shFeatureHealth, shIncidentSeries,
  shSetIncident, shFlags, shSetFlag, shAction, shInvestigate,
  type ShOverview, type ShIncident, type ShFeatureHealth, type ShIncidentDay,
  type ShFlag, type ShSeverity, type ShApprovalLevel,
} from "./db";
import { FilterBar, KpiCard, csvDownload, type AdminFilterState } from "./adminDashboard";
import { Modal } from "./Modal";
import { ThemedSelect } from "./ThemedSelect";

const AdminTrendChart = lazyChunk(() => import("./Charts").then((m) => ({ default: m.AdminTrendChart })));

const SEVERITY_STYLE: Record<ShSeverity, string> = {
  critical: "bg-destructive/15 text-destructive",
  high: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  medium: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  low: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  info: "bg-secondary text-muted-foreground",
};

const LEVEL_STYLE: Record<ShApprovalLevel, string> = {
  auto: "bg-roamly-green/10 text-roamly-green",
  pr_only: "bg-primary/10 text-primary",
  manual: "bg-destructive/10 text-destructive",
};

const LEVEL_LABEL: Record<ShApprovalLevel, string> = {
  auto: "L1 · auto-deploy",
  pr_only: "L2 · pull request",
  manual: "L3 · engineer review",
};

const STATUS_ORDER = [
  "detected", "investigating", "diagnosed", "reproducing", "patch_proposed",
  "awaiting_approval", "approved", "deploying", "verifying", "resolved",
  "rejected", "ignored", "regressed",
];

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function fmtDuration(seconds: number): string {
  if (!seconds) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function pct(v: number): string {
  return v ? `${(v * 100).toFixed(1)}%` : "—";
}

/** Nullable variant for table cells, where 0 and "no data" must read differently. */
function pctOrDash(v: number | null): string {
  return v == null ? "—" : `${(v * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------

export function SelfHealingPage({ state }: { state: AdminFilterState }) {
  const { resolved, refreshKey } = state;
  const [overview, setOverview] = useState<ShOverview | null>(null);
  const [incidents, setIncidents] = useState<ShIncident[]>([]);
  const [health, setHealth] = useState<ShFeatureHealth[]>([]);
  const [series, setSeries] = useState<ShIncidentDay[]>([]);
  const [flags, setFlags] = useState<ShFlag[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [openIncident, setOpenIncident] = useState<string | null>(null);
  const [tab, setTab] = useState<"incidents" | "health" | "flags">("incidents");
  const [filterStatus, setFilterStatus] = useState<string>("active");
  const [filterSeverity, setFilterSeverity] = useState<string>("");
  const [search, setSearch] = useState("");
  const [localRefresh, setLocalRefresh] = useState(0);

  const load = useCallback(() => {
    const { startISO, endISO } = resolved;
    setStatus("loading");
    Promise.all([
      shOverview(startISO, endISO),
      shIncidents({
        status: filterStatus === "active" ? null : filterStatus,
        severity: filterSeverity || null,
        search,
        limit: 60,
      }),
      shFeatureHealth(startISO, endISO),
      shIncidentSeries(startISO, endISO),
      shFlags(),
    ]).then(([o, i, h, s, f]) => {
      setOverview(o);
      // "active" is a client-side concern (the RPC filters by one exact status),
      // so the closed states are dropped here rather than adding a fourth
      // parameter to the RPC for a view preference.
      setIncidents(filterStatus === "active"
        ? i.filter((x) => !["resolved", "ignored", "rejected"].includes(x.status))
        : i);
      setHealth(h); setSeries(s); setFlags(f);
      setUpdatedAt(Date.now()); setStatus("ready");
    }).catch(() => setStatus("error"));
  }, [resolved, filterStatus, filterSeverity, search]);

  useEffect(() => { load(); }, [load, refreshKey, localRefresh]);

  const trend = useMemo(() => series.map((d) => ({
    day: new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
    Opened: d.opened, Resolved: d.resolved,
  })), [series]);

  const awaiting = incidents.filter((i) => i.has_patch && i.status !== "resolved");

  const exportCsv = () => {
    const rows: (string | number)[][] = [["title", "severity", "status", "level", "occurrences", "users", "route", "first_seen", "confidence"]];
    incidents.forEach((i) => rows.push([
      i.title, i.severity, i.status, i.approval_level, i.occurrences, i.affected_users,
      i.route ?? "", i.first_seen_at, i.ai_confidence ?? "",
    ]));
    csvDownload(`roamly-incidents-${resolved.startISO.slice(0, 10)}.csv`, rows);
  };

  return (
    <div>
      <FilterBar state={state} updatedAt={updatedAt} onExport={exportCsv} />

      {status === "error" && (
        <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          Couldn't load incident data. The self-healing migration may not be applied yet.
        </div>
      )}

      {status !== "error" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Open incidents" value={overview?.open_incidents ?? 0} primary
              tip="Incidents not resolved, ignored, or rejected." />
            <KpiCard label="Critical" value={overview?.critical_incidents ?? 0}
              tip="Open incidents at critical severity — these page a human." />
            <KpiCard label="Affected users" value={overview?.affected_users ?? 0}
              tip="Distinct users who hit an incident in this window." />
            <KpiCard label="Awaiting approval" value={overview?.awaiting_approval ?? 0}
              tip="Patches with passing CI, waiting on a human decision." />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard label="Mean time to detect" value={overview?.mttd_seconds ?? 0} format={fmtDuration}
              tip="First occurrence → incident opened. The headline number: how long a bug lives before the platform notices it." />
            <KpiCard label="Mean time to repair" value={overview?.mttr_seconds ?? 0} format={fmtDuration}
              tip="First occurrence → incident resolved." />
            <KpiCard label="Feature success rate" value={overview?.outcome_success_rate ?? 0} format={pct}
              tip="Share of feature attempts that reached their declared outcome. This falls before users complain." />
            <KpiCard label="Journey completion" value={overview?.journey_completion_rate ?? 0} format={pct}
              tip="Share of started journeys that finished every required step." />
          </div>

          {awaiting.length > 0 && (
            <section className="mt-5 rounded-2xl border border-primary/40 bg-primary/5 p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-primary">
                <GitPullRequest className="h-4 w-4" aria-hidden />
                {awaiting.length} fix{awaiting.length === 1 ? "" : "es"} waiting on you
              </h2>
              <div className="mt-2 space-y-1.5">
                {awaiting.slice(0, 4).map((i) => (
                  <button key={i.id} onClick={() => setOpenIncident(i.id)}
                    className="flex w-full items-center gap-2 rounded-xl border border-border bg-card/70 px-3 py-2 text-left text-sm transition hover:border-primary/50">
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${LEVEL_STYLE[i.approval_level]}`}>
                      {LEVEL_LABEL[i.approval_level]}
                    </span>
                    <span className="truncate">{i.title}</span>
                    <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="mt-5 flex flex-wrap gap-1.5" role="tablist" aria-label="Bug intelligence views">
            {([["incidents", "Incidents", AlertTriangle], ["health", "Feature health", Activity], ["flags", "Flags", Power]] as const).map(([id, label, Icon]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                  tab === id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 text-muted-foreground hover:border-primary/40"
                }`}>
                <Icon className="h-3.5 w-3.5" aria-hidden />{label}
              </button>
            ))}
          </div>

          {tab === "incidents" && (
            <>
              {trend.length > 1 && (
                <div className="mt-4 rounded-2xl border border-border bg-card/70 p-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Incidents over time</h3>
                  {/* AdminTrendChart is h-full over a ResponsiveContainer at
                      height="100%", so it needs an ancestor with a real height
                      or it collapses to zero and renders an empty card — its
                      only other output, ChartTable, is sr-only. Every other
                      call site gets this from ChartCard's h-44; this one is a
                      hand-rolled card, so it has to supply the height itself. */}
                  <div className="mt-3 h-44">
                    <Suspense fallback={<div className="h-full w-full animate-pulse rounded-xl bg-border/40" />}>
                      <AdminTrendChart data={trend} series={[
                        { key: "Opened", label: "Opened", color: "hsl(var(--destructive))" },
                        { key: "Resolved", label: "Resolved", color: "hsl(var(--primary))" },
                      ]} />
                    </Suspense>
                  </div>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <label className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <input value={search} onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search incidents…" aria-label="Search incidents"
                    className="rounded-full border border-border bg-card/70 py-1 pl-8 pr-3 text-xs" />
                </label>
                <ThemedSelect value={filterStatus} onChange={setFilterStatus} ariaLabel="Filter by status"
                  options={[{ value: "active", label: "Active" }, ...STATUS_ORDER.map((s) => ({ value: s, label: s.replace(/_/g, " ") }))]} />
                <ThemedSelect value={filterSeverity} onChange={setFilterSeverity} ariaLabel="Filter by severity"
                  options={[{ value: "", label: "Any severity" }, ...(["critical", "high", "medium", "low", "info"] as ShSeverity[]).map((s) => ({ value: s, label: s }))]} />
              </div>

              <div className="mt-3 space-y-2">
                {status === "loading" && <div className="h-40 animate-pulse rounded-2xl bg-border/40" />}
                {status === "ready" && incidents.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-border bg-card/60 p-4 text-sm text-roamly-green">
                    No incidents match. Every monitored feature is meeting its contract. 🎉
                  </p>
                )}
                {incidents.map((incident) => (
                  <IncidentRow key={incident.id} incident={incident} onOpen={() => setOpenIncident(incident.id)} />
                ))}
              </div>
            </>
          )}

          {tab === "health" && <FeatureHealthTable rows={health} />}
          {tab === "flags" && <FlagTable flags={flags} onChanged={() => setLocalRefresh((n) => n + 1)} />}
        </>
      )}

      {openIncident && (
        <IncidentDetail id={openIncident} onClose={() => setOpenIncident(null)}
          onChanged={() => { setLocalRefresh((n) => n + 1); }} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function IncidentRow({ incident, onOpen }: { incident: ShIncident; onOpen: () => void }) {
  return (
    <button onClick={onOpen}
      className="flex w-full flex-col gap-1.5 rounded-xl border border-border bg-card/70 p-3 text-left transition hover:border-primary/50">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${SEVERITY_STYLE[incident.severity]}`}>
          {incident.severity}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${LEVEL_STYLE[incident.approval_level]}`}>
          {LEVEL_LABEL[incident.approval_level]}
        </span>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium capitalize text-muted-foreground">
          {incident.status.replace(/_/g, " ")}
        </span>
        {incident.has_diagnosis && incident.ai_confidence != null && (
          <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Sparkles className="h-2.5 w-2.5" aria-hidden />{Math.round(incident.ai_confidence * 100)}% confident
          </span>
        )}
        {incident.pr_url && (
          <span className="flex items-center gap-1 rounded-full bg-roamly-green/10 px-2 py-0.5 text-[10px] font-semibold text-roamly-green">
            <GitPullRequest className="h-2.5 w-2.5" aria-hidden />PR open
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">{relTime(incident.last_seen_at)}</span>
      </div>
      <span className="break-words text-sm font-medium">{incident.title}</span>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><Users className="h-3 w-3" aria-hidden />{incident.affected_users} users</span>
        <span className="flex items-center gap-1"><Activity className="h-3 w-3" aria-hidden />×{incident.occurrences}</span>
        {incident.route && <span className="rounded bg-secondary px-1.5 py-0.5 font-mono">{incident.route}</span>}
        <span className="ml-auto font-mono">priority {incident.priority_score}</span>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------

function IncidentDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(() => {
    shIncidentDetail(id).then(setDetail);
  }, [id]);

  useEffect(() => { reload(); }, [reload]);

  const incident = detail?.incident as Record<string, unknown> | undefined;
  const diagnosis = detail?.diagnosis as Record<string, unknown> | undefined;
  const patches = (detail?.patches ?? []) as Record<string, unknown>[];
  const repro = (detail?.repro ?? []) as Record<string, unknown>[];
  const timeline = (detail?.timeline ?? []) as Record<string, unknown>[];
  const similar = (detail?.similar ?? []) as Record<string, unknown>[];
  const patch = patches[0];

  // Tracks whether this dialog is still on screen, so a request that outlives
  // it cannot act on the one that replaced it.
  const aliveRef = useRef(true);
  useEffect(() => () => { aliveRef.current = false; }, []);

  // `closeOnDone` marks the actions that END this incident — resolving it or
  // ignoring it. Everything else (investigate, repro, propose, reject a patch,
  // roll back) leaves the incident open and its result is meant to be read
  // here, so those keep the modal up and refresh it in place. Without the
  // distinction a resolved incident sat in an open dialog looking unfinished,
  // and the obvious response was to click Resolve again.
  const run = async (
    label: string,
    fn: () => Promise<{ error?: string }>,
    opts?: { closeOnDone?: boolean },
  ) => {
    setBusy(label); setMessage(null);
    const result = await fn();
    // The dialog may already be gone — dismissed with Escape or the backdrop
    // while this request was in flight. onClose() is the parent's unconditional
    // "close whatever is open", so calling it now would shut a DIFFERENT
    // incident the operator has since opened. Refresh the list and stop.
    if (!aliveRef.current) { onChanged(); return; }
    setBusy(null);
    if (!result.error && opts?.closeOnDone) {
      onChanged();  // refresh the list behind us; skip reload(), this is unmounting
      onClose();
      return;
    }
    setMessage(result.error ?? `${label} done.`);
    reload(); onChanged();
  };

  return (
    <Modal label={String(incident?.title ?? "Incident")} onClose={onClose}
      cardClassName="w-full max-w-2xl max-h-[85dvh] overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-xl">
      <h2 className="mb-3 pr-8 font-display text-lg font-semibold">{String(incident?.title ?? "Incident")}</h2>
      {!detail && <div className="h-40 animate-pulse rounded-xl bg-border/40" />}
      {detail && (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${SEVERITY_STYLE[String(incident?.severity ?? "info") as ShSeverity]}`}>
              {String(incident?.severity)}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${LEVEL_STYLE[String(incident?.approval_level ?? "manual") as ShApprovalLevel]}`}>
              {LEVEL_LABEL[String(incident?.approval_level ?? "manual") as ShApprovalLevel]}
            </span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] capitalize text-muted-foreground">
              {String(incident?.status).replace(/_/g, " ")}
            </span>
          </div>

          <dl className="grid grid-cols-2 gap-2 rounded-xl border border-border bg-card/60 p-3 text-[11px] sm:grid-cols-4">
            <Stat label="Users" value={String(incident?.affected_users ?? 0)} />
            <Stat label="Occurrences" value={String(incident?.occurrences ?? 0)} />
            <Stat label="Route" value={String(incident?.route ?? "—")} />
            <Stat label="First seen" value={relTime(String(incident?.first_seen_at ?? new Date().toISOString()))} />
          </dl>

          {String(incident?.approval_level) === "manual" && (
            <p className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                <strong>Level 3.</strong> This touches a protected surface — payments, authentication,
                authorization, RLS, schema, email, or secrets. The platform will never deploy it
                automatically. Review the diff on GitHub and merge by hand.
              </span>
            </p>
          )}

          <Section title="Root cause" icon={Sparkles}>
            {diagnosis ? (
              <>
                <p className="font-medium">{String(diagnosis.root_cause)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{String(diagnosis.reasoning ?? "")}</p>
                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                  <span>Confidence <strong className="text-foreground">{Math.round(Number(diagnosis.confidence) * 100)}%</strong></span>
                  <span>Regression risk <strong className="text-foreground">{String(diagnosis.regression_risk)}</strong></span>
                  <span>Model <code>{String(diagnosis.model)}</code></span>
                </div>
                {Array.isArray(diagnosis.alternatives) && (diagnosis.alternatives as unknown[]).length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Alternative hypotheses considered</summary>
                    <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                      {(diagnosis.alternatives as Record<string, unknown>[]).map((alt, i) => (
                        <li key={i}>• {String(alt.hypothesis)} — {Math.round(Number(alt.confidence ?? 0) * 100)}%{alt.disproved_by ? ` (ruled out: ${String(alt.disproved_by)})` : ""}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Not analysed yet.</p>
            )}
          </Section>

          {repro.length > 0 && (
            <Section title="Reproduction" icon={Play}>
              {repro.map((r, i) => (
                <div key={i} className="text-xs">
                  Attempt {String(r.attempt)} — <strong>{r.reproduced ? "reproduced" : "not reproduced"}</strong>
                  {r.test_path ? <> · <code>{String(r.test_path)}</code></> : null}
                </div>
              ))}
            </Section>
          )}

          {patch && (
            <Section title="Proposed fix" icon={GitPullRequest}>
              <p className="font-medium">{String(patch.summary)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{String(patch.explanation ?? "")}</p>
              {patch.github_pr_url ? (
                <a href={String(patch.github_pr_url)} target="_blank" rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                  View pull request <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              ) : null}
              {patch.diff ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Diff</summary>
                  <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-secondary p-2 text-[10px]">{String(patch.diff)}</pre>
                </details>
              ) : null}
            </Section>
          )}

          {similar.length > 0 && (
            <Section title="We've seen this before" icon={Clock}>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {similar.map((s, i) => (
                  <li key={i}>• <strong className="text-foreground">{String(s.title)}</strong> — {String(s.fix_summary ?? s.root_cause)}</li>
                ))}
              </ul>
            </Section>
          )}

          {timeline.length > 0 && (
            <details>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">Audit trail</summary>
              <ol className="mt-2 space-y-1 text-[11px] text-muted-foreground">
                {timeline.map((t, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="font-mono">{relTime(String(t.at))}</span>
                    <span className="font-medium text-foreground">{String(t.action)}</span>
                    <span>by {String(t.actor) === "ai" ? "AI" : String(t.actor) === "system" ? "system" : "admin"}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}

          {message && <p className="rounded-lg bg-secondary p-2 text-xs text-muted-foreground">{message}</p>}

          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {!diagnosis && (
              <Action label="Investigate" icon={Sparkles} busy={busy === "Investigate"}
                onClick={() => run("Investigate", () => shInvestigate(id, "investigate"))} />
            )}
            {diagnosis && repro.length === 0 && (
              <Action label="Write repro test" icon={Play} busy={busy === "Reproduce"}
                onClick={() => run("Reproduce", () => shInvestigate(id, "reproduce"))} />
            )}
            {diagnosis && !patch && (
              <Action label="Propose fix" icon={GitPullRequest} busy={busy === "Propose fix"}
                onClick={() => run("Propose fix", () => shInvestigate(id, "patch"))} />
            )}
            {patch && String(patch.status) !== "approved" && String(patch.status) !== "deployed" && (
              <>
                <Action label="Approve" icon={CheckCircle2} primary busy={busy === "Approve"}
                  onClick={() => run("Approve", () => shAction("approve", { patchId: String(patch.id) }))} />
                <Action label="Reject" icon={XCircle} busy={busy === "Reject"}
                  onClick={() => run("Reject", () => shAction("reject", { patchId: String(patch.id), reason: "rejected from dashboard" }))} />
              </>
            )}
            {patch && String(patch.status) === "deployed" && (
              <Action label="Roll back" icon={RotateCcw} busy={busy === "Roll back"}
                onClick={() => run("Roll back", () => shAction("rollback", { patchId: String(patch.id), reason: "rolled back from dashboard" }))} />
            )}
            <Action label="Mark resolved" icon={CheckCircle2} busy={busy === "Resolve"}
              onClick={() => run("Resolve", () => shSetIncident(id, { status: "resolved", resolution: "patched" }), { closeOnDone: true })} />
            <Action label="Ignore" icon={XCircle} busy={busy === "Ignore"}
              onClick={() => run("Ignore", () => shAction("ignore", { incidentId: id, reason: "not a bug" }), { closeOnDone: true })} />
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Sparkles; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card/60 p-3">
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden />{title}
      </h3>
      {children}
    </section>
  );
}

function Action({ label, icon: Icon, onClick, busy, primary }: {
  label: string; icon: typeof Sparkles; onClick: () => void; busy?: boolean; primary?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={busy}
      className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
        primary ? "gradient-primary text-white shadow-glow" : "border border-border bg-card/70 hover:border-primary/50"
      }`}>
      <Icon className="h-3.5 w-3.5" aria-hidden />{busy ? "Working…" : label}
    </button>
  );
}

// ---------------------------------------------------------------------------

function FeatureHealthTable({ rows }: { rows: ShFeatureHealth[] }) {
  if (!rows.length) {
    return (
      <p className="mt-4 rounded-2xl border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">
        No outcome data in this window yet. Feature health appears once the SDK reports contract attempts.
      </p>
    );
  }
  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-border bg-card/70">
      <table className="w-full min-w-[560px] text-sm">
        <caption className="sr-only">Feature outcome success rates against their contract floors</caption>
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="p-2.5">Feature</th>
            <th scope="col" className="p-2.5 text-right">Attempts</th>
            <th scope="col" className="p-2.5 text-right">Success</th>
            <th scope="col" className="p-2.5 text-right">Floor</th>
            <th scope="col" className="p-2.5 text-right">p95</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const breached = r.success_rate != null && r.success_rate < r.floor_rate;
            return (
              <tr key={r.contract_key} className="border-b border-border/50 last:border-0">
                <td className="p-2.5">
                  <div className="font-medium">{r.label}</div>
                  <code className="text-[10px] text-muted-foreground">{r.contract_key}</code>
                </td>
                <td className="p-2.5 text-right tabular-nums">{r.attempts}</td>
                <td className={`p-2.5 text-right font-semibold tabular-nums ${breached ? "text-destructive" : "text-roamly-green"}`}>
                  {pctOrDash(r.success_rate)}
                </td>
                <td className="p-2.5 text-right tabular-nums text-muted-foreground">{pctOrDash(r.floor_rate)}</td>
                <td className="p-2.5 text-right tabular-nums text-muted-foreground">{r.p95_ms == null ? "—" : `${r.p95_ms}ms`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function FlagTable({ flags, onChanged }: { flags: ShFlag[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (flag: ShFlag) => {
    setBusy(flag.key);
    await shSetFlag(flag.key, { enabled: !flag.enabled, reason: "toggled from dashboard" });
    setBusy(null);
    onChanged();
  };

  if (!flags.length) {
    return <p className="mt-4 rounded-2xl border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">No flags configured.</p>;
  }

  return (
    <div className="mt-4 space-y-2">
      <p className="rounded-xl border border-border bg-card/60 p-3 text-xs text-muted-foreground">
        Turning a flag off is the fastest remediation available — it reaches every user within a
        minute and needs no deploy. Flags with an auto-rollback threshold disable themselves when
        their surface's error rate crosses it.
      </p>
      {flags.map((flag) => (
        <div key={flag.key} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/70 p-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium">{flag.label}</span>
              <code className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{flag.key}</code>
              {flag.rollout_percent < 100 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  {flag.rollout_percent}% rollout
                </span>
              )}
              {flag.auto_disabled_at && (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                  auto-disabled
                </span>
              )}
            </div>
            {flag.description && <p className="mt-0.5 text-xs text-muted-foreground">{flag.description}</p>}
            {flag.auto_disabled_reason && (
              <p className="mt-0.5 text-[11px] text-destructive">{flag.auto_disabled_reason}</p>
            )}
          </div>
          <button onClick={() => toggle(flag)} disabled={busy === flag.key}
            aria-pressed={flag.enabled}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
              flag.enabled ? "bg-roamly-green/15 text-roamly-green" : "bg-destructive/15 text-destructive"
            }`}>
            {busy === flag.key ? "…" : flag.enabled ? "Enabled" : "Disabled"}
          </button>
        </div>
      ))}
    </div>
  );
}

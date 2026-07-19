// Admin BI dashboard — Phase 4: Revenue & conversion page.
// Every money figure here is an ESTIMATE derived from existing tables
// (premium_entitlements + credit_ledger) at published list prices — NO Stripe
// call. The banner and per-tile tooltips say so; Stripe remains the source of
// truth for net revenue and is intentionally out of scope pending approval.

import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import {
  adminRevenueSummary, adminRevenueSeries, adminConversionFunnel, adminStripeRevenue,
  type AdminRevenueSummary, type AdminRevenueDay, type AdminFunnel, type AdminStripeRevenue,
} from "./db";
import { FilterBar, KpiCard, csvDownload, type AdminFilterState } from "./adminDashboard";
import { fmtCents } from "./adminMetrics";

const AdminTrendChart = lazy(() => import("./Charts").then((m) => ({ default: m.AdminTrendChart })));

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

function RevenueFunnel({ funnel }: { funnel: AdminFunnel | null }) {
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

export function RevenuePage({ state }: { state: AdminFilterState }) {
  const { resolved, filters, refreshKey } = state;
  const [cur, setCur] = useState<AdminRevenueSummary | null>(null);
  const [prev, setPrev] = useState<AdminRevenueSummary | null>(null);
  const [series, setSeries] = useState<AdminRevenueDay[]>([]);
  const [funnel, setFunnel] = useState<AdminFunnel | null>(null);
  const [stripe, setStripe] = useState<AdminStripeRevenue | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true; setStatus("loading");
    const { startISO, endISO, prevStartISO, prevEndISO } = resolved;
    Promise.all([
      adminRevenueSummary(startISO, endISO),
      filters.compare ? adminRevenueSummary(prevStartISO, prevEndISO) : Promise.resolve(null),
      adminRevenueSeries(startISO, endISO),
      adminConversionFunnel(startISO, endISO),
    ]).then(([c, p, s, f]) => {
      if (!alive) return;
      if (!c) { setStatus("error"); return; }
      setCur(c); setPrev(p); setSeries(s); setFunnel(f);
      setUpdatedAt(Date.now()); setStatus("ready");
    }).catch(() => { if (alive) setStatus("error"); });
    // Authoritative Stripe figures load independently: if Stripe isn't
    // configured (or the call fails), the page keeps its estimates.
    adminStripeRevenue(resolved.startISO, resolved.endISO).then((r) => {
      if (alive) setStripe(r.configured && r.data ? r.data : null);
    });
    return () => { alive = false; };
  }, [resolved, filters.compare, refreshKey]);

  const trend = useMemo(() => series.map((d) => ({
    day: new Date(`${d.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
    Subscriptions: d.new_subscriptions, Trials: d.new_trials,
    Credits: +(d.credit_revenue_cents / 100).toFixed(2),
  })), [series]);

  const exportCsv = () => {
    if (!cur) return;
    const rows: (string | number)[][] = [["metric", "current", "previous"]];
    (Object.keys(cur) as (keyof AdminRevenueSummary)[]).forEach((k) => rows.push([k, cur[k], prev ? prev[k] : ""]));
    rows.push([]); rows.push(["day", "new_subscriptions", "new_trials", "credit_revenue_cents"]);
    series.forEach((d) => rows.push([d.day, d.new_subscriptions, d.new_trials, d.credit_revenue_cents]));
    csvDownload(`roamly-revenue-${resolved.startISO.slice(0, 10)}_${resolved.endISO.slice(0, 10)}.csv`, rows);
  };

  const P = (k: keyof AdminRevenueSummary) => (filters.compare && prev ? prev[k] : undefined);
  const arrCents = cur ? cur.mrr_cents * 12 : 0;
  const trialConvRate = cur && cur.new_trials > 0 ? (cur.trials_converted / cur.new_trials) * 100 : 0;

  return (
    <div>
      <FilterBar state={state} updatedAt={updatedAt} onExport={exportCsv} />

      {/* Authoritative Stripe figures, when the integration is configured. */}
      {stripe && (
        <section className="mb-4" aria-label="Authoritative revenue from Stripe">
          <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Info size={13} className="text-roamly-green" /> Authoritative (from Stripe)
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <KpiCard primary label="MRR" value={stripe.mrr_cents} format={fmtCents} tip="Monthly recurring revenue from active Stripe subscriptions, with annual plans normalized to a monthly amount. Read live from Stripe." />
            <KpiCard primary label="ARR" value={stripe.arr_cents} format={fmtCents} tip="Annual run-rate = MRR × 12, from Stripe." />
            <KpiCard primary label="Active subscriptions" value={stripe.active_subscriptions} tip="Count of subscriptions in Stripe with status active." />
            <KpiCard primary label="Trialing" value={stripe.trialing} tip="Subscriptions currently in a Stripe trial." />
            <KpiCard primary label="Net revenue" value={stripe.net_cents} format={fmtCents} tip="Net of Stripe fees and refunds, from balance transactions settled in this window. Authoritative." />
            <KpiCard primary label="Fees" value={stripe.fees_cents} format={fmtCents} tip="Stripe processing fees in this window." />
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Gross {fmtCents(stripe.gross_cents)} · refunds {fmtCents(stripe.refunds_cents)} · net {fmtCents(stripe.net_cents)} in this window ({stripe.currency.toUpperCase()}). Live from Stripe.
          </p>
        </section>
      )}

      {/* Estimate disclosure — modeled figures below, distinct from Stripe. */}
      <div className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-3 text-[12px] leading-snug text-muted-foreground">
        <Info size={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <p>
          <span className="font-semibold text-foreground">Estimated figures.</span> The section below is modeled from subscription and
          credit records at list price (subscriptions $3/mo or $30/yr; credit packs $1 for 2, $2 for 5). It excludes discounts,
          proration, refunds, failed charges, taxes, and fees.{" "}
          {stripe
            ? <span className="font-medium">For billed revenue, use the authoritative Stripe figures above.</span>
            : <span><span className="font-medium">Stripe is the source of truth</span> for net revenue. Configure the Stripe integration to show authoritative figures here.</span>}
        </p>
      </div>

      {status === "error" && <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">Couldn't load revenue analytics.</div>}
      {status === "loading" && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-border/40" />)}</div>}

      {status === "ready" && cur && (
        <>
          {/* Recurring revenue snapshot (as of window end) */}
          <section aria-label="Recurring revenue">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recurring revenue (estimated)</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <KpiCard primary label="Est. MRR" value={cur.mrr_cents} prev={P("mrr_cents")} format={fmtCents} tip="Estimated monthly recurring revenue: active subscription entitlements as of the window end, valued at list price ($3/mo, or $2.50/mo for annual). Not from Stripe." />
              <KpiCard primary label="Est. ARR" value={arrCents} format={fmtCents} tip="Estimated annual run-rate = Est. MRR × 12. Modeled, not billed." />
              <KpiCard primary label="Paying subscribers" value={cur.paying_users} prev={P("paying_users")} tip="Distinct users with an active subscription entitlement as of the window end. Admin grants, trials, and credit-only users are excluded." />
              <KpiCard primary label="Active trials" value={cur.active_trials} prev={P("active_trials")} tip="Users with an active trial entitlement as of the window end." />
              <KpiCard primary label="Canceling" value={cur.canceling} prev={P("canceling")} tip="Active subscriptions flagged to cancel at period end (cancel_at_period_end)." />
              <KpiCard primary label="Trial → paid" value={trialConvRate} format={(n) => n.toFixed(0)} suffix="%" tip="Of trials started in this window, the share of users who also have a subscription entitlement. Small windows are noisy." />
            </div>
          </section>

          {/* Charts */}
          <section className="mt-5 grid gap-3 lg:grid-cols-2" aria-label="Revenue trends">
            <ChartCard title="New subscriptions & trials" subtitle="Subscription and trial starts per day (UTC).">
              <Suspense fallback={<ChartSkeleton />}><AdminTrendChart data={trend} series={[{ key: "Subscriptions", label: "Subscriptions", color: "hsl(var(--primary))" }, { key: "Trials", label: "Trials", color: "hsl(var(--primary) / 0.4)" }]} /></Suspense>
            </ChartCard>
            <ChartCard title="Estimated credit revenue" subtitle="Modeled USD from credit-pack purchases per day (UTC).">
              <Suspense fallback={<ChartSkeleton />}><AdminTrendChart data={trend} series={[{ key: "Credits", label: "Credit $ (est.)", color: "hsl(var(--primary))" }]} /></Suspense>
            </ChartCard>
            <ChartCard title="Conversion funnel" subtitle="Cohort of users who registered in this window.">
              <RevenueFunnel funnel={funnel} />
            </ChartCard>
            <ChartCard title="One-time credit sales" subtitle="Purchases and estimated revenue in this window.">
              <div className="flex h-full flex-col justify-center gap-3">
                <div className="flex items-baseline justify-between"><span className="text-sm text-muted-foreground">Purchases</span><span className="font-display text-2xl font-semibold">{cur.credit_purchases}</span></div>
                <div className="flex items-baseline justify-between"><span className="text-sm text-muted-foreground">Credits sold</span><span className="font-display text-2xl font-semibold">{cur.credits_sold}</span></div>
                <div className="flex items-baseline justify-between"><span className="text-sm text-muted-foreground">Est. revenue</span><span className="font-display text-2xl font-semibold">{fmtCents(cur.credit_revenue_cents)}</span></div>
              </div>
            </ChartCard>
          </section>

          {/* Flow metrics */}
          <section className="mt-5" aria-label="Subscription flow">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">In this window</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              <KpiCard label="New subscriptions" value={cur.new_subscriptions} prev={P("new_subscriptions")} tip="Subscription entitlements created within the window (UTC)." />
              <KpiCard label="New trials" value={cur.new_trials} prev={P("new_trials")} tip="Trial entitlements created within the window (UTC)." />
              <KpiCard label="Trials converted" value={cur.trials_converted} prev={P("trials_converted")} tip="Users who started a subscription in the window and had a prior trial." />
              <KpiCard label="Credit purchases" value={cur.credit_purchases} prev={P("credit_purchases")} tip="credit_ledger rows with reason='purchase' in the window (authoritative count)." />
              <KpiCard label="Credits sold" value={cur.credits_sold} prev={P("credits_sold")} tip="Sum of purchased credit amounts in the window (authoritative)." />
              <KpiCard label="Est. credit revenue" value={cur.credit_revenue_cents} prev={P("credit_revenue_cents")} format={fmtCents} tip="Credit purchases valued at pack list price ($1 for 2, $2 for 5). Modeled." />
            </div>
          </section>
        </>
      )}
    </div>
  );
}

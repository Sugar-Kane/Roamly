// Pure, dependency-free metric helpers for the admin dashboard. Kept separate
// from adminDashboard.tsx (which pulls in React/recharts/db) so the calculation
// logic can be unit-tested in isolation and reused server-agnostically.

import type { AdminKpiSummary, AdminFunnel } from "./db";

export type RangeKey = "today" | "7d" | "14d" | "30d" | "90d" | "custom";
export type PlanScope = "all" | "free" | "premium";
export type DeviceScope = "all" | "phone" | "tablet" | "pc";
export type AdminFilters = {
  range: RangeKey; customStart: string; customEnd: string;
  compare: boolean; plan: PlanScope; device: DeviceScope;
};
export type ResolvedRange = {
  startISO: string; endISO: string; prevStartISO: string; prevEndISO: string; label: string; days: number;
};

const RANGE_DAYS: Record<Exclude<RangeKey, "custom">, number> = { today: 1, "7d": 7, "14d": 14, "30d": 30, "90d": 90 };

// Resolve the filter selection into UTC ISO bounds plus the matching previous
// window (same length, immediately preceding) for comparisons. `now` is
// injectable so the math is deterministically testable.
export function resolveRange(f: AdminFilters, now: Date = new Date()): ResolvedRange {
  let start: Date, end: Date;
  if (f.range === "custom" && f.customStart && f.customEnd) {
    start = new Date(`${f.customStart}T00:00:00Z`);
    end = new Date(`${f.customEnd}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1); // make the end day inclusive
  } else {
    const days = RANGE_DAYS[(f.range === "custom" ? "30d" : f.range) as Exclude<RangeKey, "custom">];
    end = now;
    start = new Date(now.getTime() - days * 86400000);
  }
  const span = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime());
  const prevStart = new Date(start.getTime() - span);
  const days = Math.max(1, Math.round(span / 86400000));
  const label = f.range === "today" ? "Today"
    : f.range === "custom" ? `${f.customStart} → ${f.customEnd}`
    : `Last ${days} days`;
  return {
    startISO: start.toISOString(), endISO: end.toISOString(),
    prevStartISO: prevStart.toISOString(), prevEndISO: prevEnd.toISOString(), label, days,
  };
}

// Percent change vs a baseline. null means "no baseline" (prev was 0 but cur
// isn't) so the UI can render "new" instead of a divide-by-zero / Infinity.
export function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return cur === 0 ? 0 : null;
  return ((cur - prev) / prev) * 100;
}

export function fmtMinutes(m: number): string {
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

// USD from integer cents. Whole-dollar amounts drop the ".00" so KPI tiles stay
// compact ($3, $1,250); fractional amounts keep two places ($2.50). Used for the
// Revenue page's estimated MRR/ARR and credit-revenue figures.
export function fmtCents(cents: number): string {
  const dollars = cents / 100;
  const whole = Number.isInteger(dollars);
  return `$${dollars.toLocaleString(undefined, {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

// Deterministic, calculation-backed insights — never AI-generated claims. Each
// line states the metric, direction, magnitude, and the raw before→after.
export function buildInsights(cur: AdminKpiSummary, prev: AdminKpiSummary, funnel: AdminFunnel | null): string[] {
  const out: string[] = [];
  const delta = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 100));
  const wau = delta(cur.wau, prev.wau);
  if (wau != null && Math.abs(wau) >= 5) out.push(`Weekly active users ${wau >= 0 ? "increased" : "declined"} ${Math.abs(wau)}% vs the previous period (${prev.wau} → ${cur.wau}).`);
  const nu = delta(cur.new_users, prev.new_users);
  if (nu != null && Math.abs(nu) >= 10) out.push(`New registrations ${nu >= 0 ? "up" : "down"} ${Math.abs(nu)}% (${prev.new_users} → ${cur.new_users}).`);
  const fm = delta(cur.focus_minutes, prev.focus_minutes);
  if (fm != null && Math.abs(fm) >= 10) out.push(`Total focus minutes ${fm >= 0 ? "rose" : "fell"} ${Math.abs(fm)}% (${prev.focus_minutes} → ${cur.focus_minutes}).`);
  if (cur.tasks_created > prev.tasks_created && cur.tasks_completed <= prev.tasks_completed) out.push(`Tasks created rose but tasks completed did not — completion may be slipping.`);
  if (funnel && funnel.signed_up >= 5) out.push(`Of ${funnel.signed_up} new users, ${funnel.focused} completed a focus block and ${funnel.converted_paid} reached a paid subscription.`);
  if (cur.error_count > prev.error_count && cur.error_count >= 3) out.push(`Client errors increased to ${cur.error_count} (from ${prev.error_count}) — check the Errors section.`);
  return out;
}

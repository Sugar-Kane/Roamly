import { test, expect } from "@playwright/test";
import { resolveRange, pctChange, fmtMinutes, buildInsights, type AdminFilters } from "../src/adminMetrics";
import type { AdminKpiSummary, AdminFunnel } from "../src/db";

// Pure metric-calculation unit tests (no browser needed). These lock the math
// behind the admin dashboard's KPI deltas, date windows, and insights.

const base: AdminFilters = { range: "30d", customStart: "", customEnd: "", compare: true, plan: "all", device: "all" };
const NOW = new Date("2026-07-17T12:00:00.000Z");

test.describe("resolveRange", () => {
  test("30d window spans 30 days and the previous window immediately precedes it", () => {
    const r = resolveRange({ ...base, range: "30d" }, NOW);
    expect(r.endISO).toBe(NOW.toISOString());
    expect(r.startISO).toBe(new Date("2026-06-17T12:00:00.000Z").toISOString());
    expect(r.days).toBe(30);
    // previous window is the same length, ending exactly where this one starts.
    expect(r.prevEndISO).toBe(r.startISO);
    expect(r.prevStartISO).toBe(new Date("2026-05-18T12:00:00.000Z").toISOString());
    expect(r.label).toBe("Last 30 days");
  });

  test("today window is a single day", () => {
    const r = resolveRange({ ...base, range: "today" }, NOW);
    expect(r.days).toBe(1);
    expect(r.label).toBe("Today");
  });

  test("custom range makes the end day inclusive (UTC)", () => {
    const r = resolveRange({ ...base, range: "custom", customStart: "2026-07-01", customEnd: "2026-07-07" }, NOW);
    expect(r.startISO).toBe("2026-07-01T00:00:00.000Z");
    expect(r.endISO).toBe("2026-07-08T00:00:00.000Z"); // +1 day so Jul 7 is included
    expect(r.days).toBe(7);
  });
});

test.describe("pctChange", () => {
  test("computes percent change", () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(80, 100)).toBeCloseTo(-20);
  });
  test("no baseline returns null (rendered as 'new'), 0→0 is flat", () => {
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(0, 0)).toBe(0);
  });
});

test("fmtMinutes formats hours and minutes", () => {
  expect(fmtMinutes(45)).toBe("45m");
  expect(fmtMinutes(125)).toBe("2h 5m");
});

test.describe("buildInsights", () => {
  const kpi = (o: Partial<AdminKpiSummary>): AdminKpiSummary => ({
    total_users: 0, premium_users: 0, trial_users: 0, new_users: 0, active_users: 0, returning_users: 0,
    dau: 0, wau: 0, mau: 0, focus_minutes: 0, focus_sessions_started: 0, focus_blocks_done: 0,
    tasks_created: 0, tasks_completed: 0, rooms_created: 0, room_joins: 0, note_uploads: 0,
    credit_purchases: 0, feedback_count: 0, error_count: 0, ...o,
  });

  test("reports a meaningful WAU swing with before→after values", () => {
    const out = buildInsights(kpi({ wau: 114 }), kpi({ wau: 100 }), null);
    expect(out.some((s) => s.includes("Weekly active users increased 14%") && s.includes("100 → 114"))).toBe(true);
  });

  test("flags tasks-created-up-but-completed-down", () => {
    const out = buildInsights(kpi({ tasks_created: 20, tasks_completed: 3 }), kpi({ tasks_created: 10, tasks_completed: 5 }), null);
    expect(out.some((s) => s.includes("completion may be slipping"))).toBe(true);
  });

  test("summarizes the funnel when the cohort is large enough", () => {
    const funnel: AdminFunnel = { signed_up: 10, focused: 6, created_task: 5, started_trial: 2, converted_paid: 1 };
    const out = buildInsights(kpi({}), kpi({}), funnel);
    expect(out.some((s) => s.includes("Of 10 new users") && s.includes("6 completed a focus block"))).toBe(true);
  });

  test("stays quiet on tiny, insignificant changes", () => {
    expect(buildInsights(kpi({ wau: 101 }), kpi({ wau: 100 }), null)).toHaveLength(0);
  });
});

// Admin BI dashboard — Phase 3: single-user detail drawer.
// Opened from a Users roster row. Read-only inspection: profile snapshot,
// plan/entitlement status, lifetime + trailing-30-day aggregates, a small
// focus/activity sparkline, and a recent event timeline (raw event names are
// mapped to human-readable labels via adminLabels). Every data call is an
// is_admin()-gated RPC. Account actions stay on the roster row, not here.

import { lazy, Suspense, useEffect, useState } from "react";
import { Crown, Shield } from "lucide-react";
import {
  adminUserDetail, adminUserEvents, adminUserDaily,
  type AdminUserDetail, type AdminUserEvent, type AdminUserDailyPoint, type AdminUserListRow,
} from "./db";
import { Drawer } from "./Drawer";
import { featureLabel } from "./adminLabels";
import { fmtMinutes } from "./adminMetrics";

const AdminTrendChart = lazy(() => import("./Charts").then((m) => ({ default: m.AdminTrendChart })));

// Compact relative time (kept local, matching the other admin views).
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
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

function Mini({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-display text-lg font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground/80">{hint}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

export function UserDetail({ user, onClose }: { user: AdminUserListRow; onClose: () => void }) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [events, setEvents] = useState<AdminUserEvent[]>([]);
  const [daily, setDaily] = useState<AdminUserDailyPoint[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let alive = true;
    setStatus("loading");
    Promise.all([
      adminUserDetail(user.id),
      adminUserEvents(user.id, 50),
      adminUserDaily(user.id, 30),
    ]).then(([d, e, dy]) => {
      if (!alive) return;
      if (!d) { setStatus("error"); return; }
      setDetail(d); setEvents(e); setDaily(dy); setStatus("ready");
    }).catch(() => { if (alive) setStatus("error"); });
    return () => { alive = false; };
  }, [user.id]);

  // Instant header from the roster row; the drawer fills in the rest.
  const name = user.display_name || user.username || user.email || "Unnamed user";
  const trend = daily.map((p) => ({
    day: new Date(`${p.day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }),
    Focus: p.focus_minutes, Events: p.events,
  }));
  const hasActivity = daily.some((p) => p.focus_minutes > 0 || p.events > 0);

  return (
    <Drawer label={name} onClose={onClose} testId="user-detail">
      {/* Identity */}
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {user.email || "no email"}{user.username ? ` · @${user.username}` : ""}
        </p>
        {detail?.is_admin_user && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"><Shield size={11} /> Admin</span>
        )}
        {(detail?.is_premium ?? user.is_premium) && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary"><Crown size={11} /> Premium</span>
        )}
      </div>

      {status === "error" && <p className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">Couldn't load this user's detail.</p>}
      {status === "loading" && <div className="mt-4 grid grid-cols-2 gap-2">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-border/40" />)}</div>}

      {status === "ready" && detail && (
        <>
          {/* Lifetime aggregates */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Mini label="Focus time" value={fmtMinutes(detail.focus_minutes)} hint={`${detail.focus_days} day${detail.focus_days === 1 ? "" : "s"}`} />
            <Mini label="Focus blocks" value={detail.focus_blocks_done} />
            <Mini label="Total events" value={detail.total_events} />
            <Mini label="Tasks" value={detail.tasks_created} hint={`${detail.tasks_completed} done`} />
            <Mini label="Rooms joined" value={detail.room_joins} hint={detail.rooms_created ? `${detail.rooms_created} hosted` : undefined} />
            <Mini label="Note uploads" value={detail.note_uploads} />
          </div>

          {/* Activity sparkline (last 30d) */}
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last 30 days</h3>
            {hasActivity ? (
              <div className="mt-2 h-32">
                <Suspense fallback={<div className="h-full animate-pulse rounded-xl bg-border/40" />}>
                  <AdminTrendChart data={trend} series={[
                    { key: "Focus", label: "Focus min", color: "hsl(var(--primary))" },
                    { key: "Events", label: "Events", color: "hsl(var(--muted-foreground))" },
                  ]} />
                </Suspense>
              </div>
            ) : (
              <p className="mt-2 rounded-xl border border-dashed border-border bg-card/50 p-3 text-xs text-muted-foreground">No activity in the last 30 days.</p>
            )}
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {detail.active_days_30d} active day{detail.active_days_30d === 1 ? "" : "s"} · {fmtMinutes(detail.focus_minutes_30d)} focused · {detail.events_30d} events
            </p>
          </div>

          {/* Account / status */}
          <div className="mt-4 rounded-xl border border-border bg-card/60 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Account</h3>
            <div className="mt-1.5 divide-y divide-border/60">
              <Row label="Plan">
                {detail.is_premium ? (
                  <>Premium{detail.premium_source ? ` · ${detail.premium_source}` : ""}</>
                ) : "Free"}
              </Row>
              {detail.is_premium && detail.premium_expires_at && (
                <Row label="Premium through">
                  {fmtDate(detail.premium_expires_at)}{detail.cancel_at_period_end ? " · canceling" : ""}
                </Row>
              )}
              <Row label="Activated"><span className={detail.activated ? "text-roamly-green" : "text-muted-foreground"}>{detail.activated ? "Yes" : "No"}</span></Row>
              <Row label="Credits">{detail.ai_credits}</Row>
              <Row label="Note uploads used">{detail.ai_uploads_count}{detail.ai_uploads_period ? ` in ${detail.ai_uploads_period}` : ""}</Row>
              <Row label="Feedback / errors">{detail.feedback_count} / {detail.error_count}</Row>
              <Row label="Joined">{fmtDate(detail.created_at)}</Row>
              <Row label="First seen">{relTime(detail.first_active)}</Row>
              <Row label="Last active">{relTime(detail.last_active)}</Row>
            </div>
          </div>

          {/* Recent activity timeline */}
          <div className="mt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent activity</h3>
            {events.length === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed border-border bg-card/50 p-3 text-xs text-muted-foreground">No tracked events yet.</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {events.map((e, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 rounded-lg px-1 py-1 text-sm">
                    <span className="min-w-0 truncate">
                      {featureLabel(e.name)}
                      {e.device ? <span className="text-[11px] text-muted-foreground"> · {e.device}</span> : null}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{relTime(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}

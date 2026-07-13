// Admin dashboard — usage metrics, feedback inbox, client-error log, invites,
// and Premium management. Extracted from App.tsx to keep that file focused.
// Every data call is a SECURITY DEFINER RPC gated on is_admin() server-side.
import { useEffect, useState } from "react";
import { Crown, Search, ExternalLink, Trash2 } from "lucide-react";
import {
  adminSearchUsers, adminGrantPremium, adminRevokePremium, sendInvite,
  adminOverview, adminEventStats, adminDailyActivity, adminListFeedback, adminListErrors,
  adminUserActivity, adminFeedbackAction,
  adminListAdSubmissions, adminSetAdSubmissionStatus, adminDeleteAdSubmission,
  type AdminUser, type AdminOverview, type AdminEventStat, type AdminDailyActivity,
  type FeedbackRow, type ErrorRow, type UserActivityRow,
  type AdSubmissionRow, type AdStatus,
} from "./db";

// "3m ago" / "2h ago" / "Apr 5" — compact relative time for activity/ticket rows.
function relTime(iso: string): string {
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

export function AdminView({ isAdmin }: { isAdmin: boolean }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminUser[]>([]);
  const [searched, setSearched] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const invite = async () => {
    if (!inviteEmail.trim() || inviting) return;
    setInviting(true);
    setInviteMsg(null);
    const res = await sendInvite(inviteEmail.trim(), inviteName);
    setInviting(false);
    if (res.error) { setInviteMsg({ ok: false, text: res.error }); return; }
    setInviteMsg({
      ok: true,
      text: res.status === "friend_request"
        ? "Already a user — friend request sent."
        : res.note === "resent"
          ? `Invite re-sent to ${inviteEmail.trim()}.`
          : `Invite emailed to ${inviteEmail.trim()}.`,
    });
    setInviteEmail("");
    setInviteName("");
  };

  const search = async () => {
    setError(null);
    setResults(await adminSearchUsers(query.trim())); // blank query lists everyone
    setSearched(true);
  };

  const grant = async (u: AdminUser, months: 1 | 12) => {
    setBusyId(`${u.id}:${months}`);
    setError(null);
    const result = await adminGrantPremium(u.id, months, "Granted from Roamly admin portal");
    setBusyId(null);
    if (result.error) { setError(result.error); return; }
    setResults((prev) => prev.map((r) => (r.id === u.id ? { ...r, is_premium: true } : r)));
  };

  const revoke = async (u: AdminUser) => {
    const label = u.display_name || u.username || u.email || "this user";
    if (!window.confirm(`Cancel any active Stripe subscription and revoke all current Premium access for ${label}? Cancellation is immediate and does not automatically refund prior charges.`)) return;
    setBusyId(`${u.id}:revoke`);
    setError(null);
    const result = await adminRevokePremium(u.id);
    setBusyId(null);
    if (result.error) { setError(result.error); return; }
    setResults((prev) => prev.map((r) => (r.id === u.id ? { ...r, is_premium: false } : r)));
  };

  const [tab, setTab] = useState<"usage" | "feedback" | "ads" | "errors" | "users">("usage");

  // Show the full roster by default when the Users tab opens; the search box
  // then filters it (and a cleared box restores the full list).
  useEffect(() => {
    if (!isAdmin || tab !== "users") return;
    let alive = true;
    adminSearchUsers("").then((r) => { if (alive) { setResults(r); setSearched(true); } });
    return () => { alive = false; };
  }, [isAdmin, tab]);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-3xl font-semibold">Admin</h1>
        <p className="mt-2 text-sm text-muted-foreground">You don't have admin access.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="font-display text-3xl font-semibold">Admin</h1>
      <p className="mt-1 text-sm text-muted-foreground">Usage, feedback, errors, invites, and Premium.</p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {([["usage", "Usage"], ["feedback", "Feedback"], ["ads", "Ads"], ["errors", "Errors"], ["users", "Users"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${tab === id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 text-muted-foreground hover:border-primary/40"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "usage" && <AdminUsage />}
      {tab === "feedback" && <AdminFeedback />}
      {tab === "ads" && <AdminAds />}
      {tab === "errors" && <AdminErrors />}

      {tab === "users" && <>
      <div className="mt-6 rounded-2xl border border-border bg-card/70 p-4">
        <h2 className="text-sm font-semibold">Invite by email</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Emails them an invite to join Roamly (or sends a friend request if they're already a user).</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} maxLength={60}
            placeholder="Their name"
            className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && invite()}
            type="email" placeholder="name@example.com"
            className="min-w-0 flex-[1.4] rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <button onClick={invite} disabled={inviting || !inviteEmail.trim()}
            className="shrink-0 rounded-xl gradient-primary px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-50">
            {inviting ? "Sending…" : "Invite"}
          </button>
        </div>
        {inviteMsg && <p className={`mt-2 text-xs ${inviteMsg.ok ? "text-roamly-green" : "text-destructive"}`}>{inviteMsg.text}</p>}
      </div>

      <h2 className="mt-8 text-sm font-semibold">Manage Premium</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Everyone's listed below — search to filter by email, username, or name.</p>
      <div className="mt-3 flex gap-2">
        <input value={query}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            if (!v.trim()) { setError(null); adminSearchUsers("").then((r) => { setResults(r); setSearched(true); }); }
          }}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Search by email or username…"
          className="min-w-0 flex-1 rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
        <button onClick={search} className="shrink-0 rounded-xl gradient-primary px-4 text-sm font-semibold text-white shadow-glow transition active:scale-95">Search</button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-6 space-y-2">
        {results.length > 0 && (
          <p className="px-1 text-xs text-muted-foreground">
            {query.trim() ? `${results.length} match${results.length === 1 ? "" : "es"}` : `${results.length} user${results.length === 1 ? "" : "s"}`}
          </p>
        )}
        {searched && results.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border bg-card/60 p-4 text-center text-sm text-muted-foreground">{query.trim() ? "No users match that search." : "No users yet."}</p>
        )}
        {results.map((u) => (
          <div key={u.id} className="flex items-center gap-3 rounded-xl border border-border bg-card/70 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{u.display_name || u.username || u.email || "Unnamed user"}</p>
              <p className="truncate text-xs text-muted-foreground">{u.email}{u.username ? ` · @${u.username}` : ""}</p>
            </div>
            {u.is_premium && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                <Crown size={11} /> Premium
              </span>
            )}
            <div className="flex shrink-0 gap-1">
              {u.is_premium && (
                <button onClick={() => revoke(u)} disabled={busyId !== null}
                  className="rounded-full border border-destructive/50 px-2.5 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-50">
                  {busyId === `${u.id}:revoke` ? "…" : "Revoke"}
                </button>
              )}
              <button onClick={() => grant(u, 1)} disabled={busyId !== null}
                className="rounded-full border border-primary/50 bg-primary/10 px-2.5 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50">
                {busyId === `${u.id}:1` ? "…" : "+1 month"}
              </button>
              <button onClick={() => grant(u, 12)} disabled={busyId !== null}
                className="rounded-full gradient-primary px-2.5 py-1.5 text-xs font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-50">
                {busyId === `${u.id}:12` ? "…" : "+1 year"}
              </button>
            </div>
          </div>
        ))}
      </div>
      </>}
    </div>
  );
}

// Friendly names for the tracked events so the dashboard reads like features,
// not code. Anything unmapped falls back to its raw name.
const EVENT_LABELS: Record<string, string> = {
  view_focus: "Focus tab visits",
  view_tasks: "Tasks tab visits",
  view_rooms: "Rooms tab visits",
  view_analytics: "Analytics tab visits",
  view_premium: "Premium page visits",
  view_admin: "Admin page visits",
  timer_start: "Timer started",
  focus_block_done: "Focus blocks finished",
  focus_mode_enter: "Focus mode opened",
  pip_open: "Pop-out timer opened",
  task_add: "Tasks added",
  task_done: "Tasks completed",
  task_ai_upload: "AI note uploads",
  room_join: "Rooms joined",
  room_host: "Rooms hosted",
  room_focus_mode: "Room focus mode",
  voice_join: "Voice chat joined",
  music_play: "Built-in music played",
  embed_play: "Spotify/Apple used",
  theme_change: "Theme changed",
  tutorial_done: "Tutorial completed",
  feedback_sent: "Feedback sent",
  buy_credits: "Credit pack checkout",
};

function AdminUsage() {
  const [days, setDays] = useState(14);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [stats, setStats] = useState<AdminEventStat[]>([]);
  const [daily, setDaily] = useState<AdminDailyActivity[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { adminOverview().then(setOverview); }, []);
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    Promise.all([adminEventStats(days), adminDailyActivity(days)]).then(([s, d]) => {
      if (!alive) return;
      setStats(s);
      setDaily(d);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [days]);

  const tiles = [
    { label: "Students", value: overview?.total_users },
    { label: "Premium", value: overview?.premium_users },
    { label: "Active this week", value: overview?.active_7d },
    { label: "Feedback", value: overview?.feedback_total },
  ];

  return (
    <div className="mt-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl border border-border bg-card/70 p-3.5">
            <p className="font-display text-2xl font-semibold">{t.value ?? "—"}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t.label}</p>
          </div>
        ))}
      </div>

      <UserActivitySearch />

      <div className="mt-6 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Feature usage</h2>
        <div className="flex gap-1">
          {[7, 14, 30].map((d) => (
            <button key={d} onClick={() => setDays(d)} aria-pressed={days === d}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${days === d ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 text-muted-foreground hover:border-primary/40"}`}>
              {d}d
            </button>
          ))}
        </div>
      </div>

      {!loaded && <p className="mt-3 text-sm text-muted-foreground">Loading usage…</p>}
      {loaded && stats.length === 0 && (
        <p className="mt-3 rounded-2xl border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">
          No usage recorded yet. Data starts flowing once the metrics update is applied in Supabase and signed-in users start clicking around.
        </p>
      )}
      {stats.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/70">
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>Feature</span><span className="text-right">Uses</span><span className="text-right">Students</span><span className="text-right">📱</span><span className="text-right">💻</span>
          </div>
          {stats.map((s) => (
            <div key={s.name} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 border-b border-border/50 px-4 py-2 text-sm last:border-b-0">
              <span className="min-w-0 truncate">{EVENT_LABELS[s.name] ?? s.name}</span>
              <span className="text-right font-mono text-xs">{s.total}</span>
              <span className="text-right font-mono text-xs">{s.users}</span>
              <span className="text-right font-mono text-xs text-muted-foreground">{s.phone}</span>
              <span className="text-right font-mono text-xs text-muted-foreground">{s.pc}</span>
            </div>
          ))}
        </div>
      )}

      {daily.length > 0 && (
        <>
          <h2 className="mt-6 text-sm font-semibold">Active students per day</h2>
          <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/70">
            {daily.map((d) => (
              <div key={d.day} className="flex items-center justify-between border-b border-border/50 px-4 py-2 text-sm last:border-b-0">
                <span className="text-muted-foreground">
                  {new Date(`${d.day}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                </span>
                <span className="font-mono text-xs">{d.active_users} student{d.active_users === 1 ? "" : "s"} · {d.events} actions</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Search one user by email / username / name and show their event timeline —
// so the admin can watch exactly how a specific student is using the app.
function UserActivitySearch() {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<UserActivityRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  const run = async () => {
    if (!query.trim()) return;
    setBusy(true);
    const r = await adminUserActivity(query.trim());
    setRows(r);
    setSearched(true);
    setBusy(false);
  };

  // Group consecutive rows by day for a readable timeline.
  const who = rows[0];

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card/70 p-4">
      <h2 className="text-sm font-semibold">Search a user's activity</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">See what a specific student clicks on — search by email, username, or name.</p>
      <div className="mt-3 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="e.g. name@example.com"
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </div>
        <button onClick={run} disabled={busy || !query.trim()}
          className="shrink-0 rounded-xl gradient-primary px-4 text-sm font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-50">
          {busy ? "…" : "Search"}
        </button>
      </div>

      {searched && !busy && rows.length === 0 && (
        <p className="mt-3 rounded-xl border border-dashed border-border bg-card/60 p-3 text-center text-sm text-muted-foreground">
          No activity found for that user. They may not have clicked around since metrics went live.
        </p>
      )}

      {rows.length > 0 && (
        <>
          {who && (
            <p className="mt-3 text-xs text-muted-foreground">
              Showing <span className="font-medium text-foreground">{who.name || who.username || who.email}</span>
              {who.email ? ` · ${who.email}` : ""} — {rows.length} recent action{rows.length === 1 ? "" : "s"}
            </p>
          )}
          <div className="mt-2 max-h-96 overflow-y-auto rounded-xl border border-border">
            {rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2 text-sm last:border-b-0">
                <span className="min-w-0 truncate">
                  {EVENT_LABELS[r.event] ?? r.event}
                  {r.meta && <span className="text-muted-foreground"> · {r.meta}</span>}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {r.device === "pc" ? "💻" : "📱"} {relTime(r.created_at)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const FEEDBACK_STYLE: Record<string, { label: string; cls: string }> = {
  bug: { label: "Bug", cls: "bg-destructive/10 text-destructive" },
  confusing: { label: "Confusing", cls: "bg-primary/10 text-primary" },
  idea: { label: "Idea", cls: "bg-roamly-green/10 text-roamly-green" },
  other: { label: "Other", cls: "bg-secondary text-muted-foreground" },
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-primary/10 text-primary" },
  in_progress: { label: "In progress", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  done: { label: "Done", cls: "bg-roamly-green/10 text-roamly-green" },
};
const STATUS_ORDER = ["open", "in_progress", "done"] as const;

function AdminFeedback() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"all" | "open" | "in_progress" | "done">("all");

  const load = () => adminListFeedback(100).then((r) => { setRows(r); setLoaded(true); });
  useEffect(() => { load(); }, []);

  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);

  const patchRow = (id: string, fields: Partial<FeedbackRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)));

  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-1.5">
        {(["all", "open", "in_progress", "done"] as const).map((id) => (
          <button key={id} onClick={() => setFilter(id)} aria-pressed={filter === id}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${filter === id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 text-muted-foreground hover:border-primary/40"}`}>
            {id === "all" ? "All" : STATUS_META[id].label}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {!loaded && <p className="text-sm text-muted-foreground">Loading feedback…</p>}
        {loaded && shown.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">
            {filter === "all"
              ? "No feedback yet. Users can send it from their profile menu → Send feedback."
              : `No ${STATUS_META[filter].label.toLowerCase()} tickets.`}
          </p>
        )}
        {shown.map((f) => (
          <FeedbackTicket key={f.id} f={f} onPatch={patchRow}
            onDelete={(id) => setRows((prev) => prev.filter((r) => r.id !== id))} />
        ))}
      </div>
    </div>
  );
}

const AD_STATUS_OPTIONS: AdStatus[] = ["new", "reviewing", "approved", "rejected", "live", "ended"];
const AD_TYPE_LABEL: Record<string, string> = {
  tiktok: "TikTok", reel: "Reel", business_video: "Business video", image_billboard: "Image billboard",
};
const AD_PLAN_LABEL: Record<string, string> = {
  image_weekly: "Image $19/wk", short_video_weekly: "Short video $39/wk", business_video_weekly: "Business video $59/wk",
};

// Advertiser submissions from the break-time prompt. Admins triage status and
// reach out at the contact email (payment/creative are handled off-platform).
function AdminAds() {
  const [rows, setRows] = useState<AdSubmissionRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => { adminListAdSubmissions(100).then((r) => { setRows(r); setLoaded(true); }); }, []);

  const setStatus = async (id: string, status: AdStatus) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    await adminSetAdSubmissionStatus(id, status);
  };
  const remove = async (id: string) => {
    if (!window.confirm("Delete this ad submission?")) return;
    const res = await adminDeleteAdSubmission(id);
    if (!res.error) setRows((prev) => prev.filter((r) => r.id !== id));
  };

  return (
    <div className="mt-5 space-y-2">
      {!loaded && <p className="text-sm text-muted-foreground">Loading ad submissions…</p>}
      {loaded && rows.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">
          No ad submissions yet. Non-premium users can submit one from the break-time “Advertise on Roamly” prompt.
        </p>
      )}
      {rows.map((a) => (
        <div key={a.id} className="rounded-2xl border border-border bg-card/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{a.business_name}</p>
              <p className="text-xs text-muted-foreground">
                {AD_TYPE_LABEL[a.ad_type] ?? a.ad_type} · {AD_PLAN_LABEL[a.plan] ?? a.plan} · {relTime(a.created_at)}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <select value={a.status} onChange={(e) => setStatus(a.id, e.target.value as AdStatus)}
                className="rounded-lg border border-border bg-card px-2 py-1 text-xs">
                {AD_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <button onClick={() => remove(a.id)} aria-label="Delete submission"
                className="grid h-7 w-7 place-items-center rounded-lg border border-border text-muted-foreground transition hover:border-destructive/40 hover:text-destructive">
                <Trash2 size={13} />
              </button>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <a href={a.target_url} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline">
              <ExternalLink size={12} /> Creative link
            </a>
            <span className="text-muted-foreground">Contact: {a.contact_email}</span>
            {(a.email || a.username) && <span className="text-muted-foreground">By: {a.username ?? a.email}</span>}
          </div>
          {a.note && <p className="mt-2 rounded-lg border border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">{a.note}</p>}
        </div>
      ))}
    </div>
  );
}

function FeedbackTicket({ f, onPatch, onDelete }: {
  f: FeedbackRow;
  onPatch: (id: string, fields: Partial<FeedbackRow>) => void;
  onDelete: (id: string) => void;
}) {
  const style = FEEDBACK_STYLE[f.category] ?? FEEDBACK_STYLE.other;
  const [reply, setReply] = useState(f.admin_reply ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const setStatus = async (status: string) => {
    if (status === f.status) return;
    setBusy("status"); setErr(null);
    const e = await adminFeedbackAction("status", f.id, { status });
    setBusy(null);
    if (e) { setErr(e); return; }
    onPatch(f.id, { status });
  };

  const sendReply = async () => {
    if (!reply.trim()) return;
    setBusy("reply"); setErr(null);
    const e = await adminFeedbackAction("reply", f.id, { reply: reply.trim() });
    setBusy(null);
    if (e) { setErr(e); return; }
    onPatch(f.id, { admin_reply: reply.trim() });
  };

  const remove = async () => {
    if (!confirm("Delete this feedback? This can't be undone.")) return;
    setBusy("delete"); setErr(null);
    const e = await adminFeedbackAction("delete", f.id);
    setBusy(null);
    if (e) { setErr(e); return; }
    onDelete(f.id);
  };

  return (
    <div className="rounded-2xl border border-border bg-card/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.cls}`}>{style.label}</span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_META[f.status]?.cls ?? ""}`}>{STATUS_META[f.status]?.label ?? f.status}</span>
        {f.repro && <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{f.repro}</span>}
        <span className="ml-auto text-[11px] text-muted-foreground">{relTime(f.created_at)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm">{f.message}</p>
      <p className="mt-2 truncate text-[11px] text-muted-foreground">
        {f.email ?? "unknown"}{f.username ? ` · @${f.username}` : ""}{f.page ? ` · on ${f.page}` : ""}{f.device ? ` · ${f.device}` : ""}
      </p>
      {f.platform && <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{f.platform}</p>}

      {/* Status pills */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {STATUS_ORDER.map((s) => (
          <button key={s} onClick={() => setStatus(s)} disabled={busy === "status"} aria-pressed={f.status === s}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50 ${f.status === s ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40"}`}>
            {STATUS_META[s].label}
          </button>
        ))}
        {f.github_issue_url && (
          <a href={f.github_issue_url} target="_blank" rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-primary hover:underline">
            Issue #{f.github_issue_number} <ExternalLink size={11} />
          </a>
        )}
      </div>

      {/* Reply */}
      <div className="mt-2.5">
        <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={2}
          placeholder="Internal note / reply — also posted on the GitHub issue if linked…"
          className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
        <div className="mt-1.5 flex items-center gap-2">
          <button onClick={sendReply} disabled={busy === "reply" || !reply.trim()}
            className="rounded-full gradient-primary px-3.5 py-1.5 text-xs font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-50">
            {busy === "reply" ? "Saving…" : f.admin_reply ? "Update reply" : "Save reply"}
          </button>
          <button onClick={remove} disabled={busy === "delete"}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-destructive/50 hover:text-destructive disabled:opacity-50">
            <Trash2 size={12} /> {busy === "delete" ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
      {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
    </div>
  );
}

function AdminErrors() {
  const [rows, setRows] = useState<ErrorRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { adminListErrors(100).then((r) => { setRows(r); setLoaded(true); }); }, []);

  return (
    <div className="mt-5 space-y-2">
      {!loaded && <p className="text-sm text-muted-foreground">Loading errors…</p>}
      {loaded && rows.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border bg-card/60 p-4 text-sm text-roamly-green">
          No client errors reported. 🎉
        </p>
      )}
      {rows.map((e) => (
        <div key={e.id} className="rounded-2xl border border-border bg-card/70 p-4">
          <div className="flex items-start gap-2">
            <span className="break-words text-sm font-medium text-destructive">{e.message}</span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
              {new Date(e.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          </div>
          <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
            {e.email ?? "unknown"}{e.username ? ` · @${e.username}` : ""}{e.page ? ` · on ${e.page}` : ""}{e.device ? ` · ${e.device}` : ""}
          </p>
          {e.platform && <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{e.platform}</p>}
          {e.stack && (
            <>
              <button onClick={() => setOpen(open === e.id ? null : e.id)}
                className="mt-2 text-[11px] text-primary underline-offset-2 hover:underline">
                {open === e.id ? "Hide" : "Show"} details
              </button>
              {open === e.id && (
                <pre className="mt-1.5 max-h-48 overflow-auto rounded-lg border border-border bg-background/60 p-2.5 text-[10px] leading-snug text-muted-foreground">{e.stack}</pre>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

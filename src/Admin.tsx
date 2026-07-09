// Admin dashboard — usage metrics, feedback inbox, client-error log, invites,
// and Premium management. Extracted from App.tsx to keep that file focused.
// Every data call is a SECURITY DEFINER RPC gated on is_admin() server-side.
import { useEffect, useState } from "react";
import { Crown } from "lucide-react";
import {
  adminSearchUsers, adminSetPremium, sendInvite,
  adminOverview, adminEventStats, adminDailyActivity, adminListFeedback, adminListErrors,
  type AdminUser, type AdminOverview, type AdminEventStat, type AdminDailyActivity,
  type FeedbackRow, type ErrorRow,
} from "./db";

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
    if (!query.trim()) return;
    setError(null);
    setResults(await adminSearchUsers(query.trim()));
    setSearched(true);
  };

  const toggle = async (u: AdminUser) => {
    setBusyId(u.id);
    setError(null);
    const err = await adminSetPremium(u.id, !u.is_premium);
    setBusyId(null);
    if (err) { setError(err); return; }
    setResults((prev) => prev.map((r) => (r.id === u.id ? { ...r, is_premium: !r.is_premium } : r)));
  };

  const [tab, setTab] = useState<"usage" | "feedback" | "errors" | "users">("usage");

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
        {([["usage", "Usage"], ["feedback", "Feedback"], ["errors", "Errors"], ["users", "Users"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${tab === id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 text-muted-foreground hover:border-primary/40"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "usage" && <AdminUsage />}
      {tab === "feedback" && <AdminFeedback />}
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
      <div className="mt-3 flex gap-2">
        <input value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Search by email or username…"
          className="min-w-0 flex-1 rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
        <button onClick={search} className="shrink-0 rounded-xl gradient-primary px-4 text-sm font-semibold text-white shadow-glow transition active:scale-95">Search</button>
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-6 space-y-2">
        {searched && results.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border bg-card/60 p-4 text-center text-sm text-muted-foreground">No users match that search.</p>
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
            <button onClick={() => toggle(u)} disabled={busyId === u.id}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition active:scale-95 disabled:opacity-50 ${u.is_premium ? "border border-border bg-card text-muted-foreground hover:border-destructive/50 hover:text-destructive" : "gradient-primary text-white shadow-glow"}`}>
              {busyId === u.id ? "…" : u.is_premium ? "Remove" : "Grant Premium"}
            </button>
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

const FEEDBACK_STYLE: Record<string, { label: string; cls: string }> = {
  bug: { label: "Bug", cls: "bg-destructive/10 text-destructive" },
  confusing: { label: "Confusing", cls: "bg-primary/10 text-primary" },
  idea: { label: "Idea", cls: "bg-roamly-green/10 text-roamly-green" },
  other: { label: "Other", cls: "bg-secondary text-muted-foreground" },
};

function AdminFeedback() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { adminListFeedback(100).then((r) => { setRows(r); setLoaded(true); }); }, []);

  return (
    <div className="mt-5 space-y-2">
      {!loaded && <p className="text-sm text-muted-foreground">Loading feedback…</p>}
      {loaded && rows.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">
          No feedback yet. Users can send it from their profile menu → Send feedback.
        </p>
      )}
      {rows.map((f) => {
        const style = FEEDBACK_STYLE[f.category] ?? FEEDBACK_STYLE.other;
        return (
          <div key={f.id} className="rounded-2xl border border-border bg-card/70 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.cls}`}>{style.label}</span>
              {f.repro && <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{f.repro}</span>}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {new Date(f.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm">{f.message}</p>
            <p className="mt-2 truncate text-[11px] text-muted-foreground">
              {f.email ?? "unknown"}{f.username ? ` · @${f.username}` : ""}{f.page ? ` · on ${f.page}` : ""}{f.device ? ` · ${f.device}` : ""}
            </p>
            {f.platform && <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">{f.platform}</p>}
          </div>
        );
      })}
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

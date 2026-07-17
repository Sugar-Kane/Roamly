// Admin dashboard: usage metrics, feedback inbox, client-error log, invites,
// and Premium management. Extracted from App.tsx to keep that file focused.
// Every data call is a SECURITY DEFINER RPC gated on is_admin() server-side.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Crown, Search, ExternalLink, Trash2, ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react";
import {
  adminSearchUsers, adminListUsers, adminGrantPremium, adminRevokePremium, adminDeleteUser, adminAdjustCredits, sendInvite,
  adminListFeedback, adminListErrors, adminFeedbackAction,
  adminListAdSubmissions, adminSetAdSubmissionStatus, adminDeleteAdSubmission,
  type AdminUserListRow,
  type AdminUserPlanFilter, type AdminUserActivityFilter, type AdminUserSort,
  type FeedbackRow, type ErrorRow,
  type AdSubmissionRow, type AdStatus,
} from "./db";
import { Modal } from "./Modal";
import { ThemedSelect } from "./ThemedSelect";
import {
  AdminShell, AdminOverviewPage, SectionPlaceholder, useAdminFilters, type AdminSectionId,
} from "./adminDashboard";
import { FeaturesPage, EngagementPage } from "./adminAnalytics";


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
  const [active, setActive] = useState<AdminSectionId>(() => (localStorage.getItem("roamly-admin-section") as AdminSectionId) || "overview");
  const filters = useAdminFilters();
  const setSection = (id: AdminSectionId) => { setActive(id); localStorage.setItem("roamly-admin-section", id); };

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-2xl">
        <h1 className="font-display text-3xl font-semibold">Admin</h1>
        <p className="mt-2 text-sm text-muted-foreground">You don't have admin access.</p>
      </div>
    );
  }

  // Existing working sections are wrapped, not rewritten, so their mutations,
  // GitHub sync, invites, and Premium management are preserved. Sections
  // scheduled for later phases show a labeled placeholder rather than fake data.
  const content: Record<AdminSectionId, ReactNode> = {
    overview: <AdminOverviewPage state={filters} onDrill={setSection} />,
    users: <AdminUsers />,
    features: <FeaturesPage state={filters} />,
    engagement: <EngagementPage state={filters} />,
    feedback: <AdminFeedback />,
    errors: <AdminErrors />,
    ads: <AdminAds />,
    revenue: <SectionPlaceholder title="Revenue" phase="Phase 4" contains="Subscriptions, trials, conversion, credit purchases, and (estimated) recurring revenue." />,
    invites: <SectionPlaceholder title="Invites" phase="Phase 5" contains="Invite volume and accepted-invite conversion. Send invites today from the Users section." />,
    explorer: <SectionPlaceholder title="Data Explorer" phase="Phase 6" contains="Pick a metric, group by day/week/month, break down by plan or device, and export." />,
  };

  return (
    <div className="w-full">
      <h1 className="mx-auto mb-1 w-full max-w-6xl font-display text-2xl font-semibold">Admin dashboard</h1>
      <AdminShell active={active} setActive={setSection}>{content[active]}</AdminShell>
    </div>
  );
}

// Themed replacement for window.confirm()/prompt() on destructive admin
// actions. Names the affected user, optionally requires typing a word (e.g.
// DELETE) before enabling the destructive button, and disables everything
// while the action runs so it can't double-submit.
function AdminConfirmDialog({ title, body, confirmLabel, typedWord, busy, onConfirm, onClose }: {
  title: string; body: string; confirmLabel: string;
  typedWord?: string; busy: boolean;
  onConfirm: () => void; onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const armed = !typedWord || typed === typedWord;
  return (
    <Modal label={title} onClose={() => { if (!busy) onClose(); }}
      cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-destructive/10 text-destructive"><Trash2 size={20} /></div>
      <h3 className="mt-4 font-display text-xl font-semibold">{title}</h3>
      <p className="mt-1.5 whitespace-pre-line text-sm text-muted-foreground">{body}</p>
      {typedWord && (
        <input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus
          aria-label={`Type ${typedWord} to confirm`} placeholder={`Type ${typedWord} to confirm`}
          className="mt-3 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-destructive focus:ring-2 focus:ring-destructive/20" />
      )}
      <div className="mt-5 flex gap-2">
        <button onClick={onClose} disabled={busy}
          className="flex-1 rounded-full border border-border bg-card py-2.5 text-sm text-muted-foreground transition hover:border-primary/40 disabled:opacity-50">
          Cancel
        </button>
        <button onClick={onConfirm} disabled={busy || !armed}
          className="flex-1 rounded-full bg-destructive py-2.5 text-sm font-semibold text-destructive-foreground transition active:scale-95 disabled:opacity-50">
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

const USERS_PAGE_SIZE = 25;
const USER_SORT_OPTIONS: { value: AdminUserSort; label: string }[] = [
  { value: "created_at", label: "Signup date" },
  { value: "last_active", label: "Last active" },
  { value: "name", label: "Name" },
  { value: "email", label: "Email" },
  { value: "credits", label: "Credits" },
];
const USER_PLAN_FILTERS: { value: AdminUserPlanFilter; label: string }[] = [
  { value: "all", label: "All plans" },
  { value: "premium", label: "Premium" },
  { value: "free", label: "Free" },
  { value: "admin", label: "Admins" },
];
const USER_ACTIVITY_FILTERS: { value: AdminUserActivityFilter; label: string }[] = [
  { value: "all", label: "Any activity" },
  { value: "active", label: "Active (30d)" },
  { value: "inactive", label: "Inactive" },
];

// Users tab: server-side paginated / sorted / filtered roster with debounced
// search, plus invite-by-email and the Premium / credits / delete actions.
// Nothing beyond the current page is fetched, so it stays fast at 1,000+
// users. If the admin_list_users RPC isn't deployed yet, it falls back to the
// legacy admin_search_users (≤200 rows) and pages that client-side.
function AdminUsers() {
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [plan, setPlan] = useState<AdminUserPlanFilter>("all");
  const [activity, setActivity] = useState<AdminUserActivityFilter>("all");
  const [sort, setSort] = useState<AdminUserSort>("created_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AdminUserListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [legacy, setLegacy] = useState(false);
  // Monotonic request id: a slow older response can never overwrite the
  // results of the search the admin actually typed last.
  const requestSeq = useRef(0);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ kind: "revoke" | "delete"; user: AdminUserListRow } | null>(null);

  // Debounced search — typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  // Any filter change returns to the first page (filters themselves persist
  // while the admin works through user rows).
  useEffect(() => { setPage(0); }, [debouncedQuery, plan, activity, sort, dir]);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    void (async () => {
      const res = await adminListUsers({
        query: debouncedQuery, plan, activity, sort, dir,
        limit: USERS_PAGE_SIZE, offset: page * USERS_PAGE_SIZE,
      });
      if (seq !== requestSeq.current) return; // superseded by a newer search
      if (res) {
        setLegacy(false);
        setRows(res.rows);
        setTotal(res.total);
        setLoading(false);
        return;
      }
      // RPC not deployed yet → legacy roster (≤200 rows), paged client-side.
      const all = await adminSearchUsers(debouncedQuery);
      if (seq !== requestSeq.current) return;
      setLegacy(true);
      const filtered = all.filter((u) => plan === "premium" ? u.is_premium : plan === "free" ? !u.is_premium : true);
      setTotal(filtered.length);
      setRows(filtered.slice(page * USERS_PAGE_SIZE, (page + 1) * USERS_PAGE_SIZE));
      setLoading(false);
    })();
  }, [debouncedQuery, plan, activity, sort, dir, page]);

  const patchRow = (id: string, fields: Partial<AdminUserListRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)));

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
        ? "Already a user. Friend request sent."
        : res.note === "resent"
          ? `Invite re-sent to ${inviteEmail.trim()}.`
          : `Invite emailed to ${inviteEmail.trim()}.`,
    });
    setInviteEmail("");
    setInviteName("");
  };

  const grant = async (u: AdminUserListRow, months: 1 | 12) => {
    setBusyId(`${u.id}:${months}`);
    setError(null);
    const result = await adminGrantPremium(u.id, months, "Granted from Roamly Flow admin portal");
    setBusyId(null);
    if (result.error) { setError(result.error); return; }
    patchRow(u.id, { is_premium: true, premium_expires_at: result.expiresAt ?? u.premium_expires_at });
  };

  const confirmRevoke = async (u: AdminUserListRow) => {
    setBusyId(`${u.id}:revoke`);
    setError(null);
    const result = await adminRevokePremium(u.id);
    setBusyId(null);
    setPending(null);
    if (result.error) { setError(result.error); return; }
    // Access is revoked even when Stripe couldn't cancel; surface the
    // follow-up so the admin checks the Stripe dashboard.
    if (result.stripeWarning) setError(`Roamly access revoked. ${result.stripeWarning}`);
    patchRow(u.id, { is_premium: false });
  };

  // One credit at a time, per the admin_adjust_credits contract; the RPC
  // returns the authoritative new balance which replaces the shown value.
  const adjustCredits = async (u: AdminUserListRow, delta: 1 | -1) => {
    setBusyId(`${u.id}:credits`);
    setError(null);
    const result = await adminAdjustCredits(u.id, delta);
    setBusyId(null);
    if (result.error) { setError(result.error); return; }
    patchRow(u.id, { ai_credits: result.balance });
  };

  // Permanent, typed-confirmation account deletion. Billing is canceled
  // server-side first; the auth delete cascades through every app table.
  const confirmDelete = async (u: AdminUserListRow) => {
    setBusyId(`${u.id}:delete`);
    setError(null);
    const result = await adminDeleteUser(u.id);
    setBusyId(null);
    setPending(null);
    if (result.error) { setError(result.error); return; }
    if (result.stripeWarning) setError(`Account deleted. ${result.stripeWarning}`);
    setRows((prev) => prev.filter((r) => r.id !== u.id));
    setTotal((t) => Math.max(0, t - 1));
  };

  const nameOf = (u: AdminUserListRow) => u.display_name || u.username || u.email || "this user";
  const lastPage = Math.max(0, Math.ceil(total / USERS_PAGE_SIZE) - 1);
  const rangeStart = total === 0 ? 0 : page * USERS_PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, (page + 1) * USERS_PAGE_SIZE);

  return (
    <>
      <div className="mt-6 rounded-2xl border border-border bg-card/70 p-4">
        <h2 className="text-sm font-semibold">Invite by email</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Emails them an invite to join Roamly Flow (or sends a friend request if they're already a user).</p>
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

      <h2 className="mt-8 text-sm font-semibold">Manage users</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Search, filter, and sort the roster. Only the visible page is fetched.</p>
      <div className="relative mt-3">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by email, username, or name…"
          className="w-full rounded-xl border border-border bg-card py-3 pl-9 pr-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {USER_PLAN_FILTERS.filter((f) => !legacy || f.value !== "admin").map((f) => (
          <button key={f.value} onClick={() => setPlan(f.value)} aria-pressed={plan === f.value}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${plan === f.value ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 text-muted-foreground hover:border-primary/40"}`}>
            {f.label}
          </button>
        ))}
        {!legacy && (
          <>
            <span aria-hidden className="mx-1 h-4 w-px bg-border" />
            {USER_ACTIVITY_FILTERS.map((f) => (
              <button key={f.value} onClick={() => setActivity(f.value)} aria-pressed={activity === f.value}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${activity === f.value ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 text-muted-foreground hover:border-primary/40"}`}>
                {f.label}
              </button>
            ))}
            <span className="ml-auto flex items-center gap-1.5">
              <ThemedSelect value={sort} onChange={(v) => setSort(v as AdminUserSort)} ariaLabel="Sort users by" className="w-36"
                options={USER_SORT_OPTIONS} />
              <button onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))}
                aria-label={`Sort direction: ${dir === "asc" ? "ascending" : "descending"}. Toggle`}
                className="grid h-10 w-10 place-items-center rounded-xl border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
                <ArrowUpDown size={14} className={dir === "asc" ? "" : "opacity-60"} />
              </button>
            </span>
          </>
        )}
      </div>
      {legacy && <p className="mt-2 text-[11px] text-muted-foreground">Server-side paging isn't deployed yet — showing up to 200 matches with basic filters.</p>}
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-4 space-y-2" aria-busy={loading}>
        <p className="px-1 text-xs text-muted-foreground" role="status">
          {loading ? "Loading users…" : total === 0 ? (debouncedQuery ? "No users match that search." : "No users yet.") : `Showing ${rangeStart}–${rangeEnd} of ${total} user${total === 1 ? "" : "s"}`}
        </p>
        {rows.map((u) => (
          <div key={u.id} className={`rounded-xl border border-border bg-card/70 p-3 ${loading ? "opacity-60" : ""}`}>
            {/* Stacks on phones (identity row, then actions) so the name/email
                block is never crushed to zero width by the buttons; from sm it
                lays back out as a single row. */}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3">
              <div className="flex min-w-0 items-start gap-2 sm:flex-1 sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{u.display_name || u.username || u.email || "Unnamed user"}</p>
                <p className="truncate text-xs text-muted-foreground">{u.email}{u.username ? ` · @${u.username}` : ""}</p>
                <p className="flex flex-wrap items-center gap-1 truncate text-[11px] text-muted-foreground">
                  <button onClick={() => adjustCredits(u, -1)} disabled={busyId !== null || (u.ai_credits ?? 0) === 0}
                    aria-label={`Remove one credit from ${u.email ?? u.id}`}
                    className="grid h-5 w-5 place-items-center rounded border border-border text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-40">−</button>
                  <span className="font-mono">{busyId === `${u.id}:credits` ? "…" : (u.ai_credits ?? 0)}</span>
                  <button onClick={() => adjustCredits(u, 1)} disabled={busyId !== null}
                    aria-label={`Add one credit to ${u.email ?? u.id}`}
                    className="grid h-5 w-5 place-items-center rounded border border-border text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-40">+</button>
                  credit{(u.ai_credits ?? 0) === 1 ? "" : "s"}
                  {typeof u.ai_uploads_count === "number" ? ` · ${u.ai_uploads_count} upload${u.ai_uploads_count === 1 ? "" : "s"} used${u.ai_uploads_period ? ` in ${u.ai_uploads_period}` : ""}` : ""}
                  {u.is_premium && u.premium_expires_at ? ` · Premium through ${new Date(u.premium_expires_at).toLocaleDateString()}` : ""}
                </p>
                {(u.created_at || u.last_active) && (
                  <p className="truncate text-[11px] text-muted-foreground/80">
                    {u.created_at ? `Joined ${new Date(u.created_at).toLocaleDateString()}` : ""}
                    {u.created_at && u.last_active ? " · " : ""}
                    {u.last_active ? `Active ${relTime(u.last_active)}` : ""}
                  </p>
                )}
              </div>
              {u.is_premium && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                  <Crown size={11} /> Premium
                </span>
              )}
              </div>
              <div className="flex shrink-0 flex-wrap gap-1 sm:justify-end">
                {u.is_premium && (
                  <button onClick={() => setPending({ kind: "revoke", user: u })} disabled={busyId !== null}
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
                <button onClick={() => setPending({ kind: "delete", user: u })} disabled={busyId !== null} aria-label={`Delete account for ${u.email ?? u.id}`}
                  className="rounded-full border border-destructive/50 px-2.5 py-1.5 text-xs font-semibold text-destructive transition hover:bg-destructive/10 disabled:opacity-50">
                  {busyId === `${u.id}:delete` ? "…" : <Trash2 size={12} className="inline" />}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {total > USERS_PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between gap-2">
          <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loading}
            className="flex items-center gap-1 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-40">
            <ChevronLeft size={13} /> Previous
          </button>
          <span className="text-xs text-muted-foreground">Page {page + 1} of {lastPage + 1}</span>
          <button onClick={() => setPage((p) => Math.min(lastPage, p + 1))} disabled={page >= lastPage || loading}
            className="flex items-center gap-1 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground disabled:opacity-40">
            Next <ChevronRight size={13} />
          </button>
        </div>
      )}

      {pending?.kind === "revoke" && (
        <AdminConfirmDialog title="Revoke Premium?"
          body={`Cancels any active Stripe subscription and removes all current Premium access for ${nameOf(pending.user)} (${pending.user.email ?? "no email"}). Cancellation is immediate and does not automatically refund prior charges.`}
          confirmLabel="Revoke Premium" busy={busyId === `${pending.user.id}:revoke`}
          onConfirm={() => void confirmRevoke(pending.user)} onClose={() => setPending(null)} />
      )}
      {pending?.kind === "delete" && (
        <AdminConfirmDialog title="Delete this account?"
          body={`PERMANENTLY deletes the account for ${nameOf(pending.user)} (${pending.user.email ?? "no email"}).\n\nThis cancels their Stripe billing and erases their profile, tasks, focus history, gamification, rooms, and feedback. It cannot be undone.`}
          confirmLabel="Delete account" typedWord="DELETE" busy={busyId === `${pending.user.id}:delete`}
          onConfirm={() => void confirmDelete(pending.user)} onClose={() => setPending(null)} />
      )}
    </>
  );
}

// Friendly names for the tracked events so the dashboard reads like features,
// not code. Anything unmapped falls back to its raw name.
const FEEDBACK_STYLE: Record<string, { label: string; cls: string }> = {
  bug: { label: "Bug", cls: "bg-destructive/10 text-destructive" },
  confusing: { label: "Confusing", cls: "bg-primary/10 text-primary" },
  idea: { label: "Idea", cls: "bg-roamly-green/10 text-roamly-green" },
  other: { label: "Other", cls: "bg-secondary text-muted-foreground" },
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-primary/10 text-primary" },
  in_progress: { label: "In progress", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  done: { label: "Done · archived", cls: "bg-roamly-green/10 text-roamly-green" },
};
const STATUS_ORDER = ["open", "in_progress", "done"] as const;

// Done tickets are treated as ARCHIVED: the default view shows only active
// work (open + in progress), and marking a ticket done moves it to the
// Archived filter immediately, keeping the inbox focused.
function AdminFeedback() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"active" | "open" | "in_progress" | "archived">("active");

  const load = () => adminListFeedback(100).then((r) => { setRows(r); setLoaded(true); });
  useEffect(() => { load(); }, []);

  const shown = rows.filter((r) =>
    filter === "active" ? r.status !== "done"
      : filter === "archived" ? r.status === "done"
        : r.status === filter);

  const patchRow = (id: string, fields: Partial<FeedbackRow>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...fields } : r)));

  const FILTER_LABEL: Record<typeof filter, string> = { active: "Active", open: "Open", in_progress: "In progress", archived: "Archived" };
  const archivedCount = rows.filter((r) => r.status === "done").length;

  return (
    <div className="mt-5">
      <div className="flex flex-wrap gap-1.5">
        {(["active", "open", "in_progress", "archived"] as const).map((id) => (
          <button key={id} onClick={() => setFilter(id)} aria-pressed={filter === id}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${filter === id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card/70 text-muted-foreground hover:border-primary/40"}`}>
            {FILTER_LABEL[id]}{id === "archived" && archivedCount > 0 ? ` (${archivedCount})` : ""}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {!loaded && <p className="text-sm text-muted-foreground">Loading feedback…</p>}
        {loaded && shown.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">
            {filter === "active"
              ? "No active tickets. Users can send feedback from their profile menu → Send feedback."
              : filter === "archived"
                ? "Nothing archived yet. Tickets land here when they're marked done."
                : `No ${FILTER_LABEL[filter].toLowerCase()} tickets.`}
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
  const [deleteTarget, setDeleteTarget] = useState<AdSubmissionRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { adminListAdSubmissions(100).then((r) => { setRows(r); setLoaded(true); }); }, []);

  const setStatus = async (id: string, status: AdStatus) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    await adminSetAdSubmissionStatus(id, status);
  };
  const confirmRemove = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await adminDeleteAdSubmission(deleteTarget.id);
    setDeleting(false);
    if (!res.error) setRows((prev) => prev.filter((r) => r.id !== deleteTarget.id));
    setDeleteTarget(null);
  };

  return (
    <div className="mt-5 space-y-2">
      {!loaded && <p className="text-sm text-muted-foreground">Loading ad submissions…</p>}
      {loaded && rows.length === 0 && (
        <p className="rounded-2xl border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">
          No ad submissions yet. Non-premium users can submit one from the break-time “Advertise on Roamly Flow” prompt.
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
              <ThemedSelect value={a.status} onChange={(v) => setStatus(a.id, v as AdStatus)} ariaLabel="Ad submission status" className="w-32"
                options={AD_STATUS_OPTIONS.map((s) => ({ value: s, label: s }))} />
              <button onClick={() => setDeleteTarget(a)} aria-label="Delete submission"
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
      {deleteTarget && (
        <AdminConfirmDialog title="Delete this ad submission?"
          body={`Removes the submission from ${deleteTarget.business_name} (${deleteTarget.contact_email}). This can't be undone.`}
          confirmLabel="Delete submission" busy={deleting}
          onConfirm={() => void confirmRemove()} onClose={() => { if (!deleting) setDeleteTarget(null); }} />
      )}
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
    setBusy("delete"); setErr(null);
    const e = await adminFeedbackAction("delete", f.id);
    setBusy(null);
    setConfirmingDelete(false);
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
          placeholder="Internal note / reply, also posted on the GitHub issue if linked…"
          className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
        <div className="mt-1.5 flex items-center gap-2">
          <button onClick={sendReply} disabled={busy === "reply" || !reply.trim()}
            className="rounded-full gradient-primary px-3.5 py-1.5 text-xs font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-50">
            {busy === "reply" ? "Saving…" : f.admin_reply ? "Update reply" : "Save reply"}
          </button>
          <button onClick={() => setConfirmingDelete(true)} disabled={busy === "delete"}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-destructive/50 hover:text-destructive disabled:opacity-50">
            <Trash2 size={12} /> {busy === "delete" ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
      {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
      {confirmingDelete && (
        <AdminConfirmDialog title="Delete this feedback?"
          body={`Deletes the ${style.label.toLowerCase()} ticket from ${f.email ?? "an unknown user"}. This can't be undone.`}
          confirmLabel="Delete ticket" busy={busy === "delete"}
          onConfirm={() => void remove()} onClose={() => { if (busy !== "delete") setConfirmingDelete(false); }} />
      )}
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

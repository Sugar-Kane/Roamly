import { useCallback, useEffect, useState } from "react";
import { X, UserPlus, Check, Search, Users } from "lucide-react";
import {
  fetchFriendships, searchUsers, findUserByEmail, sendFriendRequest, respondFriendRequest, removeFriendship,
  setUsername, getPublicProfiles, type Friendship, type PublicProfile,
} from "./rooms";
import type { Profile } from "./db";
import type { Session } from "@supabase/supabase-js";

export function displayNameOf(p: PublicProfile | undefined | null): string {
  return p?.display_name || p?.username || "someone";
}

export function UsernameSetup({ onSaved }: { onSaved: (username: string) => void }) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const u = draft.trim().toLowerCase();
    if (!u) return;
    setSaving(true);
    const err = await setUsername(u);
    setSaving(false);
    if (err) { setError(err); return; }
    onSaved(u);
  };

  return (
    <div className="rounded-2xl border border-dashed border-border bg-card/60 p-4">
      <p className="text-sm font-medium">Pick a username</p>
      <p className="mt-0.5 text-xs text-muted-foreground">It's how friends find you and how you appear in rooms and chat.</p>
      <div className="mt-3 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="e.g. pa_student_amy"
          className="flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
        <button onClick={save} disabled={saving || !draft.trim()}
          className="rounded-xl gradient-primary px-4 py-2 text-sm font-semibold text-white shadow-glow disabled:opacity-40">
          Save
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function FriendsModal({ session, profile, onClose, onUsernameSet }: {
  session: Session;
  profile: Profile | null;
  onClose: () => void;
  onUsernameSet: (username: string) => void;
}) {
  const myId = session.user.id;
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  const [people, setPeople] = useState<Map<string, PublicProfile>>(new Map());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [emailNoMatch, setEmailNoMatch] = useState(false);
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const rows = await fetchFriendships();
    setFriendships(rows);
    const others = rows.map((f) => (f.requester === myId ? f.addressee : f.requester));
    setPeople(await getPublicProfiles(others));
  }, [myId]);

  useEffect(() => { reload(); }, [reload]);

  // Debounced search: a full email address does an exact-match lookup (works
  // even for classmates who haven't picked a username yet); anything else
  // searches usernames/display names.
  useEffect(() => {
    const q = query.trim();
    setEmailNoMatch(false);
    if (q.length < 2) { setResults([]); return; }
    const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q);
    const t = setTimeout(() => {
      if (isEmail) {
        findUserByEmail(q).then((p) => {
          setResults(p ? [p] : []);
          setEmailNoMatch(!p);
        });
      } else {
        searchUsers(q).then(setResults);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const linkedIds = new Set(friendships.map((f) => (f.requester === myId ? f.addressee : f.requester)));
  const incoming = friendships.filter((f) => f.status === "pending" && f.addressee === myId);
  const outgoing = friendships.filter((f) => f.status === "pending" && f.requester === myId);
  const accepted = friendships.filter((f) => f.status === "accepted");

  const add = async (target: PublicProfile) => {
    setError(null);
    const err = await sendFriendRequest(target.id);
    if (err) { setError(err); return; }
    setRequested((prev) => new Set(prev).add(target.id));
    reload();
  };

  const respond = async (id: string, accept: boolean) => {
    await respondFriendRequest(id, accept);
    reload();
  };

  const remove = async (id: string) => {
    await removeFriendship(id);
    reload();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-5 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-3xl border border-border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-xl font-semibold"><Users size={18} className="text-primary" /> Friends</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        {!profile?.username ? (
          <div className="mt-4"><UsernameSetup onSaved={onUsernameSet} /></div>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted-foreground">You're @{profile.username}. Friends get notified when you start or join a study room.</p>

            <div className="relative mt-4">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find classmates by username or email…"
                className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
            </div>
            {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
            {emailNoMatch && (
              <p className="mt-1.5 text-xs text-muted-foreground">No Roamly account uses that email yet — double-check it, or invite them to sign up.</p>
            )}
            {results.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {results.map((p) => {
                  const already = linkedIds.has(p.id) || requested.has(p.id);
                  return (
                    <div key={p.id} className="flex items-center justify-between rounded-xl border border-border bg-card/70 px-3 py-2">
                      <PersonLabel person={p} fallbackName={query.trim()} />
                      <button onClick={() => add(p)} disabled={already}
                        className="flex items-center gap-1.5 rounded-full gradient-primary px-3 py-1 text-xs font-semibold text-white shadow-glow disabled:opacity-40">
                        <UserPlus size={12} /> {already ? "Sent" : "Add"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {incoming.length > 0 && (
              <section className="mt-5">
                <h4 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Requests</h4>
                <div className="mt-2 space-y-1.5">
                  {incoming.map((f) => (
                    <div key={f.id} className="flex items-center justify-between rounded-xl border border-border bg-card/70 px-3 py-2">
                      <PersonLabel person={people.get(f.requester)} />
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => respond(f.id, true)}
                          className="flex items-center gap-1 rounded-full gradient-primary px-3 py-1 text-xs font-semibold text-white shadow-glow">
                          <Check size={12} /> Accept
                        </button>
                        <button onClick={() => respond(f.id, false)} className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground">
                          Decline
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section className="mt-5">
              <h4 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Your friends</h4>
              {accepted.length === 0 && outgoing.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground">No friends yet — search above to add classmates.</p>
              )}
              <div className="mt-2 space-y-1.5">
                {accepted.map((f) => (
                  <div key={f.id} className="group flex items-center justify-between rounded-xl border border-border bg-card/70 px-3 py-2">
                    <PersonLabel person={people.get(f.requester === myId ? f.addressee : f.requester)} />
                    <button onClick={() => remove(f.id)} className="text-xs text-muted-foreground underline opacity-100 hover:text-destructive sm:opacity-0 sm:group-hover:opacity-100">
                      Remove
                    </button>
                  </div>
                ))}
                {outgoing.map((f) => (
                  <div key={f.id} className="flex items-center justify-between rounded-xl border border-dashed border-border bg-card/50 px-3 py-2">
                    <PersonLabel person={people.get(f.addressee)} />
                    <span className="text-xs text-muted-foreground">Request sent</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function PersonLabel({ person, fallbackName }: { person: PublicProfile | undefined | null; fallbackName?: string }) {
  // fallbackName covers email-lookup results for users with no username yet:
  // show the address the searcher typed rather than an anonymous "someone".
  const name = person?.display_name || person?.username || fallbackName || "someone";
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold uppercase text-primary">
        {name.slice(0, 2)}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm">{name}</span>
        {person?.username && <span className="block text-[11px] text-muted-foreground">@{person.username}</span>}
      </span>
    </span>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Users, Plus, X, DoorOpen, Send, MessageCircle, Lock, Infinity as InfinityIcon, UserPlus, LogOut, Search, Heart, Music } from "lucide-react";
import { supabase } from "./supabaseClient";
import {
  fetchRooms, createRoom, deleteRoom, reapRoom, roomPhaseAt, notifyFriendsOfRoom, inviteToRoom,
  fetchMessages, sendMessage, fetchFriendships, getPublicProfiles, heartbeatRoom, clearRoomHeartbeat,
  setRoomMusic,
  type LiveRoom, type RoomMessage, type PublicProfile,
} from "./rooms";
import { fmt } from "./useTimer";
import { playChime } from "./sound";
import { startFocusSound, stopFocusSound, unlockAudio, FOCUS_SOUNDS, type FocusSoundId } from "./focusSounds";
import { VoiceDock } from "./RoomVoice";
import { ROOMS } from "./data";
import { displayNameOf } from "./Friends";
import type { Profile } from "./db";
import type { Session } from "@supabase/supabase-js";

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const PHASE_LABEL = { focus: "Focus", short: "Short break", long: "Long break" } as const;

function phaseColor(phase: "focus" | "short" | "long"): string {
  return phase === "focus" ? "hsl(var(--primary))" : "hsl(var(--roamly-green))";
}

type RoomsLiveProps = {
  session: Session | null;
  profile: Profile | null;
  isPremium: boolean;
  gateThen: (fn: () => void) => void;
  onSignIn: () => void;
  onNeedUsername: () => void;
  onOpenFriends: () => void;
  targetRoomId: string | null;
  onTargetConsumed: () => void;
  // Whether the user's global "Play with timer" switch is on — the room music
  // honors it as the mute path. onInRoom lets App hand audio control to the
  // room (so the personal-timer sound effect doesn't fight it).
  soundAuto: boolean;
  onInRoom: (inRoom: boolean) => void;
};

export function RoomsLive(props: RoomsLiveProps) {
  if (!supabase || !props.session) return <DemoRooms onSignIn={props.onSignIn} />;
  return <LiveLobby {...props} session={props.session} />;
}

// Signed-out (or Supabase-less) fallback: the original demo grid.
function DemoRooms({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-3xl font-semibold">Study rooms</h1>
      <p className="mt-1 text-sm text-muted-foreground">Focus alongside other PA students in real time.</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-border bg-card/60 p-4">
        <span className="text-sm text-muted-foreground">Sign in to join live rooms, add friends, and chat during breaks.</span>
        <button onClick={onSignIn} className="shrink-0 rounded-full gradient-primary px-4 py-1.5 text-xs font-semibold text-white shadow-glow">Sign in</button>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 opacity-70">
        {ROOMS.map((r) => (
          <div key={r.id} className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold">{r.name}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{r.focus} · hosted by {r.host}</p>
              </div>
              <span className="mt-1.5 h-2 w-2 animate-pulse rounded-full bg-roamly-green" />
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Users size={13} /> {r.members}/{r.cap}</div>
              <span className="rounded-full border border-border px-4 py-1.5 text-sm text-muted-foreground">Preview</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveLobby({ session, profile, isPremium, gateThen, onNeedUsername, onOpenFriends, targetRoomId, onTargetConsumed, soundAuto, onInRoom }: RoomsLiveProps & { session: Session }) {
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const [active, setActive] = useState<LiveRoom | null>(null);
  const [occupancy, setOccupancy] = useState<Map<string, number>>(new Map());
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [showAllHosted, setShowAllHosted] = useState(false);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const emptySince = useRef<Map<string, number>>(new Map()); // hosted roomId → ms it went empty
  const now = useNow();

  const reload = useCallback(() => { fetchRooms().then(setRooms); }, []);
  useEffect(() => { reload(); }, [reload]);

  // Accepted friends' user ids — used to surface friends' rooms at the top.
  useEffect(() => {
    fetchFriendships().then((rows) => {
      const me = session.user.id;
      setFriendIds(new Set(rows.filter((f) => f.status === "accepted").map((f) => (f.requester === me ? f.addressee : f.requester))));
    });
  }, [session.user.id]);

  // Keep the lobby list live as rooms are created/ended anywhere.
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const channel = client
      .channel("rooms-lobby")
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms" }, reload)
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [reload]);

  // Live head-counts: observe presence channels without joining them — but
  // only for rooms the lobby actually renders (system + newest hosted), so a
  // pile of stale rooms can't burn a realtime connection per room.
  const watchedRooms = [
    ...rooms.filter((r) => r.is_system),
    ...rooms.filter((r) => !r.is_system).slice(0, 15),
  ];
  const roomIdsKey = watchedRooms.map((r) => r.id).join(",");
  useEffect(() => {
    if (!supabase || active) return; // in a room, the lobby isn't visible
    const client = supabase;
    const channels = watchedRooms.map((room) => {
      const ch = client.channel(`room:${room.id}`);
      ch.on("presence", { event: "sync" }, () => {
        const count = Object.keys(ch.presenceState()).length;
        setOccupancy((prev) => new Map(prev).set(room.id, count));
        // Track how long each hosted room has been empty, for the 2-min reap.
        if (!room.is_system) {
          if (count > 0) emptySince.current.delete(room.id);
          else if (!emptySince.current.has(room.id)) emptySince.current.set(room.id, Date.now());
        }
      }).subscribe();
      return ch;
    });
    return () => { channels.forEach((ch) => client.removeChannel(ch)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomIdsKey, active]);

  // Auto-end hosted rooms that have sat empty for 2 minutes. reap_room's own
  // age guard makes this safe even if a room only just went empty.
  useEffect(() => {
    if (!supabase || active) return;
    const iv = window.setInterval(() => {
      const cutoff = Date.now() - 120_000;
      let reaped = false;
      for (const [id, since] of emptySince.current) {
        if (since <= cutoff) { void reapRoom(id); emptySince.current.delete(id); reaped = true; }
      }
      if (reaped) reload();
    }, 10_000);
    return () => window.clearInterval(iv);
  }, [active, reload]);

  // Arriving from a notification ("X invited you to …") — jump straight in.
  useEffect(() => {
    if (!targetRoomId || rooms.length === 0) return;
    const room = rooms.find((r) => r.id === targetRoomId);
    onTargetConsumed();
    if (room) join(room);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetRoomId, rooms]);

  const join = (room: LiveRoom) => {
    if (!profile?.username) { onNeedUsername(); return; }
    unlockAudio(); // synchronous, inside the tap — lets room music play on iOS
    setActive(room);
    notifyFriendsOfRoom(room.id, "room_joined");
  };

  // Keep the joined room's fields fresh from the live lobby list — so when a
  // host changes the room's music, everyone already inside picks it up.
  useEffect(() => {
    if (!active) return;
    const fresh = rooms.find((r) => r.id === active.id);
    if (fresh && fresh.music !== active.music) setActive(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rooms]);

  const host = () => {
    if (!profile?.username) { onNeedUsername(); return; }
    gateThen(() => setShowCreate(true));
  };

  const created = (room: LiveRoom) => {
    unlockAudio(); // room music will start on iOS — this runs off the Create tap
    setShowCreate(false);
    setRooms((prev) => [room, ...prev]);
    setActive(room);
    notifyFriendsOfRoom(room.id, "room_created");
  };

  if (active) {
    return (
      <RoomView room={active} session={session} profile={profile} now={now}
        isPremium={isPremium} gateThen={gateThen} soundAuto={soundAuto} onInRoom={onInRoom}
        onMusicChange={(music) => setActive((prev) => (prev ? { ...prev, music } : prev))}
        onLeave={() => { setActive(null); reload(); }}
        onEnded={() => { setActive(null); reload(); }} />
    );
  }

  const systemRooms = rooms.filter((r) => r.is_system);
  const q = query.trim().toLowerCase();
  // Hosted rooms: filter by search, then most-active first, then newest.
  const hostedAll = rooms
    .filter((r) => !r.is_system)
    .filter((r) => !q || r.name.toLowerCase().includes(q) || (r.topic ?? "").toLowerCase().includes(q))
    .sort((a, b) => {
      const oa = occupancy.get(a.id) ?? 0;
      const ob = occupancy.get(b.id) ?? 0;
      if (ob !== oa) return ob - oa;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  const friendsRooms = hostedAll.filter((r) => r.host_id != null && friendIds.has(r.host_id));
  const otherRooms = hostedAll.filter((r) => !(r.host_id != null && friendIds.has(r.host_id)));
  const HOSTED_CAP = 10;
  const visibleOther = showAllHosted ? otherRooms : otherRooms.slice(0, HOSTED_CAP);
  const totalHosted = rooms.filter((r) => !r.is_system).length;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-3xl font-semibold">Study rooms</h1>
          <p className="mt-1 text-sm text-muted-foreground">Live sessions with a shared timer. Chat and voice open during breaks.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={onOpenFriends}
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
            <Users size={15} /> Friends
          </button>
          <button onClick={host} className="flex items-center gap-1.5 rounded-full gradient-primary px-4 py-2 text-sm font-semibold text-white shadow-glow transition active:scale-95">
            <Plus size={16} /> Host
          </button>
        </div>
      </div>

      {totalHosted > 0 && (
        <div className="relative mt-5">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search hosted rooms by name or topic…"
            className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
        </div>
      )}

      <section className="mt-6">
        <h2 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <InfinityIcon size={13} /> Always-on rooms
        </h2>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {systemRooms.map((r) => (
            <RoomCard key={r.id} room={r} now={now} count={occupancy.get(r.id) ?? 0} onJoin={() => join(r)} />
          ))}
        </div>
      </section>

      {friendsRooms.length > 0 && (
        <section className="mt-6">
          <h2 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <Heart size={12} className="text-primary" /> Friends' rooms
          </h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {friendsRooms.map((r) => (
              <RoomCard key={r.id} room={r} now={now} count={occupancy.get(r.id) ?? 0} onJoin={() => join(r)} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {q ? "Search results" : "Hosted by students"}
        </h2>
        {otherRooms.length === 0 ? (
          <p className="mt-2 rounded-2xl border border-dashed border-border bg-card/60 p-4 text-sm text-muted-foreground">
            {q
              ? "No rooms match your search."
              : friendsRooms.length > 0
                ? "No other hosted rooms right now."
                : "No hosted rooms right now — start one and your friends get notified."}
          </p>
        ) : (
          <>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {visibleOther.map((r) => (
                <RoomCard key={r.id} room={r} now={now} count={occupancy.get(r.id) ?? 0} onJoin={() => join(r)} />
              ))}
            </div>
            {!showAllHosted && otherRooms.length > HOSTED_CAP && (
              <button onClick={() => setShowAllHosted(true)}
                className="mt-3 w-full rounded-xl border border-border bg-card/60 py-2.5 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
                Show {otherRooms.length - HOSTED_CAP} more
              </button>
            )}
          </>
        )}
      </section>

      {!isPremium && (
        <p className="mt-5 text-center text-xs text-muted-foreground">Free plan: join up to 3 sessions a day. <span className="text-primary">Premium</span> removes all limits.</p>
      )}

      {showCreate && <CreateRoomModal hostId={session.user.id} onClose={() => setShowCreate(false)} onCreated={created} />}
    </div>
  );
}

function RoomCard({ room, now, count, onJoin }: { room: LiveRoom; now: number; count: number; onJoin: () => void }) {
  const info = roomPhaseAt(room, now);
  const full = count >= room.cap;
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate font-semibold">{room.name}</h3>
          {/* Always-on community rooms aren't tied to a subject — show their
              rhythm instead of a topic. */}
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {room.is_system ? `${room.focus_min}/${room.short_min} rhythm · always on` : room.topic}
          </p>
        </div>
        <span className="mt-1 flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-medium text-white" style={{ background: phaseColor(info.phase) }}>
          {PHASE_LABEL[info.phase]} · {fmt(info.secondsLeft)}
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users size={13} /> {count}/{room.cap}
          <span className="ml-1.5 font-mono">{room.focus_min}/{room.short_min}</span>
        </div>
        <button onClick={onJoin} disabled={full}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${full ? "cursor-not-allowed border border-border bg-secondary text-muted-foreground" : "gradient-primary text-white shadow-glow active:scale-95"}`}>
          {full ? "Full" : "Join"}
        </button>
      </div>
    </div>
  );
}

const ROOM_PRESETS = [
  { label: "Classic 25/5", focus_min: 25, short_min: 5, long_min: 15, cycles: 4 },
  { label: "Deep Work 50/10", focus_min: 50, short_min: 10, long_min: 20, cycles: 3 },
  { label: "Sprint 15/3", focus_min: 15, short_min: 3, long_min: 10, cycles: 5 },
  { label: "Clinical 90/20", focus_min: 90, short_min: 20, long_min: 30, cycles: 2 },
];

function CreateRoomModal({ hostId, onClose, onCreated }: { hostId: string; onClose: () => void; onCreated: (room: LiveRoom) => void }) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [preset, setPreset] = useState(0);
  const [cap, setCap] = useState(12);
  const [music, setMusic] = useState<FocusSoundId>("lofi");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (name.trim().length < 3) { setError("Give your room a name (3+ characters)."); return; }
    setSaving(true);
    setError(null);
    const { label, ...method } = ROOM_PRESETS[preset];
    void label;
    const room = await createRoom(hostId, { name: name.trim(), topic: topic.trim() || "Open study", cap, music, ...method });
    setSaving(false);
    if (!room) { setError("Couldn't create the room — try again."); return; }
    onCreated(room);
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-5 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-xl font-semibold"><DoorOpen size={18} className="text-primary" /> Host a room</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">The timer starts the moment you create it, and your friends get notified.</p>
        <div className="mt-4 space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Room name — e.g. Pharm Power Hour" maxLength={60}
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (optional) — e.g. Beta-blockers review" maxLength={80}
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <div className="grid grid-cols-2 gap-2">
            {ROOM_PRESETS.map((p, i) => (
              <button key={p.label} onClick={() => setPreset(i)}
                className={`rounded-xl border px-3 py-2 text-left text-sm transition ${preset === i ? "border-primary bg-primary/5 font-medium" : "border-border bg-card/70 hover:border-primary/40"}`}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Room size</span>
            <select value={cap} onChange={(e) => setCap(Number(e.target.value))}
              className="rounded-xl border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary">
              {[4, 8, 12, 20, 30].map((n) => <option key={n} value={n}>{n} people</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Music</span>
            <select value={music} onChange={(e) => setMusic(e.target.value as FocusSoundId)}
              className="rounded-xl border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary">
              {FOCUS_SOUNDS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
        <button onClick={create} disabled={saving}
          className="mt-4 w-full rounded-full gradient-primary py-2.5 text-sm font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-60">
          {saving ? "Creating…" : "Create and start"}
        </button>
      </div>
    </div>
  );
}

type Member = { id: string; username: string };

function RoomView({ room, session, profile, now, isPremium, gateThen, soundAuto, onInRoom, onMusicChange, onLeave, onEnded }: {
  room: LiveRoom;
  session: Session;
  profile: Profile | null;
  now: number;
  isPremium: boolean;
  gateThen: (fn: () => void) => void;
  soundAuto: boolean;
  onInRoom: (inRoom: boolean) => void;
  onMusicChange: (music: FocusSoundId) => void;
  onLeave: () => void;
  onEnded: () => void;
}) {
  const userId = session.user.id;
  const username = profile?.username ?? "student";
  const [members, setMembers] = useState<Member[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const info = roomPhaseAt(room, now);
  const isHost = room.host_id === userId;
  const music = ((room.music || "lofi") as FocusSoundId);
  const canPickMusic = isHost && !room.is_system;

  // The room owns the audio engine while you're in it: tell App to stand down
  // its personal-timer sound sync, and hand control back on leave.
  useEffect(() => {
    onInRoom(true);
    return () => onInRoom(false);
  }, [onInRoom]);

  // Room music follows the shared timer: the room's track plays during focus
  // blocks and stops for breaks (honoring the global "Play with timer" switch).
  // Deps only change at phase boundaries or when the host swaps the track, so
  // this doesn't re-fire every tick. Stop on leave/unmount.
  useEffect(() => {
    if (soundAuto && info.phase === "focus") startFocusSound(music);
    else stopFocusSound();
  }, [info.phase, soundAuto, music]);
  useEffect(() => () => { stopFocusSound(); }, []);

  const chooseMusic = (id: FocusSoundId) => {
    unlockAudio();
    onMusicChange(id);        // updates local room → restarts the sync effect
    setRoomMusic(room.id, id); // persist so everyone in the room hears it
  };
  const musicName = FOCUS_SOUNDS.find((s) => s.id === music)?.name ?? "Lofi beats";

  // Join the room's presence channel: everyone in it sees everyone else live,
  // and disconnects (closed tabs included) drop out automatically.
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const ch = client.channel(`room:${room.id}`, { config: { presence: { key: userId } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ username: string }>();
      setMembers(Object.entries(state).map(([id, metas]) => ({ id, username: metas[0]?.username ?? "student" })));
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") ch.track({ username });
    });
    return () => { client.removeChannel(ch); };
  }, [room.id, userId, username]);

  // Heartbeat: tells the server this room is occupied, which blocks reap_room
  // from deleting it. Upsert on join + every minute; clear on leave.
  useEffect(() => {
    heartbeatRoom(room.id, userId);
    const iv = window.setInterval(() => heartbeatRoom(room.id, userId), 60_000);
    return () => {
      window.clearInterval(iv);
      clearRoomHeartbeat(room.id, userId);
    };
  }, [room.id, userId]);

  // Chime on every shared-timer phase boundary (study session ending and break
  // ending), matching the personal timer. prevPhase seeds to the current phase
  // so entering a room doesn't chime.
  const prevPhase = useRef(info.phase);
  useEffect(() => {
    if (prevPhase.current !== info.phase) {
      prevPhase.current = info.phase;
      playChime();
    }
  }, [info.phase]);

  // Ending is host-only and blocked during focus, so a host can't pull the room
  // out from under people who are mid-session.
  const canEnd = info.phase !== "focus";
  const endRoom = async () => {
    if (!canEnd) return;
    await deleteRoom(room.id);
    onEnded();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-3xl font-semibold">{room.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {room.is_system ? `Always on · ${room.focus_min}/${room.short_min} rhythm — study anything` : room.topic}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={() => setShowInvite(true)}
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
            <UserPlus size={13} /> Invite
          </button>
          {isHost && (
            <button onClick={endRoom} disabled={!canEnd}
              title={canEnd ? undefined : "You can end the room during a break"}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-destructive/50 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:text-muted-foreground">
              End room
            </button>
          )}
          <button onClick={onLeave}
            className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
            <LogOut size={13} /> Leave
          </button>
        </div>
      </div>
      {isHost && !canEnd && (
        <p className="mt-2 text-[11px] text-muted-foreground">You can end this room once the focus block reaches a break.</p>
      )}

      <section className="mt-5 rounded-3xl border border-border bg-card/80 p-6 shadow-sm">
        <div className="flex flex-col items-center">
          <span className="font-mono text-xs uppercase tracking-[0.25em]" style={{ color: phaseColor(info.phase) }}>
            {PHASE_LABEL[info.phase]} · block {info.focusIndex}/{room.cycles}
          </span>
          <span className="font-display text-7xl font-medium tracking-tight" style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmt(info.secondsLeft)}
          </span>
          <div className="mt-3 h-2.5 w-full max-w-md overflow-hidden rounded-full" style={{ background: "hsl(var(--border))" }}>
            <div className="h-full rounded-full" style={{ width: `${(1 - info.secondsLeft / info.phaseTotal) * 100}%`, background: phaseColor(info.phase), transition: "width 1s linear" }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Everyone in this room sees the same timer.</p>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
          {members.map((m) => (
            <span key={m.id} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${m.id === userId ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground"}`}>
              <span className="grid h-4 place-items-center rounded-full bg-primary/15 px-1 text-[9px] font-semibold uppercase text-primary">{m.username.slice(0, 2)}</span>
              {m.username}{m.id === userId && " (you)"}
            </span>
          ))}
          {members.length === 0 && <span className="text-xs text-muted-foreground">Connecting…</span>}
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-border bg-card/80 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <Music size={13} className="text-primary" /> Room music
          </h2>
          {!canPickMusic && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Lock size={11} /> {musicName}{room.is_system ? " · always on" : ""}
            </span>
          )}
        </div>
        {canPickMusic ? (
          <>
            <p className="mt-1 text-xs text-muted-foreground">Your pick plays for everyone in the room, in sync with the timer.</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FOCUS_SOUNDS.map((s) => {
                const active = music === s.id;
                return (
                  <button key={s.id} onClick={() => chooseMusic(s.id)}
                    className={`relative rounded-xl border px-3 py-2 text-left text-sm transition ${active ? "border-primary bg-primary/5 font-medium shadow-sm" : "border-border bg-card/70 hover:border-primary/40"}`}>
                    <span className="flex items-center gap-1.5">{s.name}
                      {active && info.phase === "focus" && soundAuto && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{s.hint}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            {room.is_system ? "Always-on rooms play lofi beats for everyone." : "The host sets this room's music."}
          </p>
        )}
      </section>

      <VoiceDock roomId={room.id} userId={userId} username={username}
        phase={info.phase} secondsToBreak={info.phase === "focus" ? info.secondsLeft : 0}
        isPremium={isPremium} gateThen={gateThen} />

      <RoomChat room={room} userId={userId} phase={info.phase} secondsToBreak={info.phase === "focus" ? info.secondsLeft : 0} />

      {showInvite && <InviteModal roomId={room.id} myId={userId} onClose={() => setShowInvite(false)} />}
    </div>
  );
}

function RoomChat({ room, userId, phase, secondsToBreak }: { room: LiveRoom; userId: string; phase: "focus" | "short" | "long"; secondsToBreak: number }) {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [names, setNames] = useState<Map<string, PublicProfile>>(new Map());
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const chatOpen = phase !== "focus";

  // History + live inserts.
  useEffect(() => {
    fetchMessages(room.id).then(setMessages);
    if (!supabase) return;
    const client = supabase;
    const channel = client
      .channel(`room-chat:${room.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_messages", filter: `room_id=eq.${room.id}` },
        (payload) => setMessages((prev) => [...prev, payload.new as RoomMessage]))
      .subscribe();
    return () => { client.removeChannel(channel); };
  }, [room.id]);

  // Resolve sender names we haven't seen yet.
  useEffect(() => {
    const unknown = [...new Set(messages.map((m) => m.user_id))].filter((id) => !names.has(id));
    if (unknown.length === 0) return;
    getPublicProfiles(unknown).then((fresh) => setNames((prev) => new Map([...prev, ...fresh])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, chatOpen]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    const err = await sendMessage(room.id, userId, body);
    setSending(false);
    if (err) { setError(err); return; }
    setDraft("");
  };

  return (
    <section className="mt-5 rounded-3xl border border-border bg-card/80 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><MessageCircle size={15} className="text-primary" /> Break-time chat</h2>
        {chatOpen ? (
          <span className="rounded-full bg-roamly-green/10 px-2.5 py-1 text-[11px] font-medium text-roamly-green">Open — it's break time</span>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <Lock size={11} /> Opens at break · {fmt(secondsToBreak)}
          </span>
        )}
      </div>

      <div ref={listRef} className="mt-3 h-64 space-y-2.5 overflow-y-auto rounded-xl border border-border bg-card/60 p-3">
        {messages.length === 0 && (
          <p className="pt-4 text-center text-xs text-muted-foreground">No messages yet. Say hi at the next break.</p>
        )}
        {messages.map((m) => {
          const mine = m.user_id === userId;
          // Always attribute the message — the sender's name for others, "You"
          // for your own — so every line shows who posted it.
          const name = mine ? "You" : displayNameOf(names.get(m.user_id));
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${mine ? "gradient-primary text-white" : "bg-secondary text-secondary-foreground"}`}>
                <span className="block text-[10px] font-semibold opacity-70">{name}</span>
                <span className="block whitespace-pre-wrap break-words text-sm leading-snug">{m.body}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={!chatOpen} maxLength={500}
          placeholder={chatOpen ? "Message the room…" : `Chat opens in ${fmt(secondsToBreak)} — keep focusing`}
          className="flex-1 rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60" />
        <button onClick={send} disabled={!chatOpen || !draft.trim() || sending} aria-label="Send"
          className="grid w-11 place-items-center rounded-xl gradient-primary text-white shadow-glow transition active:scale-95 disabled:opacity-40">
          <Send size={16} />
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
      <p className="mt-2 text-[11px] text-muted-foreground">Chat unlocks during short and long breaks, then locks again when focus starts.</p>
    </section>
  );
}

function InviteModal({ roomId, myId, onClose }: { roomId: string; myId: string; onClose: () => void }) {
  const [friends, setFriends] = useState<PublicProfile[]>([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchFriendships().then(async (rows) => {
      const ids = rows.filter((f) => f.status === "accepted").map((f) => (f.requester === myId ? f.addressee : f.requester));
      const profiles = await getPublicProfiles(ids);
      setFriends(ids.map((id) => profiles.get(id)).filter(Boolean) as PublicProfile[]);
      setLoaded(true);
    });
  }, [myId]);

  const invite = async (friend: PublicProfile) => {
    setError(null);
    const err = await inviteToRoom(roomId, friend.id);
    if (err) { setError(err); return; }
    setInvited((prev) => new Set(prev).add(friend.id));
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-5 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl font-semibold">Invite friends</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        {loaded && friends.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">No friends yet — add classmates from the Friends panel first.</p>
        )}
        <div className="mt-3 space-y-1.5">
          {friends.map((f) => {
            const done = invited.has(f.id);
            const name = displayNameOf(f);
            return (
              <div key={f.id} className="flex items-center justify-between rounded-xl border border-border bg-card/70 px-3 py-2">
                <span className="flex items-center gap-2.5 text-sm">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold uppercase text-primary">{name.slice(0, 2)}</span>
                  {name}
                </span>
                <button onClick={() => invite(f)} disabled={done}
                  className="rounded-full gradient-primary px-3 py-1 text-xs font-semibold text-white shadow-glow disabled:opacity-40">
                  {done ? "Invited" : "Invite"}
                </button>
              </div>
            );
          })}
        </div>
        {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

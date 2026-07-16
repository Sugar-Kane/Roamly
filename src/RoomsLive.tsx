import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Users, Plus, X, DoorOpen, Send, MessageCircle, Lock, Infinity as InfinityIcon, UserPlus, LogOut, Search, Heart, Music, Volume2, VolumeX, Maximize2, HelpCircle, PictureInPicture2 } from "lucide-react";
import { supabase } from "./supabaseClient";
import {
  fetchRooms, createRoom, deleteRoom, reapRoom, roomPhaseAt, roomStationAt, notifyFriendsOfRoom, inviteToRoom,
  fetchMessages, sendMessage, fetchFriendships, getPublicProfiles, heartbeatRoom, clearRoomHeartbeat,
  setRoomMusic, joinRoom, joinRoomByCode, roomNowMs, syncServerClock, fetchRoomOccupancy,
  type LiveRoom, type RoomMessage, type PublicProfile,
} from "./rooms";
import { fmt } from "./useTimer";
import { startFocusSound, stopFocusSound, unlockAudio, playChime, duckFocusSound, FOCUS_SOUNDS, type FocusSoundId } from "./focusSounds";
import { FocusMode, TimeDisplay, InfoTip } from "./FocusMode";
import { PipTimer } from "./PipTimer";
import { Modal } from "./Modal";
import { VoiceDock, VoiceControls, useRoomVoice } from "./RoomVoice";
import { UploadTasksPanel } from "./UploadTasks";
import { ROOMS } from "./data";
import { displayNameOf } from "./Friends";
import { track } from "./track";
import { loadPref, savePref } from "./storage";
import { recordFocusSession } from "./db";
import { syncGamification } from "./gamification";
import { dateKey } from "./streaks";
import type { Profile } from "./db";
import type { Session } from "@supabase/supabase-js";
import { HealthyBreakActivities } from "./HealthyBreakActivities";
import { AdBreakPrompt, AdSubmitModal } from "./AdBreak";

function useNow(): number {
  const [now, setNow] = useState(() => roomNowMs());
  useEffect(() => {
    // One-time server clock sync (no-op after the first call): corrects a
    // skewed device clock so every participant derives the same countdown —
    // and so break chat opens exactly when the database thinks it's open.
    void syncServerClock();
    // Tick aligned to wall-clock second boundaries so every participant's
    // display flips at (nearly) the same instant — free-running 1s intervals
    // start at arbitrary offsets, which made the host's timer read up to a
    // second behind other members'.
    let interval: number | undefined;
    const align = window.setTimeout(() => {
      setNow(roomNowMs());
      interval = window.setInterval(() => setNow(roomNowMs()), 1000);
    }, 1000 - (roomNowMs() % 1000));
    return () => { clearTimeout(align); if (interval) clearInterval(interval); };
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
  completionSoundEnabled: boolean;
  // Fires when a shared room focus block completes naturally, so App can play
  // the completion confetti and its fireworks sound for group and hosted rooms
  // just like a solo focus block.
  onCelebrate: () => void;
  onInRoom: (inRoom: boolean) => void;
  // Bumped by App when the user confirms starting a solo timer while in a
  // room — the lobby leaves the active room so only one timer runs at a time.
  leaveSignal: number;
  // Picture-in-Picture: pop the shared room timer into a floating window. The
  // single window is owned by App; these let a room drive/close it.
  pipSupported: boolean;
  pipWindow: Window | null;
  onPopOut: () => void;
  onClosePip: () => void;
  // For the AI task generator inside hosted rooms: tasks land in the user's
  // own list, and the upgrade CTA goes to checkout.
  onImportedTasks: (rows: unknown[]) => void;
  onUpgrade: () => void;
};

export function RoomsLive(props: RoomsLiveProps) {
  if (!supabase || !props.session) return <DemoRooms onSignIn={props.onSignIn} />;
  return <LiveLobby {...props} session={props.session} />;
}

// Signed-out (or Supabase-less) fallback: the original demo grid.
// First-visit explainer for how shared-timer rooms actually work (tester
// feedback: the concept wasn't obvious). Collapses to a small reopen link
// once dismissed.
function HowRoomsWork() {
  const [open, setOpen] = useState(() => loadPref("roamly-rooms-explainer-seen") !== "1");
  const dismiss = () => { savePref("roamly-rooms-explainer-seen", "1"); setOpen(false); };
  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 transition hover:text-foreground hover:underline">
        <HelpCircle size={13} /> How do rooms work?
      </button>
    );
  }
  return (
    <div className="mt-4 rounded-2xl border border-dashed border-border bg-card/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold"><HelpCircle size={15} className="text-primary" /> How rooms work</h2>
        <button onClick={dismiss} className="shrink-0 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">Got it</button>
      </div>
      <ol className="mt-2.5 space-y-2 text-sm text-muted-foreground">
        <li className="flex gap-2"><span className="font-semibold text-primary">1.</span> With an account, pick a room and hit Join. The timer inside is already running, and everyone in the room shares it.</li>
        <li className="flex gap-2"><span className="font-semibold text-primary">2.</span> Focus together in silence. Music plays if you want it; chat stays locked so nobody can distract you.</li>
        <li className="flex gap-2"><span className="font-semibold text-primary">3.</span> When the break hits, chat and voice open. Say hi, compare notes, then the next focus block starts automatically.</li>
        <li className="flex gap-2"><span className="font-semibold text-primary">4.</span> Premium members can host public or private rooms. Private ones come with an invite code, and invited friends join without one.</li>
      </ol>
      <p className="mt-2.5 text-xs text-muted-foreground">
        Always-on rooms never stop, so there's always one to drop into.
      </p>
    </div>
  );
}

function DemoRooms({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-display text-3xl font-semibold">Study rooms</h1>
      <p className="mt-1 text-sm text-muted-foreground">Focus alongside other PA students in real time.</p>
      <HowRoomsWork />
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
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveLobby({ session, profile, isPremium, gateThen, onNeedUsername, onOpenFriends, targetRoomId, onTargetConsumed, soundAuto, completionSoundEnabled, onCelebrate, onInRoom, leaveSignal, pipSupported, pipWindow, onPopOut, onClosePip, onImportedTasks, onUpgrade }: RoomsLiveProps & { session: Session }) {
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const [active, setActive] = useState<LiveRoom | null>(null);
  // Two head-count sources, merged for display: heartbeat counts (polled RPC,
  // deterministic, covers every room) and realtime presence (instant but
  // best-effort — it can fail silently). Show whichever is higher.
  const [presenceCounts, setPresenceCounts] = useState<Map<string, number>>(new Map());
  const [heartbeatCounts, setHeartbeatCounts] = useState<Map<string, number>>(new Map());
  const occupancy = useMemo(() => {
    const merged = new Map(heartbeatCounts);
    for (const [id, count] of presenceCounts) merged.set(id, Math.max(merged.get(id) ?? 0, count));
    return merged;
  }, [presenceCounts, heartbeatCounts]);
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState("");
  const [showAllHosted, setShowAllHosted] = useState(false);
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set());
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);
  const emptySince = useRef<Map<string, number>>(new Map()); // hosted roomId → ms it went empty
  const now = useNow();

  const reload = useCallback(() => { fetchRooms().then(setRooms); }, []);

  // App bumps leaveSignal when the user confirms starting a solo timer while
  // inside a room — leave it so only one timer runs at a time.
  const leaveSeen = useRef(leaveSignal);
  useEffect(() => {
    if (leaveSignal === leaveSeen.current) return;
    leaveSeen.current = leaveSignal;
    setActive(null);
    reload();
  }, [leaveSignal, reload]);
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

  // Authoritative head-counts: poll the room_occupancy RPC (heartbeat rows
  // fresher than 60s) for EVERY rendered room, on load and every 20s — the
  // same cadence occupants write heartbeats. This is what fixed lobby cards
  // being stuck at 0 for other users when presence silently failed.
  const allRoomIdsKey = rooms.map((r) => r.id).join(",");
  useEffect(() => {
    if (!supabase || active || !allRoomIdsKey) return;
    const ids = allRoomIdsKey.split(",");
    let alive = true;
    const poll = () => {
      fetchRoomOccupancy(ids).then((counts) => { if (alive) setHeartbeatCounts(counts); });
    };
    poll();
    const iv = window.setInterval(poll, 20_000);
    return () => { alive = false; window.clearInterval(iv); };
  }, [allRoomIdsKey, active]);

  // Live head-counts: observe presence channels without joining them — but
  // only for rooms the lobby actually renders (system + newest hosted), so a
  // pile of stale rooms can't burn a realtime connection per room. Presence
  // is a liveness bonus on top of the heartbeat poll above.
  const watchedRooms = [
    ...rooms.filter((r) => r.is_system),
    ...rooms.filter((r) => !r.is_system).slice(0, 15),
  ];
  const roomIdsKey = watchedRooms.map((r) => r.id).join(",");
  useEffect(() => {
    if (!supabase || active) return; // in a room, the lobby isn't visible
    const client = supabase;
    const channels = watchedRooms.map((room) => {
      const ch = client.channel(`room:${room.id}`, { config: { private: true } });
      ch.on("presence", { event: "sync" }, () => {
        const count = Object.keys(ch.presenceState()).length;
        setPresenceCounts((prev) => new Map(prev).set(room.id, count));
      });
      // These subscribes used to swallow CHANNEL_ERROR/TIMED_OUT silently
      // (e.g. an auth-token race right after mount), permanently freezing the
      // card at 0. Log and retry once; beyond that the heartbeat poll covers.
      let retried = false;
      const onStatus = (status: string) => {
        if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT") && !retried) {
          retried = true;
          console.warn("[Roamly] lobby presence subscribe failed", room.id, status);
          window.setTimeout(() => {
            void ch.unsubscribe().then(() => { ch.subscribe(onStatus); }).catch(() => { /* channel removed */ });
          }, 1200);
        }
      };
      ch.subscribe(onStatus);
      return ch;
    });
    return () => { channels.forEach((ch) => client.removeChannel(ch)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomIdsKey, active]);

  // Track how long each hosted room has been empty, for the 2-min reap below.
  // Driven by the MERGED counts (heartbeats + presence), not presence alone:
  // a hosted room whose presence channel silently failed is neither flagged
  // empty while people are inside (which leaned on the server's heartbeat
  // guard to refuse the reap) nor left untracked once it truly empties.
  useEffect(() => {
    for (const room of rooms) {
      if (room.is_system) continue;
      const count = occupancy.get(room.id) ?? 0;
      if (count > 0) emptySince.current.delete(room.id);
      else if (!emptySince.current.has(room.id)) emptySince.current.set(room.id, Date.now());
    }
  }, [rooms, occupancy]);

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

  const join = async (room: LiveRoom) => {
    if (!profile?.username) { onNeedUsername(); return; }
    unlockAudio(); // Keep audio permission inside the user gesture for iOS.
    setJoinError(null);
    const result = await joinRoom(room.id);
    if (!result.room) { setJoinError(result.error ?? "Couldn't join that room."); return; }
    track("room_join");
    setActive(result.room);
    notifyFriendsOfRoom(room.id, "room_joined");
  };

  const joinWithCode = async () => {
    if (!profile?.username) { onNeedUsername(); return; }
    if (!joinCode.trim()) return;
    unlockAudio();
    setJoinError(null);
    const result = await joinRoomByCode(joinCode);
    if (!result.room) { setJoinError(result.error ?? "Couldn't join that room."); return; }
    setRooms((prev) => prev.some((r) => r.id === result.room!.id) ? prev : [result.room!, ...prev]);
    setActive(result.room);
    setJoinCode("");
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
    track("room_host");
    setShowCreate(false);
    setRooms((prev) => [room, ...prev]);
    setActive(room);
    notifyFriendsOfRoom(room.id, "room_created");
  };

  if (active) {
    return (
      <RoomView room={active} session={session} profile={profile} now={now}
        isPremium={isPremium} gateThen={gateThen} soundAuto={soundAuto} completionSoundEnabled={completionSoundEnabled} onCelebrate={onCelebrate} onInRoom={onInRoom}
        pipSupported={pipSupported} pipWindow={pipWindow} onPopOut={onPopOut} onClosePip={onClosePip}
        onImportedTasks={onImportedTasks} onUpgrade={onUpgrade}
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
          <h1 className="flex items-center gap-2 font-display text-3xl font-semibold">Study rooms
            <InfoTip text="With an account, pick any room and hit Join. Every room runs one shared timer, so everyone focuses and breaks together. The always-on rooms never stop; jump in whenever. Chat and voice unlock during breaks. Premium members can host their own public or private rooms." />
          </h1>
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

      <HowRoomsWork />

      <div className="mt-4 flex flex-col gap-2 rounded-2xl border border-border bg-card/70 p-3 sm:flex-row">
        <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} maxLength={10}
          placeholder="Private room invite code" aria-label="Private room invite code"
          className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2 text-sm uppercase tracking-widest outline-none focus:border-primary" />
        <button onClick={joinWithCode} disabled={!joinCode.trim()} className="rounded-xl border border-primary/50 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary disabled:opacity-50">Join private room</button>
      </div>
      {joinError && <p className="mt-2 text-xs text-destructive">{joinError}</p>}

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
                : "No hosted rooms right now. Start one and your friends get notified."}
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
            {room.is_system ? `${room.focus_min}/${room.short_min} rhythm · always on` : `${room.topic} · ${room.visibility === "private" ? "Private" : "Public"}`}
          </p>
        </div>
        <span className="mt-1 flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] font-medium text-white" style={{ background: phaseColor(info.phase) }}>
          {PHASE_LABEL[info.phase]} · <TimeDisplay value={fmt(info.secondsLeft)} />
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
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (name.trim().length < 3) { setError("Give your room a name (3+ characters)."); return; }
    setSaving(true);
    setError(null);
    const { label, ...method } = ROOM_PRESETS[preset];
    void label;
    const room = await createRoom(hostId, { name: name.trim(), topic: topic.trim() || "Open study", cap, music, visibility, ...method });
    setSaving(false);
    if (!room) { setError("Couldn't create the room. Try again."); return; }
    onCreated(room);
  };

  return (
    <Modal label="Host a room" onClose={onClose}
      cardClassName="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-xl font-semibold"><DoorOpen size={18} className="text-primary" /> Host a room</h3>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">The timer starts the moment you create it, and your friends get notified.</p>
        <div className="mt-4 space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Room name, e.g. Pharm Power Hour" maxLength={60}
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (optional), e.g. Beta-blockers review" maxLength={80}
            className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
          <div className="grid grid-cols-2 gap-2" aria-label="Room visibility">
            {(["public", "private"] as const).map((value) => <button key={value} onClick={() => setVisibility(value)} aria-pressed={visibility === value}
              className={`rounded-xl border px-3 py-2 text-left text-sm capitalize transition ${visibility === value ? "border-primary bg-primary/5 font-medium" : "border-border"}`}>
              {value}<span className="mt-0.5 block text-[10px] normal-case text-muted-foreground">{value === "public" ? "Discoverable and open" : "Invite or code required"}</span>
            </button>)}
          </div>
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
    </Modal>
  );
}

type Member = { id: string; username: string };

function RoomView({ room, session, profile, now, isPremium, gateThen, soundAuto, completionSoundEnabled, onCelebrate, onInRoom, pipSupported, pipWindow, onPopOut, onClosePip, onImportedTasks, onUpgrade, onMusicChange, onLeave, onEnded }: {
  room: LiveRoom;
  session: Session;
  profile: Profile | null;
  now: number;
  isPremium: boolean;
  gateThen: (fn: () => void) => void;
  soundAuto: boolean;
  completionSoundEnabled: boolean;
  onCelebrate: () => void;
  onInRoom: (inRoom: boolean) => void;
  pipSupported: boolean;
  pipWindow: Window | null;
  onPopOut: () => void;
  onClosePip: () => void;
  onImportedTasks: (rows: unknown[]) => void;
  onUpgrade: () => void;
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
  // Always-on rooms cycle stations automatically — a different one each
  // focus block, the same one for every member (shared block counter, no
  // server write). Hosted rooms keep playing whatever the host picked.
  const music: FocusSoundId = room.is_system ? roomStationAt(room, now) : ((room.music || "lofi") as FocusSoundId);
  const canPickMusic = isHost && !room.is_system;
  // One voice instance for the whole room screen: the dock (normal view) and
  // the compact controls (focus overlay) are two surfaces over this hook, so
  // a live call survives entering/leaving focus mode.
  const voice = useRoomVoice(room.id, userId, username, info.phase);
  // Likewise ONE chat data instance (messages + names + the realtime topic):
  // the normal view, focus overlay, and pop-out window all render over it.
  const chat = useRoomChat(room.id);
  // Local, per-listener music mute — silences the background music just for you,
  // completely separate from the voice controls (muting a mic / people talking).
  const [musicMuted, setMusicMuted] = useState(() => loadPref("roamly-room-music-muted") === "on");
  const [showAd, setShowAd] = useState(false);

  // The room owns the audio engine while you're in it: tell App to stand down
  // its personal-timer sound sync, and hand control back on leave.
  useEffect(() => {
    onInRoom(true);
    return () => onInRoom(false);
  }, [onInRoom]);

  // A room pop-out belongs to this RoomView. Close it whenever the room view
  // unmounts, including manual leave, host end, remote deletion, or a forced
  // leave when starting a solo timer.
  useEffect(() => () => onClosePip(), [onClosePip]);

  // Room music follows the shared timer: the room's track plays during focus
  // blocks and stops for breaks (honoring the global "Play with timer" switch
  // and this listener's local mute). Deps only change at phase boundaries, when
  // the host swaps the track, or when you mute — not every tick. Stop on leave.
  useEffect(() => {
    if (soundAuto && !musicMuted && info.phase === "focus") startFocusSound(music);
    else stopFocusSound();
  }, [info.phase, soundAuto, music, musicMuted]);
  useEffect(() => () => { stopFocusSound(); }, []);

  // Dim the room music over the last ~5s of a focus block (once per block).
  const duckedRef = useRef(false);
  useEffect(() => {
    if (info.phase === "focus" && info.secondsLeft <= 4 && !duckedRef.current) {
      duckedRef.current = true;
      duckFocusSound(3);
    } else if (info.phase !== "focus" || info.secondsLeft > 4) {
      duckedRef.current = false;
    }
  }, [info.secondsLeft, info.phase]);

  // Credit a completed room focus block to Analytics + gamification. Room
  // blocks were never recorded before; group_size = the live headcount at the
  // boundary, which drives the XP multiplier (more people together = more XP).
  // Only blocks we witnessed from the start count: sawFocusStart flips true on a
  // break→focus transition, so someone who joins mid-block (e.g. with seconds
  // left) isn't credited the whole block — which would inflate their stats.
  const prevPhaseRef = useRef(info.phase);
  const sawFocusStartRef = useRef(false);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = info.phase;
    if (prev !== "focus" && info.phase === "focus") { sawFocusStartRef.current = true; return; }
    if (prev === "focus" && info.phase !== "focus") {
      const witnessed = sawFocusStartRef.current;
      sawFocusStartRef.current = false;
      if (witnessed && userId) {
        void recordFocusSession(dateKey(), room.focus_min, undefined, "room", Math.max(1, members.length))
          .then((ok) => { if (ok) void syncGamification(); });
      }
    }
  }, [info.phase, room.focus_min, members.length, userId]);

  const toggleMusicMuted = () => {
    unlockAudio(); // iOS-safe resume when unmuting mid-focus
    setMusicMuted((m) => {
      const next = !m;
      savePref("roamly-room-music-muted", next ? "on" : "off");
      return next;
    });
  };

  const chooseMusic = (id: FocusSoundId) => {
    unlockAudio();
    onMusicChange(id);        // updates local room → restarts the sync effect
    setRoomMusic(room.id, id); // persist so everyone in the room hears it
  };

  const [roomImmersive, setRoomImmersive] = useState(false); // room focus-mode takeover
  const musicName = FOCUS_SOUNDS.find((s) => s.id === music)?.name ?? "Lofi beats";

  // Join the room's presence channel: everyone in it sees everyone else live,
  // and disconnects (closed tabs included) drop out automatically.
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    // You are always in the room you're looking at: seed yourself so the list
    // never sits on "Connecting…" while presence joins (or quietly fails and
    // auto-retries) — the empty list read as a dead room.
    setMembers([{ id: userId, username }]);
    const ch = client.channel(`room:${room.id}`, { config: { private: true, presence: { key: userId } } });
    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ username: string }>();
      const list = Object.entries(state).map(([id, metas]) => ({ id, username: metas[0]?.username ?? "student" }));
      if (!list.some((m) => m.id === userId)) list.unshift({ id: userId, username });
      setMembers(list);
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") ch.track({ username });
      // The channel keeps rejoining on its own; log so a broken policy or
      // auth token is visible instead of an eternally-lonely member list.
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.warn("[Roamly] room presence subscribe failed", room.id, status);
    });
    return () => { client.removeChannel(ch); };
  }, [room.id, userId, username]);

  // Heartbeat: tells the server this room is occupied, which blocks the reap
  // functions from deleting it. Upsert on join + every 20s (the sweep treats
  // a room as empty after 60s without a beat, so this survives two dropped
  // beats); clear on leave.
  useEffect(() => {
    const beat = () => heartbeatRoom(room.id, userId);
    beat();
    const iv = window.setInterval(beat, 20_000);
    // Background tabs throttle setInterval past the 60s reap window, so also
    // beat the instant the tab is refocused — the quickest way to reassert
    // occupancy after the browser has been starving our timer.
    const onVisible = () => { if (document.visibilityState === "visible") beat(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
      clearRoomHeartbeat(room.id, userId);
    };
  }, [room.id, userId]);

  // Eject to the lobby if this room is deleted out from under us — the host
  // ends it, or the server sweep reaps it — instead of rendering a dead timer
  // and firing heartbeat/chat writes at a row that no longer exists. (System
  // rooms are never deleted, so they need no watcher.)
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;
  useEffect(() => {
    if (!supabase || room.is_system) return;
    const client = supabase;
    const ch = client
      .channel(`room-delete:${room.id}`)
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "rooms", filter: `id=eq.${room.id}` },
        () => onLeaveRef.current())
      .subscribe();
    return () => { client.removeChannel(ch); };
  }, [room.id, room.is_system]);

  // Start the appropriate completion chime three seconds before every shared
  // timer boundary. RoomView is used by both always-on and hosted rooms.
  //
  // The phase key prevents duplicate playback from re-renders or synchronized
  // room updates. A user entering a room with <=3 seconds remaining does not
  // immediately hear a stale end-of-phase chime.
  const chimePhaseKeyRef = useRef<string | null>(null);
  const previousRoomSecondsRef = useRef(info.secondsLeft);

  useEffect(() => {
    const phaseKey = `${info.phase}-${info.focusIndex}`;
    const previousSeconds = previousRoomSecondsRef.current;

    if (
      completionSoundEnabled &&
      chimePhaseKeyRef.current !== phaseKey &&
      previousSeconds > 3 &&
      info.secondsLeft <= 3 &&
      info.secondsLeft > 0
    ) {
      chimePhaseKeyRef.current = phaseKey;
      // Focus blocks use the shorter "focusEnd" chime so it rings out before
      // the boundary, leaving 00:00 clear for the completion confetti's
      // fireworks sound (same as the solo timer).
      playChime(info.phase === "focus" ? "focusEnd" : "breakEnd");
    }

    previousRoomSecondsRef.current = info.secondsLeft;

    // A new phase gets a new key and may chime when it later crosses 3 seconds.
    if (info.secondsLeft > 3 && chimePhaseKeyRef.current !== phaseKey) {
      chimePhaseKeyRef.current = null;
    }
  }, [
    info.secondsLeft,
    info.phase,
    info.focusIndex,
    completionSoundEnabled,
  ]);

  // Fire the completion celebration (full-screen confetti + fireworks sound)
  // the moment a shared focus block rolls into a break, so group and hosted
  // rooms celebrate a finished block just like a solo session. Keyed off the
  // focus -> break phase transition, so it fires once per completed block and
  // never on a break ending or when someone joins mid-break.
  const onCelebrateRef = useRef(onCelebrate);
  onCelebrateRef.current = onCelebrate;
  const prevRoomPhaseRef = useRef(info.phase);
  useEffect(() => {
    if (prevRoomPhaseRef.current === "focus" && info.phase !== "focus") {
      onCelebrateRef.current();
    }
    prevRoomPhaseRef.current = info.phase;
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
            {room.is_system ? `Always on · ${room.focus_min}/${room.short_min} rhythm · study anything` : room.topic}
          </p>
          {room.visibility === "private" && room.invite_code && <p className="mt-1 font-mono text-xs text-primary">Private invite code: {room.invite_code}</p>}
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
          <TimeDisplay value={fmt(info.secondsLeft)} className="font-display text-7xl font-medium tracking-tight" />
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

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button onClick={() => { unlockAudio(); track("room_focus_mode"); setRoomImmersive(true); }}
            className="flex items-center gap-2 rounded-full gradient-primary px-5 py-2.5 text-sm font-semibold text-white shadow-glow transition active:scale-95">
            <Maximize2 size={15} /> Focus mode
          </button>
          {pipSupported && (
            <button onClick={() => (pipWindow ? onClosePip() : onPopOut())}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
              <PictureInPicture2 size={15} /> {pipWindow ? "Close pop-out" : "Pop out timer"}
            </button>
          )}
        </div>
      </section>

      <div className="mt-4"><HealthyBreakActivities active={info.phase !== "focus"} breakKey={`room-${room.id}-${info.phase}-${info.focusIndex}`} /></div>
      {info.phase !== "focus" && !isPremium && (
        <div className="mt-4">
          <AdBreakPrompt active onAdvertise={() => setShowAd(true)} onGoPremium={onUpgrade} />
        </div>
      )}
      {showAd && <AdSubmitModal userId={userId} onClose={() => setShowAd(false)} />}

      {/* Picture-in-Picture: the shared room timer + break chat in a floating
          window. No timer controls — a room's timer is server-synced and can't
          be paused/skipped. The chat surface shares the useRoomChat instance
          above and handles its own locked-during-focus lifecycle. */}
      {pipWindow && createPortal(
        <PipTimer phaseLabel={PHASE_LABEL[info.phase]} ring={phaseColor(info.phase)}
          timeText={fmt(info.secondsLeft)} progress={1 - info.secondsLeft / info.phaseTotal}
          taskTitle={room.name}
          extra={<RoomChat compact chat={chat} room={room} userId={userId} phase={info.phase}
            secondsToBreak={info.phase === "focus" ? info.secondsLeft : 0}
            phaseStartMs={now - (info.phaseTotal - info.secondsLeft) * 1000} />} />,
        pipWindow.document.body
      )}

      <section className="mt-4 rounded-3xl border border-border bg-card/80 p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <Music size={13} className="text-primary" /> Room music
          </h2>
          <div className="flex items-center gap-2">
            {!canPickMusic && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Lock size={11} /> {musicName}{room.is_system ? " · rotates each block" : ""}
              </span>
            )}
            {/* Mutes just the music for you — the voice/mic controls below are
                separate and unaffected. */}
            <button onClick={toggleMusicMuted}
              aria-label={musicMuted ? "Unmute music" : "Mute music"}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${musicMuted ? "border-border bg-card text-muted-foreground hover:text-foreground" : "border-primary/50 bg-primary/10 text-primary"}`}>
              {musicMuted ? <VolumeX size={13} /> : <Volume2 size={13} />} {musicMuted ? "Music muted" : "Music on"}
            </button>
          </div>
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
            {room.is_system ? "Always-on rooms cycle the music stations automatically — a new one each focus block, the same for everyone." : "The host sets this room's music."}
          </p>
        )}
      </section>

      {!room.is_system && (
        <div className="mt-4">
          <UploadTasksPanel profile={profile} session={session} onImported={onImportedTasks} onUpgrade={onUpgrade} />
        </div>
      )}

      <VoiceDock voice={voice} userId={userId}
        phase={info.phase} secondsToBreak={info.phase === "focus" ? info.secondsLeft : 0}
        isPremium={isPremium} gateThen={gateThen} />

      {/* All chat surfaces share the single useRoomChat instance above, so any
          combination of them can be mounted without double-subscribing the
          realtime topic. */}
      {!roomImmersive && <RoomChat chat={chat} room={room} userId={userId} phase={info.phase} secondsToBreak={info.phase === "focus" ? info.secondsLeft : 0} phaseStartMs={now - (info.phaseTotal - info.secondsLeft) * 1000} />}

      {showInvite && <InviteModal roomId={room.id} myId={userId} onClose={() => setShowInvite(false)} />}

      <FocusMode open={roomImmersive} phase={info.phase} phaseLabel={PHASE_LABEL[info.phase]}
        timeText={fmt(info.secondsLeft)} progress={1 - info.secondsLeft / info.phaseTotal}
        title={room.name}
        subtitle={room.is_system ? `${room.focus_min}/${room.short_min} rhythm · always on` : room.topic}
        cycles={room.cycles} completed={info.focusIndex - 1}
        ring={phaseColor(info.phase)}
        onExit={() => setRoomImmersive(false)}
        controls={pipSupported ? (
          <button onClick={() => (pipWindow ? onClosePip() : onPopOut())}
            className="flex h-12 items-center gap-2 rounded-2xl border border-border bg-card px-5 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            aria-label={pipWindow ? "Close pop-out timer" : "Pop out timer"}>
            <PictureInPicture2 size={16} /> {pipWindow ? "Close pop-out" : "Pop out"}
          </button>
        ) : undefined}
        music={
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Room music</span>
              <button onClick={toggleMusicMuted} aria-label={musicMuted ? "Unmute music" : "Mute music"}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${musicMuted ? "border-border bg-card text-muted-foreground hover:text-foreground" : "border-primary/50 bg-primary/10 text-primary"}`}>
                {musicMuted ? <VolumeX size={13} /> : <Volume2 size={13} />} {musicMuted ? "Music muted" : "Music on"}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{musicName}{room.is_system ? " · rotates each block" : ""}{canPickMusic ? " · change it back in the room view" : ""}</p>
          </div>
        }
        extra={
          <div className="space-y-3">
            <HealthyBreakActivities compact active={info.phase !== "focus"} breakKey={`room-focus-${room.id}-${info.phase}-${info.focusIndex}`} />
            <VoiceControls voice={voice} phase={info.phase} isPremium={isPremium} gateThen={gateThen} />
            {info.phase !== "focus"
              ? <RoomChat chat={chat} room={room} userId={userId} phase={info.phase} secondsToBreak={0} phaseStartMs={now - (info.phaseTotal - info.secondsLeft) * 1000} />
              : <p className="flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border bg-card/50 px-4 py-3 text-center text-xs text-muted-foreground">
                  <MessageCircle size={13} /> Chat opens when the focus block reaches a break.
                </p>}
          </div>
        } />
    </div>
  );
}

// One chat instance for the whole room screen (same idea as useRoomVoice):
// the normal view, the focus overlay, and the pop-out PiP window are all just
// surfaces over this hook, so the realtime topic `room-chat:<id>` is only ever
// subscribed once no matter how many chat panels are visible at a time.
function useRoomChat(roomId: string) {
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [names, setNames] = useState<Map<string, PublicProfile>>(new Map());

  // History + live inserts. subscribe() throws if this topic is somehow
  // already subscribed — guard so a duplicate can degrade to history-only
  // instead of crashing the whole screen. Merge keyed by id (never blind-append)
  // so a message that lands in both the history snapshot and a realtime event
  // shows once, and load history only AFTER the subscription is live so an
  // insert during setup can't fall through the gap between the two.
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    const merge = (incoming: RoomMessage[]) =>
      setMessages((prev) => {
        const byId = new Map(prev.map((m) => [m.id, m]));
        for (const m of incoming) byId.set(m.id, m);
        return [...byId.values()].sort((a, b) => a.created_at.localeCompare(b.created_at));
      });
    try {
      const channel = client
        .channel(`room-chat:${roomId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_messages", filter: `room_id=eq.${roomId}` },
          (payload) => merge([payload.new as RoomMessage]))
        .subscribe((status) => { if (status === "SUBSCRIBED") fetchMessages(roomId).then(merge); });
      return () => { client.removeChannel(channel); };
    } catch (e) {
      console.warn("[Roamly] room chat subscribe failed", e);
      fetchMessages(roomId).then(merge); // degrade to history-only
    }
  }, [roomId]);

  // Resolve sender names we haven't seen yet. Track requested ids in a ref so
  // the fetch lives in the effect body (not inside a setState updater, which
  // must stay pure and runs twice under StrictMode — double-firing the RPC).
  const requestedNamesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const unknown = [...new Set(messages.map((m) => m.user_id))].filter((id) => !requestedNamesRef.current.has(id));
    if (unknown.length === 0) return;
    unknown.forEach((id) => requestedNamesRef.current.add(id));
    getPublicProfiles(unknown).then((fresh) => setNames((cur) => new Map([...cur, ...fresh])));
  }, [messages]);

  return { messages, names };
}

function RoomChat({ chat, room, userId, phase, secondsToBreak, phaseStartMs, compact }: {
  chat: ReturnType<typeof useRoomChat>;
  room: LiveRoom;
  userId: string;
  phase: "focus" | "short" | "long";
  secondsToBreak: number;
  phaseStartMs: number;
  compact?: boolean; // tighter layout for the small pop-out (PiP) window
}) {
  const { messages, names } = chat;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const chatOpen = phase !== "focus";

  // Nothing is shown during a focus block (study). What shows during a break
  // depends on the room type:
  //  • always-on (system) rooms: ephemeral — only the CURRENT break's messages
  //    (created since this phase started; 2s buffer absorbs boundary rounding),
  //    so the chat clears every time focus resumes.
  //  • user-hosted rooms: the group's history persists across breaks — it's
  //    just hidden during study and returns at the next break.
  const visible = !chatOpen
    ? []
    : room.is_system
      ? messages.filter((m) => new Date(m.created_at).getTime() >= phaseStartMs - 2000)
      : messages;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, phaseStartMs, chatOpen]);

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
    <section className={compact ? "w-full rounded-2xl border border-border bg-card/80 p-3.5 shadow-sm" : "mt-5 rounded-3xl border border-border bg-card/80 p-5 shadow-sm"}>
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><MessageCircle size={15} className="text-primary" /> Break-time chat</h2>
        {chatOpen ? (
          <span className="rounded-full bg-roamly-green/10 px-2.5 py-1 text-[11px] font-medium text-roamly-green">{compact ? "Open" : "Open, it's break time"}</span>
        ) : (
          <span className="flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
            <Lock size={11} /> Opens at break · {fmt(secondsToBreak)}
          </span>
        )}
      </div>

      <div ref={listRef} className={`mt-3 space-y-2.5 overflow-y-auto rounded-xl border border-border bg-card/60 p-3 ${compact ? "h-40" : "h-64"}`}>
        {visible.length === 0 && (
          <p className="pt-4 text-center text-xs text-muted-foreground">No messages yet. Say hi at the next break.</p>
        )}
        {visible.map((m) => {
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
          placeholder={chatOpen ? "Message the room…" : compact ? "Chat opens at the break" : `Chat opens in ${fmt(secondsToBreak)}. Keep focusing`}
          className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3 py-2.5 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60" />
        <button onClick={send} disabled={!chatOpen || !draft.trim() || sending} aria-label="Send"
          className="grid w-11 shrink-0 place-items-center rounded-xl gradient-primary text-white shadow-glow transition active:scale-95 disabled:opacity-40">
          <Send size={16} />
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-destructive">{error}</p>}
      {!compact && <p className="mt-2 text-[11px] text-muted-foreground">Chat unlocks during short and long breaks, then locks again when focus starts.</p>}
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
    <Modal label="Invite friends" onClose={onClose}
      cardClassName="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-xl font-semibold">Invite friends</h3>
          <button onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>
        {loaded && friends.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">No friends yet. Add classmates from the Friends panel first.</p>
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
    </Modal>
  );
}

// Break-time voice chat for study rooms. P2P WebRTC mesh: audio flows
// directly between participants; the room's Supabase Realtime channel is only
// used for signaling (offer/answer/ICE) and for announcing who's in voice
// (presence). No media servers and no schema changes.
//
// Break-only, like text chat: connections stay alive through the whole
// session, but every mic is hard-disabled (track.enabled = false) during
// focus phases, so there's nothing to reconnect when a break starts.

import { useEffect, useRef, useState } from "react";
import { Headphones, Mic, MicOff, PhoneOff, Lock } from "lucide-react";
import { supabase } from "./supabaseClient";
import { fmt } from "./useTimer";

// A full mesh means n·(n−1)/2 connections; past ~8 people the upstream audio
// load gets heavy for everyone, so voice caps below the room cap.
const VOICE_CAP = 8;

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

type VoiceMember = { id: string; username: string };
type Signal = { from: string; to: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

type Peer = {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  pendingIce: RTCIceCandidateInit[];
  hasRemote: boolean;
};

export function VoiceDock({ roomId, userId, username, phase, secondsToBreak, isPremium, gateThen }: {
  roomId: string;
  userId: string;
  username: string;
  phase: "focus" | "short" | "long";
  secondsToBreak: number;
  isPremium: boolean;
  gateThen: (fn: () => void) => void;
}) {
  const [joined, setJoined] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [members, setMembers] = useState<VoiceMember[]>([]);
  const [error, setError] = useState<string | null>(null);

  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>["channel"]> | null>(null);
  const peersRef = useRef<Map<string, Peer>>(new Map());
  const streamRef = useRef<MediaStream | null>(null);
  const joinedRef = useRef(false);
  const micOnRef = useRef(true);
  const phaseRef = useRef(phase);

  const micLive = micOn && phase !== "focus";

  // Keep refs in sync so channel callbacks (bound once) see current values.
  useEffect(() => { joinedRef.current = joined; }, [joined]);
  useEffect(() => { micOnRef.current = micOn; }, [micOn]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // The mic is only ever live when the user wants it on AND the room is on a
  // break. This is the entire break-gating mechanism: the track keeps
  // streaming silence while disabled, so no renegotiation is needed.
  useEffect(() => {
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = micLive; });
  }, [micLive]);

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;

    const closePeer = (peerId: string) => {
      const peer = peersRef.current.get(peerId);
      if (!peer) return;
      peersRef.current.delete(peerId);
      try { peer.pc.close(); } catch { /* already closed */ }
      peer.audio.srcObject = null;
      peer.audio.remove();
    };

    const ch = client.channel(`room-voice:${roomId}`, { config: { presence: { key: userId } } });
    channelRef.current = ch;

    const signal = (event: "voice-offer" | "voice-answer" | "voice-ice", payload: Signal) => {
      ch.send({ type: "broadcast", event, payload });
    };

    const newPeer = (peerId: string): Peer => {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "");
      document.body.appendChild(audio);
      const peer: Peer = { pc, audio, pendingIce: [], hasRemote: false };
      peersRef.current.set(peerId, peer);

      streamRef.current?.getTracks().forEach((t) => pc.addTrack(t, streamRef.current!));
      pc.onicecandidate = (e) => { if (e.candidate) signal("voice-ice", { from: userId, to: peerId, candidate: e.candidate.toJSON() }); };
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
        audio.play().catch(() => { /* will start on next user interaction */ });
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed") closePeer(peerId);
      };
      return peer;
    };

    const flushIce = (peer: Peer) => {
      peer.pendingIce.forEach((c) => peer.pc.addIceCandidate(c).catch(() => { /* stale candidate */ }));
      peer.pendingIce = [];
    };

    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState<{ username: string }>();
      const current = Object.entries(state).map(([id, metas]) => ({ id, username: metas[0]?.username ?? "student" }));
      setMembers(current);

      if (!joinedRef.current) return;
      const ids = new Set(current.map((m) => m.id));
      // Peers who left voice: tear down. (Deleting during iteration is safe
      // for Map iterators.)
      for (const peerId of peersRef.current.keys()) {
        if (!ids.has(peerId)) closePeer(peerId);
      }
      // New peers: the lexicographically smaller id makes the offer, so
      // exactly one side of every pair initiates.
      for (const m of current) {
        if (m.id === userId || peersRef.current.has(m.id) || userId >= m.id) continue;
        const peer = newPeer(m.id);
        peer.pc.createOffer()
          .then((offer) => peer.pc.setLocalDescription(offer).then(() => {
            signal("voice-offer", { from: userId, to: m.id, sdp: offer });
          }))
          .catch(() => closePeer(m.id));
      }
    });

    ch.on("broadcast", { event: "voice-offer" }, ({ payload }: { payload: Signal }) => {
      if (payload.to !== userId || !payload.sdp || !joinedRef.current) return;
      const peer = peersRef.current.get(payload.from) ?? newPeer(payload.from);
      peer.pc.setRemoteDescription(payload.sdp)
        .then(() => { peer.hasRemote = true; flushIce(peer); return peer.pc.createAnswer(); })
        .then((answer) => peer.pc.setLocalDescription(answer).then(() => {
          signal("voice-answer", { from: userId, to: payload.from, sdp: answer });
        }))
        .catch(() => closePeer(payload.from));
    });

    ch.on("broadcast", { event: "voice-answer" }, ({ payload }: { payload: Signal }) => {
      if (payload.to !== userId || !payload.sdp) return;
      const peer = peersRef.current.get(payload.from);
      if (!peer) return;
      peer.pc.setRemoteDescription(payload.sdp)
        .then(() => { peer.hasRemote = true; flushIce(peer); })
        .catch(() => closePeer(payload.from));
    });

    ch.on("broadcast", { event: "voice-ice" }, ({ payload }: { payload: Signal }) => {
      if (payload.to !== userId || !payload.candidate) return;
      const peer = peersRef.current.get(payload.from);
      if (!peer) return;
      if (peer.hasRemote) peer.pc.addIceCandidate(payload.candidate).catch(() => { /* stale candidate */ });
      else peer.pendingIce.push(payload.candidate);
    });

    ch.subscribe();

    return () => {
      for (const peerId of peersRef.current.keys()) closePeer(peerId);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      channelRef.current = null;
      client.removeChannel(ch);
      setJoined(false);
    };
    // applyMicState intentionally uses refs; channel is rebuilt only per room.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, userId]);

  const join = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      stream.getAudioTracks().forEach((t) => { t.enabled = micOnRef.current && phaseRef.current !== "focus"; });
      joinedRef.current = true;
      setJoined(true);
      // Announce ourselves; existing members' presence sync will trigger the
      // offer dance (from whichever side has the smaller id).
      channelRef.current?.track({ username });
    } catch {
      setError("Couldn't access your microphone — check the browser permission and try again.");
    }
  };

  const leave = () => {
    joinedRef.current = false;
    setJoined(false);
    channelRef.current?.untrack();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    // Presence sync handles peers on the remote side; drop ours immediately.
    for (const [peerId] of peersRef.current) {
      const peer = peersRef.current.get(peerId);
      if (peer) { try { peer.pc.close(); } catch { /* noop */ } peer.audio.srcObject = null; peer.audio.remove(); }
    }
    peersRef.current.clear();
  };

  useEffect(() => () => { if (joinedRef.current) leave(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const othersInVoice = members.filter((m) => m.id !== userId);
  const voiceFull = !joined && members.length >= VOICE_CAP;

  return (
    <section className="mt-5 rounded-3xl border border-border bg-card/80 p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Headphones size={16} className="text-primary" />
          <h2 className="font-display text-lg font-semibold">Voice</h2>
          {!isPremium && <span className="text-xs text-primary">Premium</span>}
          <span className="text-xs text-muted-foreground">
            {members.length === 0 ? "· quiet right now" : `· ${members.length} in voice`}
          </span>
        </div>

        {joined ? (
          <div className="flex shrink-0 items-center gap-2">
            <button onClick={() => setMicOn((m) => !m)} disabled={phase === "focus"}
              aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${phase === "focus" ? "cursor-not-allowed border-border text-muted-foreground opacity-60" : micLive ? "border-roamly-green/50 bg-roamly-green/10 text-roamly-green" : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>
              {micLive ? <Mic size={13} /> : <MicOff size={13} />} {micLive ? "Mic on" : "Muted"}
            </button>
            <button onClick={leave} aria-label="Leave voice"
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition hover:border-destructive/50 hover:text-destructive">
              <PhoneOff size={13} /> Leave
            </button>
          </div>
        ) : (
          <button
            onClick={() => (isPremium ? join() : gateThen(() => {}))}
            disabled={voiceFull}
            className="flex shrink-0 items-center gap-1.5 rounded-full gradient-primary px-4 py-1.5 text-xs font-semibold text-white shadow-glow transition active:scale-95 disabled:opacity-60">
            <Mic size={13} /> {voiceFull ? "Voice full" : "Join voice"}
          </button>
        )}
      </div>

      {joined && phase === "focus" && (
        <p className="mt-3 flex items-center gap-1.5 rounded-xl border border-dashed border-border bg-card/60 px-3 py-2 text-xs text-muted-foreground">
          <Lock size={12} /> Mics open at the break · {fmt(secondsToBreak)}
        </p>
      )}

      {joined && othersInVoice.length === 0 && phase !== "focus" && (
        <p className="mt-3 text-xs text-muted-foreground">You're the only one in voice — others can hop in from this panel.</p>
      )}

      {members.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {members.map((m) => (
            <span key={m.id} className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${m.id === userId ? "bg-primary/10 text-primary" : "bg-secondary text-secondary-foreground"}`}>
              <Headphones size={11} />
              {m.username}{m.id === userId && " (you)"}
            </span>
          ))}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
      <p className="mt-3 text-[11px] text-muted-foreground">
        Voice works like chat: talk during breaks, mics lock automatically while everyone focuses.
      </p>
    </section>
  );
}

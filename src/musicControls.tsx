import { useState } from "react";
import { Volume2, Play, Pause, Music, ChevronDown, ChevronUp, X } from "lucide-react";
import { FOCUS_SOUNDS, musicCredit } from "./focusSounds";
import { SPOTIFY_PRESETS, parseSpotifyUrl, toEmbedSrc as toSpotifyEmbedSrc, embedHeight, embedSrcToUri, type SpotifyEmbedType } from "./spotify";
import { SpotifyEmbed } from "./SpotifyEmbed";
import { APPLE_MUSIC_PRESETS, parseAppleMusicUrl, toEmbedSrc as toAppleEmbedSrc, embedHeight as appleEmbedHeight, type AppleMusicEmbedType } from "./appleMusic";
import { loadPref, savePref } from "./storage";
import type { EmbedTarget, SoundsController } from "./appTypes";

// Built-in ambient sounds, free for everyone. Unlike the streaming embeds,
// the app owns this audio, so it can follow the timer perfectly.
export function FocusSoundsPanel({ sounds }: { sounds: SoundsController }) {
  return (
    <div className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Volume2 size={16} className="text-primary" />
          <h2 className="font-display text-lg font-semibold">Focus sounds</h2>
        </div>
        <button onClick={sounds.toggle} disabled={!sounds.sound}
          aria-label={sounds.playing ? "Pause sound" : "Play sound"}
          aria-pressed={sounds.playing}
          className={`grid h-9 w-9 place-items-center rounded-full border transition disabled:opacity-40 ${sounds.playing ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}>
          {sounds.playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {FOCUS_SOUNDS.map((s) => {
          const active = sounds.sound === s.id;
          return (
            <button key={s.id} onClick={() => sounds.choose(s.id)} aria-pressed={active}
              className={`relative rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-primary bg-primary/10 text-primary shadow-sm" : "border-border bg-card/60 hover:border-primary/40"}`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{s.name}</span>
                {active && sounds.playing && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />}
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{s.hint}</p>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/60 px-3 py-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">Play with timer</p>
          <p className="text-[11px] leading-snug text-muted-foreground">Starts on focus, fades out for breaks.</p>
        </div>
        <button role="switch" aria-checked={sounds.auto} aria-label="Play sound with timer" onClick={() => sounds.setAuto(!sounds.auto)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${sounds.auto ? "bg-primary" : "bg-border"}`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${sounds.auto ? "left-[22px]" : "left-0.5"}`} />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3 px-1">
        <Volume2 size={14} className="shrink-0 text-muted-foreground" />
        <input type="range" min={0} max={1} step={0.05} value={sounds.volume}
          onChange={(e) => sounds.setVolume(Number(e.target.value))}
          aria-label="Sound volume"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-border accent-[hsl(var(--primary))]" />
      </div>
      {musicCredit() && <p className="mt-2 px-1 text-[10px] text-muted-foreground">{musicCredit()}</p>}
    </div>
  );
}

// Controller for the ONE persistent streaming player (the mini-dock App
// renders at the root). Selecting a preset or pasting a link hands the target
// up to App via onPlay — the iframe itself lives in the dock, so it keeps
// playing across tab switches and pop-out timers instead of dying when this
// panel unmounts.
export function MusicPanel({ embed, shown, onPlay, showPlayer = false, stopSignal, onPlaying, dockClosed = false, onReopenDock }: {
  embed: EmbedTarget | null;
  shown: EmbedTarget;
  onPlay: (target: EmbedTarget) => void;
  showPlayer?: boolean;
  stopSignal: number;
  onPlaying: () => void;
  dockClosed?: boolean;
  onReopenDock?: () => void;
}) {
  // Remember the service tab so the persistent dock preloads the right
  // default station on the next visit.
  const [service, setServiceState] = useState<"spotify" | "apple">(() => loadPref("roamly-music-service") === "apple" ? "apple" : "spotify");
  // Switching the service tab surfaces that service's player right away (loads
  // its first station), matching the dock — the player should appear when you
  // click Apple Music, not only after you pick a channel. Skips if that
  // service is already playing so it never interrupts a chosen station.
  const setService = (s: "spotify" | "apple") => {
    savePref("roamly-music-service", s);
    setServiceState(s);
    if (shown?.service === s) return;
    if (s === "apple") {
      const p = APPLE_MUSIC_PRESETS[0] as any;
      onPlay({ service: "apple", src: toAppleEmbedSrc({ type: p.type, path: p.path }), height: appleEmbedHeight(p.type), label: p.name });
    } else {
      const p = SPOTIFY_PRESETS[0] as any;
      onPlay({ service: "spotify", src: toSpotifyEmbedSrc({ type: p.type, id: p.spotifyId }), height: embedHeight(p.type), label: p.name });
    }
  };
  const [spotifyCustomUrl, setSpotifyCustomUrl] = useState("");
  const [spotifyCustomError, setSpotifyCustomError] = useState(false);
  const [appleCustomUrl, setAppleCustomUrl] = useState("");
  const [appleCustomError, setAppleCustomError] = useState(false);
  // Let the whole streaming panel collapse to just its header, to free room for
  // the timer and tasks. The body is only hidden (h-0 + inert), never
  // unmounted, so a playing embed keeps going. The choice persists per device.
  const [collapsed, setCollapsed] = useState(() => loadPref("roamly-focus-music-collapsed") === "1");
  const toggleCollapsed = () => setCollapsed((v) => { savePref("roamly-focus-music-collapsed", v ? "0" : "1"); return !v; });

  const playSpotify = (target: { type: SpotifyEmbedType; id: string }, label: string) =>
    onPlay({ service: "spotify", src: toSpotifyEmbedSrc(target), height: embedHeight(target.type), label });
  const playApple = (target: { type: AppleMusicEmbedType; path: string }, label: string) =>
    onPlay({ service: "apple", src: toAppleEmbedSrc(target), height: appleEmbedHeight(target.type), label });

  const applySpotifyUrl = (value: string) => {
    setSpotifyCustomUrl(value);
    if (!value.trim()) { setSpotifyCustomError(false); return; }
    const parsed = parseSpotifyUrl(value);
    if (parsed) { setSpotifyCustomError(false); playSpotify(parsed, "Your Spotify pick"); }
    else setSpotifyCustomError(true);
  };

  const applyAppleUrl = (value: string) => {
    setAppleCustomUrl(value);
    if (!value.trim()) { setAppleCustomError(false); return; }
    const parsed = parseAppleMusicUrl(value);
    if (parsed) { setAppleCustomError(false); playApple(parsed, "Your Apple Music pick"); }
    else setAppleCustomError(true);
  };

  return (
    <div className="relative rounded-2xl border border-border bg-card/80 p-4 shadow-sm">
      <div className={`flex items-center justify-between ${collapsed ? "" : "mb-3"}`}>
        <div className="flex items-center gap-2">
          <Music size={16} className="text-primary" />
          <h2 className="font-display text-lg font-semibold">Music</h2>
        </div>
        <div className="flex items-center gap-1.5">
          {dockClosed && onReopenDock && (
            <button onClick={onReopenDock}
              className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary transition hover:bg-primary/15">
              Show mini-player
            </button>
          )}
          <button onClick={toggleCollapsed} aria-expanded={!collapsed} aria-controls="focus-music-body"
            aria-label={collapsed ? "Expand Music" : "Collapse Music"}
            className="grid h-8 w-8 place-items-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary/40 hover:text-foreground">
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {/* Hidden (not unmounted) when collapsed, so a playing embed keeps going. */}
      <div id="focus-music-body" className={collapsed ? "h-0 overflow-hidden" : ""} inert={collapsed} aria-hidden={collapsed}>
        {showPlayer && shown && <StreamingPlayer shown={shown} stopSignal={stopSignal} onPlaying={onPlaying} />}
        <div className="mb-3 flex gap-1.5 rounded-xl border border-border bg-card/60 p-1">
          <button onClick={() => setService("spotify")}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${service === "spotify" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            Spotify
          </button>
          <button onClick={() => setService("apple")}
            className={`flex-1 rounded-lg py-1.5 text-xs font-medium transition ${service === "apple" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            Apple Music
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(service === "spotify" ? SPOTIFY_PRESETS : APPLE_MUSIC_PRESETS).map((p: any) => {
            const src = service === "spotify"
              ? toSpotifyEmbedSrc({ type: p.type, id: p.spotifyId })
              : toAppleEmbedSrc({ type: p.type, path: p.path });
            const active = embed?.src === src;
            return (
              <button key={p.id}
                onClick={() => (service === "spotify" ? playSpotify({ type: p.type, id: p.spotifyId }, p.name) : playApple({ type: p.type, path: p.path }, p.name))}
                className={`relative rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-primary bg-primary/5 shadow-sm" : "border-border bg-card/60 hover:border-primary/40"}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{p.name}</span>
                  {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />}
                </div>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{p.hint}</p>
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          <label htmlFor={`${service}-url`} className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Or paste a {service === "spotify" ? "Spotify" : "Apple Music"} link
          </label>
          <input id={`${service}-url`} type="text"
            value={service === "spotify" ? spotifyCustomUrl : appleCustomUrl}
            onChange={(e) => (service === "spotify" ? applySpotifyUrl(e.target.value) : applyAppleUrl(e.target.value))}
            placeholder={service === "spotify" ? "https://open.spotify.com/playlist/..." : "https://music.apple.com/us/playlist/..."}
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20" />
          {(service === "spotify" ? spotifyCustomError : appleCustomError) && (
            <p className="mt-1.5 text-[11px] text-destructive">
              Couldn't read that link. Paste a track, playlist, album, or artist URL.
            </p>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Playlists load into the mini-player at the bottom of your screen. It keeps
          playing while you switch tabs. Minimize it there whenever it's in the way.
        </p>
      </div>
    </div>
  );
}

// The ONE streaming player. Mounted once at App root and never unmounted or
// reparented — an iframe reloads (and stops the music) if it moves in the
// DOM, so tab switches and minimizing only ever toggle CSS on this container.
// Preloaded with a default station so both services are visibly available
// without clicking anything (autoplay can't start without a user gesture).
// The actual player. Spotify goes through the iFrame API (SpotifyEmbed) so the
// app can pause it and detect its play button; Apple Music has no such API, so
// it stays a plain iframe that stopSignal remounts (a reload is the only way
// to silence an uncontrolled embed).
export function EmbedPlayer({ shown, height, stopSignal, onPlaying, plain = false }: {
  shown: EmbedTarget;
  height: number;
  stopSignal?: number;
  onPlaying?: () => void;
  plain?: boolean;
}) {
  // `plain` skips the API player: the PiP window is a separate document the
  // main-window iFrame API script can't manage.
  const spotifyUri = !plain && shown.service === "spotify" ? embedSrcToUri(shown.src) : null;
  if (spotifyUri) {
    return <SpotifyEmbed key={shown.src} uri={spotifyUri} fallbackSrc={shown.src} height={height}
      pauseSignal={stopSignal ?? 0} onPlay={onPlaying ?? (() => {})} />;
  }
  return (
    <iframe key={`${stopSignal ?? 0}-${shown.src}`} src={shown.src} width="100%" height={height}
      style={{ border: "none" }} title="Music player"
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" />
  );
}

export function StreamingPlayer({ shown, compact = false, stopSignal, onPlaying, plain = false }: {
  shown: EmbedTarget;
  compact?: boolean;
  stopSignal?: number;
  onPlaying?: () => void;
  plain?: boolean;
}) {
  return (
    <div className={`mb-3 overflow-hidden rounded-xl border border-border bg-card/70 ${compact ? "" : "shadow-sm"}`}>
      <p className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">
        <Music size={12} className="text-primary" />
        <span className="truncate">{shown.service === "spotify" ? "Spotify" : "Apple Music"} · {shown.label}</span>
      </p>
      <EmbedPlayer shown={shown} height={compact ? 96 : Math.min(shown.height, 152)} stopSignal={stopSignal} onPlaying={onPlaying} plain={plain} />
    </div>
  );
}

export function MusicDock({ shown, minimized, onToggleMin, onPickService, onClose, hidden = false, stopSignal, onPlaying }: {
  shown: EmbedTarget;
  minimized: boolean;
  onToggleMin: () => void;
  onPickService: (svc: "spotify" | "apple") => void;
  onClose: () => void;
  hidden?: boolean;
  stopSignal: number;
  onPlaying: () => void;
}) {
  return (
    // z-[45]: above the bottom nav (z-40), below every modal (z-50+) — a
    // permanent fixture must never eat taps meant for an open dialog.
    // `inert` while hidden: opacity/pointer-events only hide it visually —
    // without it the controls stay tabbable and announced to screen readers.
    <div data-testid="music-dock" inert={hidden} aria-hidden={hidden}
      className={`fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] z-[45] overflow-hidden rounded-2xl border border-border bg-card shadow-xl transition ${hidden ? "pointer-events-none opacity-0" : "opacity-100"} sm:left-auto sm:right-4 sm:w-96`}>
      <div className="flex items-center">
        <button onClick={onToggleMin} className="flex min-w-0 flex-1 items-center justify-between px-3 py-1.5 text-left"
          aria-label={minimized ? "Expand music player" : "Minimize music player"} aria-expanded={!minimized}>
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <Music size={12} className="shrink-0 text-primary" />
            <span className="truncate">{shown.service === "spotify" ? "Spotify" : "Apple Music"} · {shown.label}</span>
          </span>
          {minimized ? <ChevronUp size={14} className="shrink-0 text-muted-foreground" /> : <ChevronDown size={14} className="shrink-0 text-muted-foreground" />}
        </button>
        <button onClick={onClose} aria-label="Close music player"
          className="mr-1.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive">
          <X size={13} />
        </button>
      </div>
      {/* Collapsed via height, NOT unmounted — the music keeps playing.
          `inert` keeps the collapsed controls out of the tab order too. */}
      <div className={minimized ? "h-0 overflow-hidden" : ""} inert={minimized} aria-hidden={minimized}>
        {/* Switch services without leaving the dock — loads that service's
            default station (the panel's presets still work as before). */}
        <div className="mx-2 mb-1.5 flex gap-1 rounded-lg border border-border bg-card/60 p-0.5">
          {(["spotify", "apple"] as const).map((s) => (
            <button key={s} onClick={() => onPickService?.(s)} aria-pressed={shown.service === s}
              className={`flex-1 rounded-md py-1 text-[11px] font-medium transition ${shown.service === s ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
              {s === "spotify" ? "Spotify" : "Apple Music"}
            </button>
          ))}
        </div>
        <EmbedPlayer shown={shown} height={Math.min(shown.height, 152)} stopSignal={stopSignal} onPlaying={onPlaying} />
      </div>
    </div>
  );
}

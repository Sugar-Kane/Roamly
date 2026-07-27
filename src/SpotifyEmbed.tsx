// Spotify player rendered through the official Embed iFrame API instead of a
// bare <iframe>, which gives us the two things a plain embed can't do:
//   * know when the user presses play INSIDE the player (playback_update), so
//     the app can pause its own focus sounds, and
//   * pause the player programmatically when a focus sound starts.
// Apple Music has no equivalent public API, so its embed stays a plain iframe
// that the app stops by remounting; this component is Spotify-only.
//
// The API script is loaded once, lazily, on first mount. If the script can't
// load (offline, blocked), the component falls back to a plain iframe so music
// still works; only the coordination is lost.

import { useEffect, useRef, useState } from "react";

export type SpotifyController = {
  destroy: () => void;
  play: () => void;
  pause: () => void;
  resume: () => void;
  togglePlay: () => void;
  addListener: (event: string, cb: (e: { data?: { isPaused?: boolean; isBuffering?: boolean } }) => void) => void;
};
type SpotifyIFrameApi = {
  createController: (
    el: HTMLElement,
    options: { uri: string; width?: string | number; height?: string | number },
    cb: (controller: SpotifyController) => void,
  ) => void;
};

declare global {
  interface Window { onSpotifyIframeApiReady?: (api: SpotifyIFrameApi) => void }
}

let apiPromise: Promise<SpotifyIFrameApi | null> | null = null;
function loadIFrameApi(): Promise<SpotifyIFrameApi | null> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    window.onSpotifyIframeApiReady = (api) => resolve(api);
    const script = document.createElement("script");
    script.src = "https://open.spotify.com/embed/iframe-api/v1";
    script.async = true;
    script.onerror = () => resolve(null); // fall back to a plain iframe
    document.body.appendChild(script);
  });
  return apiPromise;
}

export function SpotifyEmbed({ uri, fallbackSrc, height, pauseSignal, onPlay, onController, onPausedChange, autoplay = false, playSignal = 0 }: {
  uri: string;
  fallbackSrc: string; // plain embed URL used if the API script can't load
  height: number;
  // Start playing as soon as the player is ready, instead of loading paused.
  // Set only when the user actively picked this station (never for the dock's
  // preloaded default), so nothing starts making noise on its own. This covers
  // a FRESH mount; `playSignal` covers the rest.
  autoplay?: boolean;
  // Bumped once per explicit pick. A boolean alone can't express "play this
  // again": picking the station that is already mounted (the dock preloads a
  // default, and that default is also a preset) leaves `uri` unchanged, so the
  // component never remounts and the mount-time autoplay never runs. Picking a
  // station you just paused has the same shape. A counter fires every time.
  playSignal?: number;
  // Bumped by App whenever a focus sound starts; the player pauses in response.
  pauseSignal: number;
  // Fired when playback actually starts inside the player.
  onPlay: () => void;
  // Handed the live controller (and null on teardown) so surfaces outside this
  // component — notably the pop-out timer window, which cannot host a second
  // player — can drive playback remotely.
  onController?: (c: SpotifyController | null) => void;
  // Play/pause state, so those remote surfaces can render the right icon.
  onPausedChange?: (paused: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SpotifyController | null>(null);
  const [failed, setFailed] = useState(false);
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;
  const onControllerRef = useRef(onController);
  onControllerRef.current = onController;
  const onPausedRef = useRef(onPausedChange);
  onPausedRef.current = onPausedChange;
  // Read through a ref so toggling autoplay never re-runs the mount effect —
  // that would tear down and rebuild a happily playing controller.
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;
  // play() before the embed reports `ready` is silently dropped, so a request
  // that lands early is parked here and replayed by the ready handler.
  const readyRef = useRef(false);
  const wantPlayRef = useRef(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let controller: SpotifyController | null = null;
    // createController replaces the element it's given, so hand it a scratch
    // child instead of our own container.
    const mount = document.createElement("div");
    host.appendChild(mount);
    void loadIFrameApi().then((api) => {
      if (!api) { if (!cancelled) setFailed(true); return; }
      if (cancelled) return;
      api.createController(mount, { uri, width: "100%", height }, (c) => {
        if (cancelled) { try { c.destroy(); } catch { /* already gone */ } return; }
        controller = c;
        controllerRef.current = c;
        onControllerRef.current?.(c);
        // `ready` fires once the embed can accept commands — calling play() in
        // this callback instead is too early and is silently dropped. Always
        // registered (not just when autoplay is set at mount) so a pick that
        // arrives while the embed is still loading is not lost.
        c.addListener("ready", () => {
          readyRef.current = true;
          if (!autoplayRef.current && !wantPlayRef.current) return;
          wantPlayRef.current = false;
          try { c.play(); } catch { /* autoplay refused — the player still shows */ }
        });
        let wasPaused = true;
        c.addListener("playback_update", (e) => {
          const paused = e.data?.isPaused !== false;
          if (wasPaused && !paused) onPlayRef.current();
          if (paused !== wasPaused) onPausedRef.current?.(paused);
          wasPaused = paused;
        });
      });
    });
    return () => {
      cancelled = true;
      readyRef.current = false;
      controllerRef.current = null;
      onControllerRef.current?.(null);
      onPausedRef.current?.(true);
      try { controller?.destroy(); } catch { /* already destroyed */ }
      if (host.contains(mount)) mount.remove();
    };
  }, [uri, height]);

  // An explicit pick lands here. Note this deliberately does NOT use a
  // "skip the first run" ref: this component's effects run TWICE on mount
  // (StrictMode), so such a guard is spent by the duplicate run and the next
  // real signal sails through — which autoplayed the preloaded station on page
  // load. Comparing against the value seen when THIS instance mounted is immune
  // to that: a remount re-baselines to the current value, so only a genuine
  // change after mount plays. A pick that does remount the player (a different
  // station) is handled by the autoplay path in the `ready` listener instead.
  const baselineSignal = useRef(playSignal);
  useEffect(() => {
    if (playSignal === baselineSignal.current) return;
    baselineSignal.current = playSignal;
    if (!readyRef.current || !controllerRef.current) { wantPlayRef.current = true; return; }
    try { controllerRef.current.play(); } catch { /* not ready after all */ }
  }, [playSignal]);

  // Pause when the app's own audio starts. Skip the mount-time value so a
  // fresh player isn't immediately paused.
  const firstSignal = useRef(true);
  useEffect(() => {
    if (firstSignal.current) { firstSignal.current = false; return; }
    try { controllerRef.current?.pause(); } catch { /* not ready yet */ }
  }, [pauseSignal]);

  if (failed) {
    return (
      <iframe src={fallbackSrc} width="100%" height={height} frameBorder="0" title="Music player"
        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" />
    );
  }
  return <div ref={hostRef} style={{ minHeight: height }} />;
}

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

type SpotifyController = {
  destroy: () => void;
  pause: () => void;
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

export function SpotifyEmbed({ uri, fallbackSrc, height, pauseSignal, onPlay }: {
  uri: string;
  fallbackSrc: string; // plain embed URL used if the API script can't load
  height: number;
  // Bumped by App whenever a focus sound starts; the player pauses in response.
  pauseSignal: number;
  // Fired when playback actually starts inside the player.
  onPlay: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<SpotifyController | null>(null);
  const [failed, setFailed] = useState(false);
  const onPlayRef = useRef(onPlay);
  onPlayRef.current = onPlay;

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
        let wasPaused = true;
        c.addListener("playback_update", (e) => {
          const paused = e.data?.isPaused !== false;
          if (wasPaused && !paused) onPlayRef.current();
          wasPaused = paused;
        });
      });
    });
    return () => {
      cancelled = true;
      controllerRef.current = null;
      try { controller?.destroy(); } catch { /* already destroyed */ }
      if (host.contains(mount)) mount.remove();
    };
  }, [uri, height]);

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

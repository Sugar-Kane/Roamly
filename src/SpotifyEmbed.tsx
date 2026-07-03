// Spotify embed backed by Spotify's official IFrame API instead of a plain
// <iframe>, so the page can drive playback (play on focus start, pause on
// breaks). Apple Music has no equivalent — its embed player exposes no
// programmatic controls to the host page — which is why timer sync is a
// Spotify-only feature.

import { useEffect, useRef, useState } from "react";

type EmbedController = {
  loadUri: (uri: string) => void;
  play: () => void;
  togglePlay: () => void;
  pause?: () => void;
  resume?: () => void;
  destroy: () => void;
  addListener: (event: string, cb: (e: unknown) => void) => void;
};

type IFrameAPI = {
  createController: (
    el: HTMLElement,
    options: { uri: string; width?: string | number; height?: string | number },
    cb: (controller: EmbedController) => void
  ) => void;
};

// The API script announces itself through a global callback and can only be
// loaded once per page, so the promise is cached at module level.
let apiPromise: Promise<IFrameAPI> | null = null;
function loadIframeApi(): Promise<IFrameAPI> {
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      (window as any).onSpotifyIframeApiReady = (api: IFrameAPI) => resolve(api);
      const script = document.createElement("script");
      script.src = "https://open.spotify.com/embed/iframe-api/v1";
      script.async = true;
      document.body.appendChild(script);
    });
  }
  return apiPromise;
}

// playing:
//   true  → should be playing (start it if the user hasn't yet)
//   false → should be paused
//   null  → hands off; the user controls the player directly
export function SpotifyEmbed({ uri, height, playing }: { uri: string; height: number; playing: boolean | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<EmbedController | null>(null);
  const isPausedRef = useRef(true);
  const startedRef = useRef(false);
  const [ready, setReady] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let controller: EmbedController | null = null;
    const host = hostRef.current;
    if (!host) return;
    // createController replaces the element it's given, so hand it a
    // throwaway child instead of our own container.
    const mount = document.createElement("div");
    host.appendChild(mount);
    isPausedRef.current = true;
    startedRef.current = false;

    loadIframeApi().then((api) => {
      if (cancelled) return;
      api.createController(mount, { uri, width: "100%", height }, (c) => {
        if (cancelled) { c.destroy(); return; }
        controller = c;
        controllerRef.current = c;
        c.addListener("playback_update", (e: any) => {
          const paused = !!e?.data?.isPaused;
          isPausedRef.current = paused;
          if (!paused) startedRef.current = true;
        });
        setReady((n) => n + 1);
      });
    });

    return () => {
      cancelled = true;
      controllerRef.current = null;
      try { controller?.destroy(); } catch { /* iframe already gone */ }
      host.replaceChildren();
    };
  }, [uri, height]);

  // Reconcile actual playback with the desired state. Deliberately only runs
  // when the desired state (or controller) changes — if the user manually
  // pauses mid-focus, we respect that until the next phase transition.
  useEffect(() => {
    if (playing === null) return;
    const c = controllerRef.current;
    if (!c) return;
    if (playing) {
      if (!startedRef.current) c.play();
      else if (isPausedRef.current) { if (c.resume) c.resume(); else c.togglePlay(); }
    } else if (startedRef.current && !isPausedRef.current) {
      if (c.pause) c.pause(); else c.togglePlay();
    }
  }, [playing, ready]);

  return <div ref={hostRef} style={{ minHeight: height }} />;
}

import { useCallback, useEffect, useRef, useState } from "react";

// Fallback pop-out for browsers WITHOUT Document Picture-in-Picture (most
// importantly Safari, and any non-Chromium engine that still ships the standard
// video PiP API). A PiP window can only hold a <video>, not arbitrary DOM, so
// we render the countdown onto a canvas, stream that canvas into a muted,
// playing <video>, and PiP the video. This is DISPLAY-ONLY — the floating
// window shows the time/phase/progress; the Pause/Skip controls stay on the
// main tab. Chromium keeps the richer, interactive Document PiP path instead
// (see useDocumentPip), so this is gated off there.

export type PipFrame = {
  timeText: string;
  phaseLabel: string;
  progress: number;
  ring: string; // hex accent (theme.ring / theme.rest)
  bg: string; // resolved CSS color
  fg: string; // resolved CSS color
  muted: string; // resolved CSS color
};

type WebkitVideo = HTMLVideoElement & {
  webkitSetPresentationMode?: (mode: "picture-in-picture" | "inline") => void;
  webkitSupportsPresentationMode?: (mode: string) => boolean;
};

function detectSupport(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  // Chromium exposes the richer Document PiP — let that path own the feature.
  if ("documentPictureInPicture" in window) return false;
  const video = document.createElement("video") as WebkitVideo;
  return (
    (document as unknown as { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled === true ||
    typeof video.webkitSetPresentationMode === "function"
  );
}

export const VIDEO_PIP_SUPPORTED = detectSupport();

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// getFrame is read through a ref so the caller can pass a fresh closure each
// render (the live timer values) without re-subscribing anything.
export function useVideoPip(getFrame: () => PipFrame) {
  const [active, setActive] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<WebkitVideo | null>(null);
  const timerRef = useRef<number | null>(null);
  const getFrameRef = useRef(getFrame);
  getFrameRef.current = getFrame;

  const stopLoop = useCallback(() => {
    if (timerRef.current != null) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { timeText, phaseLabel, progress, ring, bg, fg, muted } = getFrameRef.current();
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = "center";

    ctx.fillStyle = muted;
    ctx.font = `600 ${Math.round(H * 0.12)}px system-ui, -apple-system, sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText(phaseLabel.toUpperCase(), W / 2, H * 0.2);

    ctx.fillStyle = fg;
    ctx.font = `600 ${Math.round(H * 0.4)}px system-ui, -apple-system, sans-serif`;
    ctx.fillText(timeText, W / 2, H * 0.5);

    const pad = W * 0.09, barW = W - pad * 2, barH = Math.max(6, H * 0.04), barY = H * 0.82;
    ctx.fillStyle = muted; ctx.globalAlpha = 0.3;
    roundRect(ctx, pad, barY, barW, barH, barH / 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ring;
    roundRect(ctx, pad, barY, barW * Math.max(0, Math.min(1, progress)), barH, barH / 2); ctx.fill();
  }, []);

  const close = useCallback(() => {
    stopLoop();
    try {
      if ((document as unknown as { pictureInPictureElement?: Element }).pictureInPictureElement) {
        void (document as unknown as { exitPictureInPicture?: () => Promise<void> }).exitPictureInPicture?.();
      } else {
        videoRef.current?.webkitSetPresentationMode?.("inline");
      }
    } catch { /* leavepictureinpicture will still clear state */ }
    setActive(false);
  }, [stopLoop]);

  const open = useCallback(async (): Promise<boolean> => {
    if (!VIDEO_PIP_SUPPORTED) return false;

    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.width = 320; canvas.height = 180;
      canvasRef.current = canvas;
    }
    let video = videoRef.current;
    if (!video) {
      video = document.createElement("video") as WebkitVideo;
      video.muted = true;
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      // Kept in the DOM but visually gone; Safari won't PiP a detached element.
      video.style.cssText = "position:fixed;width:1px;height:1px;left:-9999px;top:0;opacity:0;pointer-events:none";
      document.body.appendChild(video);
      video.addEventListener("enterpictureinpicture", () => setActive(true));
      video.addEventListener("leavepictureinpicture", () => { setActive(false); stopLoop(); });
      videoRef.current = video;
    }

    draw();
    if (!video.srcObject) {
      try { video.srcObject = canvas.captureStream(2); }
      catch { return false; } // captureStream unsupported → bail cleanly
    }
    // Redraw on an interval (background tabs throttle this to ~1/s, which is
    // exactly the granularity a seconds clock needs) so the streamed frames
    // stay current while the window floats over other apps.
    stopLoop();
    timerRef.current = window.setInterval(draw, 500);

    try {
      await video.play();
      if (typeof video.requestPictureInPicture === "function") {
        await video.requestPictureInPicture();
      } else if (typeof video.webkitSetPresentationMode === "function") {
        video.webkitSetPresentationMode("picture-in-picture");
        setActive(true);
      } else {
        stopLoop();
        return false;
      }
      return true;
    } catch {
      stopLoop();
      return false;
    }
  }, [draw, stopLoop]);

  useEffect(() => () => {
    stopLoop();
    try { videoRef.current?.remove(); } catch { /* already gone */ }
  }, [stopLoop]);

  return { supported: VIDEO_PIP_SUPPORTED, active, open, close };
}

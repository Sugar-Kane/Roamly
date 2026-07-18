import { useCallback, useEffect, useRef, useState } from "react";

// Fallback pop-out for browsers WITHOUT Document Picture-in-Picture (most
// importantly Safari, and any non-Chromium engine that still ships the standard
// video PiP API). A PiP window can only hold a <video>, not arbitrary DOM, so
// we render the countdown onto a canvas, stream that canvas into a muted,
// playing <video>, and PiP the video. This is DISPLAY-ONLY — the floating
// window shows the time/phase/progress; the Pause/Skip controls stay on the
// main tab. Chromium keeps the richer, interactive Document PiP path instead
// (see useDocumentPip), so this is gated off there.
//
// Safari is strict: requestPictureInPicture() must run inside the user gesture
// AND the <video> must already be playing with a real frame (non-zero intrinsic
// size). So we PRIME the canvas → captureStream → muted <video> up front (muted
// autoplay needs no gesture) and keep it warm; the click then only has to call
// requestPictureInPicture() with no intervening awaits.

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
type CaptureCanvas = HTMLCanvasElement & { captureStream?: (fps?: number) => MediaStream };

function detectSupport(): boolean {
  if (typeof document === "undefined" || typeof window === "undefined") return false;
  // Chromium exposes the richer Document PiP — let that path own the feature.
  if ("documentPictureInPicture" in window) return false;
  const canvas = document.createElement("canvas") as CaptureCanvas;
  if (typeof canvas.captureStream !== "function") return false; // no way to feed the <video>
  const video = document.createElement("video") as WebkitVideo;
  return (
    (document as unknown as { pictureInPictureEnabled?: boolean }).pictureInPictureEnabled === true ||
    typeof video.webkitSetPresentationMode === "function"
  );
}

export const VIDEO_PIP_SUPPORTED = detectSupport();

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
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
  const canvasRef = useRef<CaptureCanvas | null>(null);
  const videoRef = useRef<WebkitVideo | null>(null);
  const loopRef = useRef<number | null>(null);
  const getFrameRef = useRef(getFrame);
  getFrameRef.current = getFrame;

  const stopLoop = useCallback(() => {
    if (loopRef.current != null) { clearInterval(loopRef.current); loopRef.current = null; }
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

  // Prime the hidden canvas → stream → <video> once, up front, and keep it warm
  // so the pop-out click has a ready, playing video to hand to PiP.
  useEffect(() => {
    if (!VIDEO_PIP_SUPPORTED) return;
    const canvas = document.createElement("canvas") as CaptureCanvas;
    canvas.width = 320; canvas.height = 180;
    canvasRef.current = canvas;
    draw();

    const video = document.createElement("video") as WebkitVideo;
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    // Kept in the DOM (Safari won't PiP a detached element) but visually gone.
    video.style.cssText = "position:fixed;width:1px;height:1px;left:-9999px;top:0;opacity:0;pointer-events:none";
    try { video.srcObject = canvas.captureStream!(1); } catch { /* gated by detectSupport, but be safe */ }
    document.body.appendChild(video);
    video.addEventListener("enterpictureinpicture", () => { setActive(true); stopLoop(); loopRef.current = window.setInterval(draw, 500); });
    video.addEventListener("leavepictureinpicture", () => { setActive(false); stopLoop(); });
    // Muted autoplay needs no gesture; keeps a live frame flowing for PiP.
    video.play().catch(() => { /* a later gesture'd open() retries play */ });
    videoRef.current = video;

    return () => {
      stopLoop();
      try { video.pause(); } catch { /* noop */ }
      try { video.remove(); } catch { /* noop */ }
      videoRef.current = null;
      canvasRef.current = null;
    };
  }, [draw, stopLoop]);

  const close = useCallback(() => {
    stopLoop();
    const doc = document as unknown as { pictureInPictureElement?: Element; exitPictureInPicture?: () => Promise<void> };
    try {
      if (doc.pictureInPictureElement) void doc.exitPictureInPicture?.();
      else videoRef.current?.webkitSetPresentationMode?.("inline");
    } catch { /* leavepictureinpicture will still clear state */ }
    setActive(false);
  }, [stopLoop]);

  // Must stay a gesture-friendly call: draw a fresh frame, make sure the primed
  // video is playing, then request PiP with no awaits before it on Safari.
  const open = useCallback(async (): Promise<boolean> => {
    const video = videoRef.current;
    if (!VIDEO_PIP_SUPPORTED || !video) return false;
    draw();
    // If muted autoplay was blocked at prime time, this gesture'd play unblocks
    // it. We do NOT await before requestPictureInPicture (Safari spends the
    // gesture on the first await) — play() for a muted stream resolves inline.
    void video.play().catch(() => { /* noop */ });
    try {
      if (typeof video.requestPictureInPicture === "function") {
        await video.requestPictureInPicture();
      } else if (typeof video.webkitSetPresentationMode === "function") {
        video.webkitSetPresentationMode("picture-in-picture");
        setActive(true);
      } else {
        return false;
      }
      return true;
    } catch (err) {
      console.warn("[Roamly] video pop-out failed", err);
      return false;
    }
  }, [draw]);

  return { supported: VIDEO_PIP_SUPPORTED, active, open, close };
}

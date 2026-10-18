import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { FPS } from "./timeline";
import { DISPLAY, MONO, UI } from "./fonts";

export const C = {
  bg0: "#EFE4D6", bg1: "#F7F0E6", ink: "#3E2C21", brown: "#8A5F44", muted: "#7A6253",
  amber: "#E8A33D", amberSoft: "#F2C078", tile: "#16181D", sage: "#7FA393", card: "#FBF7F1",
};

const ease = Easing.bezier(0.45, 0, 0.2, 1);
export const t2f = (sec: number) => sec * FPS;

/** 0→1 progress between two times (seconds), eased. */
export function prog(frame: number, from: number, to: number, easing = ease) {
  return interpolate(frame, [t2f(from), t2f(to)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing });
}

/** Opacity for an element shown between `from` and `to` (seconds) with fades. */
export function window01(frame: number, from: number, to: number, fadeIn = 0.25, fadeOut = 0.25) {
  const a = fadeIn > 0 ? prog(frame, from, from + fadeIn) : frame >= t2f(from) ? 1 : 0;
  const b = fadeOut > 0 ? 1 - prog(frame, to - fadeOut, to) : frame < t2f(to) ? 1 : 0;
  return Math.min(a, b);
}

export const Backdrop = () => {
  const f = useCurrentFrame();
  const drift = Math.sin(f / 90) * 40;
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${C.bg1} 0%, ${C.bg0} 85%)` }}>
      <div style={{ position: "absolute", width: 1100, height: 1100, borderRadius: "50%", left: -300 + drift, top: -500,
        background: "radial-gradient(circle, rgba(232,163,61,0.22) 0%, rgba(232,163,61,0) 65%)" }} />
      <div style={{ position: "absolute", width: 1000, height: 1000, borderRadius: "50%", right: -350 - drift, bottom: -520,
        background: "radial-gradient(circle, rgba(127,163,147,0.25) 0%, rgba(127,163,147,0) 65%)" }} />
    </AbsoluteFill>
  );
};

export type Cam = { t: number; x: number; y: number; z: number };
/** Interpolates a camera path (CSS px of the 1440×900 screenshot, z = zoom). */
export function camAt(frame: number, keys: Cam[]): Cam {
  const sec = frame / FPS;
  if (sec <= keys[0].t) return keys[0];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (sec <= b.t) {
      const p = ease((sec - a.t) / (b.t - a.t));
      return { t: sec, x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, z: a.z + (b.z - a.z) * p };
    }
  }
  return keys[keys.length - 1];
}

/** A 1440×900 viewport onto an app screenshot (2880×1800 @2x), with a camera. */
export const Screen = ({ src, cam, opacity = 1, video, style }: { src?: string; cam: Cam; opacity?: number; video?: ReactNode; style?: CSSProperties }) => {
  const W = 1440, H = 900, z = cam.z;
  const tx = Math.min(0, Math.max(W - W * z, W / 2 - cam.x * z));
  const ty = Math.min(0, Math.max(H - H * z, H / 2 - cam.y * z));
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity, ...style }}>
      <div style={{ position: "absolute", width: W, height: H, transformOrigin: "0 0", transform: `translate(${tx}px, ${ty}px) scale(${z})` }}>
        {src ? <Img src={staticFile(src)} style={{ width: W, height: H, display: "block" }} /> : video}
      </div>
    </div>
  );
};

/** Browser window: 1440×900 content + 44px chrome, at (240, 112). */
export const WIN = { x: 240, y: 112, w: 1440, h: 900, chrome: 44 };
export const BrowserWindow = ({ children, style }: { children: ReactNode; style?: CSSProperties }) => (
  <div style={{ position: "absolute", left: WIN.x, top: WIN.y, width: WIN.w, height: WIN.h + WIN.chrome, borderRadius: 18, overflow: "hidden",
    background: C.card, boxShadow: "0 40px 90px rgba(62,44,33,0.28), 0 8px 24px rgba(62,44,33,0.14), 0 0 0 1px rgba(62,44,33,0.08)", ...style }}>
    <div style={{ height: WIN.chrome, display: "flex", alignItems: "center", gap: 8, padding: "0 18px", background: "#F3EADF", borderBottom: "1px solid rgba(62,44,33,0.1)" }}>
      {["#E7836F", "#E9B65A", "#8CB77E"].map((c) => <span key={c} style={{ width: 13, height: 13, borderRadius: 7, background: c }} />)}
      <div style={{ marginLeft: 22, flex: "0 0 420px", height: 26, borderRadius: 13, background: "#FBF7F1", border: "1px solid rgba(62,44,33,0.1)",
        display: "flex", alignItems: "center", gap: 8, padding: "0 14px", fontFamily: UI, fontSize: 14, color: C.muted }}>
        <svg width="11" height="13" viewBox="0 0 11 13"><rect x="1" y="5.5" width="9" height="7" rx="1.5" fill={C.muted} /><path d="M3 5.5V4a2.5 2.5 0 015 0v1.5" stroke={C.muted} strokeWidth="1.4" fill="none" /></svg>
        roamlyflow.com
      </div>
    </div>
    <div style={{ position: "absolute", left: 0, top: WIN.chrome, width: WIN.w, height: WIN.h, overflow: "hidden", background: C.bg0 }}>{children}</div>
  </div>
);

/** Headline in the strip above the window, synced to the VO. */
export const Headline = ({ from, to, kicker, children }: { from: number; to: number; kicker: string; children: ReactNode }) => {
  const f = useCurrentFrame();
  const o = window01(f, from, to, 0.3, 0.25);
  const y = (1 - prog(f, from, from + 0.45)) * 18;
  if (o <= 0) return null;
  return (
    <div style={{ position: "absolute", left: WIN.x + 4, top: 26, opacity: o, transform: `translateY(${y}px)`, display: "flex", alignItems: "baseline", gap: 22 }}>
      <span style={{ fontFamily: MONO, fontSize: 17, letterSpacing: "0.22em", textTransform: "uppercase", color: C.brown,
        padding: "6px 12px", borderRadius: 999, border: `1.5px solid rgba(138,95,68,0.35)`, background: "rgba(251,247,241,0.7)" }}>{kicker}</span>
      <span style={{ fontFamily: DISPLAY, fontSize: 50, fontWeight: 600, color: C.ink, letterSpacing: "-0.01em" }}>{children}</span>
    </div>
  );
};

/** A floating label that pops onto the screen near a feature. Coordinates are video px. */
export const Callout = ({ from, to, x, y, children, tone = "dark" }: { from: number; to: number; x: number; y: number; children: ReactNode; tone?: "dark" | "amber" }) => {
  const f = useCurrentFrame();
  const o = window01(f, from, to, 0.2, 0.2);
  const pop = interpolate(prog(f, from, from + 0.35, Easing.out(Easing.back(2.2))), [0, 1], [0.7, 1]);
  if (o <= 0) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, opacity: o, transform: `scale(${pop})`, transformOrigin: "0 50%",
      padding: "14px 22px", borderRadius: 16, fontFamily: UI, fontSize: 28, fontWeight: 650, whiteSpace: "nowrap",
      background: tone === "amber" ? C.amber : C.tile, color: tone === "amber" ? C.tile : "#F7F0E6",
      boxShadow: "0 18px 40px rgba(22,24,29,0.28)" }}>{children}</div>
  );
};

/** Mouse pointer moving between points (video px) with click ripples at the given times. */
export const Cursor = ({ path, clicks = [], from, to }: { path: { t: number; x: number; y: number }[]; clicks?: number[]; from: number; to: number }) => {
  const f = useCurrentFrame();
  const o = window01(f, from, to, 0.2, 0.2);
  if (o <= 0) return null;
  const p = camAt(f, path.map((k) => ({ ...k, z: 1 })));
  const pressed = clicks.some((c) => f >= t2f(c) && f < t2f(c) + 5);
  return (
    <>
      {clicks.map((c) => {
        const r = prog(f, c, c + 0.45, Easing.out(Easing.quad));
        if (r <= 0 || r >= 1) return null;
        return <div key={c} style={{ position: "absolute", left: p.x - 40 * r, top: p.y - 40 * r, width: 80 * r, height: 80 * r, borderRadius: "50%",
          border: `3px solid ${C.amber}`, opacity: 1 - r }} />;
      })}
      <svg width="34" height="40" viewBox="0 0 34 40" style={{ position: "absolute", left: p.x - 4, top: p.y - 3, opacity: o, transform: `scale(${pressed ? 0.88 : 1})`, transformOrigin: "4px 3px",
        filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.3))" }}>
        <path d="M4 3 L4 33 L12 25 L18 37 L23 35 L17 23 L28 23 Z" fill="#16181D" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
    </>
  );
};

export const LogoMark = ({ size, draw = 1 }: { size: number; draw?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32">
    <rect width="32" height="32" rx="7" fill={C.tile} />
    <circle cx="16" cy="16" r="9" fill="none" stroke={C.amber} strokeWidth="2.5" strokeLinecap="round"
      strokeDasharray={`${42 * draw} ${56.55 - 42 * draw}`} transform="rotate(-90 16 16)" />
    <circle cx="16" cy="16" r={2.5 * Math.min(1, draw * 1.4)} fill={C.amberSoft} />
  </svg>
);

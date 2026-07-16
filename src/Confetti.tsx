// Confetti for a naturally completed focus block. Dependency-free canvas:
// a full-viewport rain plus two corner cannons, ~2.2s, then the canvas
// unmounts itself. The overlay is portaled to a document body so no ancestor's
// transform or overflow can clip it, never captures pointer events, sits above
// the focus-mode overlay (z-120) and modals (z-130/150), and is skipped
// entirely when the user prefers reduced motion or turns confetti off.
//
// `win` lets the same burst render into a DIFFERENT window: the pop-out
// (Picture-in-Picture) timer is a separate document, so App mounts a second
// ConfettiBurst pointed at it. Everything (size, palette, rAF, portal target)
// is read from `win` so it fills whichever window it is drawn in.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Particle = {
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number; w: number; h: number; color: string; wobble: number;
};

const DURATION_MS = 2200;
// Canvas fillStyle can't resolve CSS variables, so the theme's primary hue is
// read from the target document's root at burst time and joined with a fixed
// pastel set.
const BASE_COLORS = ["#7fb069", "#e6b655", "#c86b5c", "#7c9bb8", "#b58ecc"];
function paletteWithTheme(doc: Document): string[] {
  const primary = getComputedStyle(doc.documentElement).getPropertyValue("--primary").trim();
  return primary ? [`hsl(${primary})`, ...BASE_COLORS] : BASE_COLORS;
}

export function ConfettiBurst({ burst, reduceMotion, enabled = true, win }: {
  burst: number;
  reduceMotion: boolean;
  enabled?: boolean;
  win?: Window | null;
}) {
  const [activeBurst, setActiveBurst] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetWindow = win ?? (typeof window !== "undefined" ? window : null);

  // Each increment of `burst` (one per completed focus block) plays one round —
  // unless the user has confetti off or prefers reduced motion (either the
  // app's own accessibility toggle or the OS-level media preference).
  useEffect(() => {
    const osReduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (burst > 0 && enabled && !reduceMotion && !osReduced) setActiveBurst(burst);
  }, [burst, enabled, reduceMotion]);

  useEffect(() => {
    if (activeBurst === 0) return;
    const canvas = canvasRef.current;
    const view = targetWindow;
    if (!canvas || !view) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(2, view.devicePixelRatio || 1);
    const w = view.innerWidth;
    const h = view.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    const colors = paletteWithTheme(view.document);
    const pick = () => colors[Math.floor(rand(0, colors.length))];
    const particles: Particle[] = [];

    // Full-width rain from just above the top edge so the confetti fills the
    // whole viewport (full width and height), not only the lower corners.
    // Density scales with viewport width and is capped so very wide screens
    // stay light on the animation loop.
    const rainCount = Math.min(150, Math.max(60, Math.round(w / 12)));
    for (let i = 0; i < rainCount; i++) {
      particles.push({
        x: rand(0, w), y: rand(-40, -4),
        vx: rand(-70, 70), vy: rand(60, 240),
        rot: rand(0, Math.PI * 2), vr: rand(-8, 8),
        w: rand(5, 9), h: rand(8, 14),
        color: pick(), wobble: rand(0, Math.PI * 2),
      });
    }

    // Two cannons at the lower corners aimed up and inward, so the celebratory
    // upward burst meets the falling rain across the middle of the screen.
    for (const [ox, dir] of [[0.08, 1], [0.92, -1]] as const) {
      for (let i = 0; i < 55; i++) {
        const speed = rand(520, 980);
        const angle = (-78 + dir * rand(8, 34)) * (Math.PI / 180);
        particles.push({
          x: w * ox, y: h * 0.82,
          vx: Math.cos(angle) * speed * dir, vy: Math.sin(angle) * speed,
          rot: rand(0, Math.PI * 2), vr: rand(-8, 8),
          w: rand(5, 9), h: rand(8, 14),
          color: pick(), wobble: rand(0, Math.PI * 2),
        });
      }
    }

    let raf = 0;
    let last = 0;
    const startedAt = view.performance.now();
    const frame = (t: number) => {
      const dt = Math.min(0.04, last ? (t - last) / 1000 : 0.016);
      last = t;
      const elapsed = t - startedAt;
      ctx.clearRect(0, 0, w, h);
      const fade = elapsed > DURATION_MS - 500 ? Math.max(0, (DURATION_MS - elapsed) / 500) : 1;
      for (const p of particles) {
        p.vy += 1350 * dt; // gravity
        p.vx *= 1 - 0.9 * dt; // drag
        p.wobble += dt * 8;
        p.x += (p.vx + Math.sin(p.wobble) * 28) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, Math.abs(Math.sin(p.wobble)) * p.h * 0.6 + p.h * 0.4);
        ctx.restore();
      }
      if (elapsed < DURATION_MS) raf = view.requestAnimationFrame(frame);
      else setActiveBurst(0); // unmounts the canvas; nothing to clean by hand
    };
    raf = view.requestAnimationFrame(frame);
    return () => view.cancelAnimationFrame(raf);
  }, [activeBurst, targetWindow]);

  if (activeBurst === 0 || !targetWindow) return null;
  // Portaled to the target document's body so a transformed/overflow ancestor
  // can never clip the fixed full-viewport canvas. Immersive focus mode
  // fullscreens the whole document element, so a body-level fixed canvas still
  // renders over it; the pop-out uses its own document body.
  return createPortal(
    <canvas ref={canvasRef} data-testid="confetti" aria-hidden="true"
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 200 }} />,
    targetWindow.document.body
  );
}

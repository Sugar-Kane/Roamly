// Canvas + requestAnimationFrame companion stage.
//
// Renders the user's active pets roaming around a little floor with their
// active plant/tree growing at one end. Pets pick random idle behaviors
// (wander, pause, sit) and — when asleep — walk to a bed and nap until the
// timer is up. Art is emoji glyphs drawn onto the canvas: cross-platform,
// zero-asset, and animated purely by moving/scaling the glyphs each frame.
//
// Motion is a first-class accessibility concern here: when reduceMotion is set
// (the a11y toggle, prefers-reduced-motion, or the parent hiding it) we draw a
// single static frame and never start the rAF loop. The loop is also paused
// while the tab is hidden. Lazy-loaded by App like the charts bundle.

import { useEffect, useRef } from "react";
import { PET_ART, type PetSpecies } from "./petCatalog";

export type StagePet = { id: string; species: string };
export type StagePlant = { emoji: string; stage: number } | null;

type Actor = {
  id0: string; // the owning pet id, so actors track active-pet toggles
  emoji: string;
  x: number;
  vx: number;
  facing: 1 | -1;
  mode: "idle" | "walk" | "sit" | "sleep";
  until: number; // seconds remaining in the current behavior
  hop: number; // running phase for the walk bob
  bedX: number;
};

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

function petEmoji(species: string): string {
  return PET_ART[species as PetSpecies]?.emoji ?? "🐾";
}

// A tiny seeded PRNG so behavior varies per pet without Math.random (which is
// fine here, but keeping it deterministic-per-index avoids surprises in tests).
function rand(state: { s: number }): number {
  state.s = (state.s * 1664525 + 1013904223) >>> 0;
  return state.s / 0xffffffff;
}

export function PetStage({ pets, plant, asleep, reduceMotion, className }: {
  pets: StagePet[];
  plant: StagePlant;
  asleep: boolean;
  reduceMotion: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Latest props for the animation loop without re-arming it every render.
  const stateRef = useRef({ pets, plant, asleep, reduceMotion });
  stateRef.current = { pets, plant, asleep, reduceMotion };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0, height = 0;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    const actors: Actor[] = [];
    const rng = { s: 20260714 };

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Keep the actor list in sync with the active pets (add/remove as toggled).
    function syncActors() {
      const want = stateRef.current.pets;
      // Drop actors whose pet is no longer active.
      for (let i = actors.length - 1; i >= 0; i--) {
        if (!want.some((p) => p.id === actors[i]!.id0)) actors.splice(i, 1);
      }
      want.forEach((p, i) => {
        if (actors.some((a) => a.id0 === p.id)) return;
        const pad = 24;
        actors.push({
          id0: p.id,
          emoji: petEmoji(p.species),
          x: pad + rand(rng) * Math.max(1, width - pad * 2),
          vx: 0,
          facing: rand(rng) > 0.5 ? 1 : -1,
          mode: "idle",
          until: 0.5 + rand(rng) * 1.5,
          hop: rand(rng) * Math.PI * 2,
          bedX: 30 + i * 34,
        });
      });
    }

    const petSize = () => Math.max(26, Math.min(46, height * 0.52));

    function drawPlant() {
      const pl = stateRef.current.plant;
      if (!pl) return;
      const size = 16 + pl.stage * 6;
      ctx!.font = `${size}px ${EMOJI_FONT}`;
      ctx!.textAlign = "center";
      ctx!.textBaseline = "alphabetic";
      ctx!.globalAlpha = 0.95;
      ctx!.fillText(pl.emoji, width - 22, height - 6);
      ctx!.globalAlpha = 1;
    }

    function drawActor(a: Actor, moving: boolean) {
      const size = petSize();
      const floor = height - 6;
      const bob = moving ? Math.abs(Math.sin(a.hop)) * 4 : 0;
      ctx!.save();
      ctx!.translate(a.x, floor - bob);
      if (a.facing === -1) ctx!.scale(-1, 1);
      ctx!.font = `${size}px ${EMOJI_FONT}`;
      ctx!.textAlign = "center";
      ctx!.textBaseline = "alphabetic";
      ctx!.fillText(a.emoji, 0, 0);
      ctx!.restore();
      if (a.mode === "sleep") {
        ctx!.font = `${Math.round(size * 0.4)}px ${EMOJI_FONT}`;
        ctx!.textAlign = "center";
        ctx!.fillText("💤", a.x + size * 0.4, floor - size * 0.7);
      }
    }

    function step(a: Actor, dt: number, sleeping: boolean) {
      const pad = 20;
      if (sleeping) {
        const dx = a.bedX - a.x;
        if (Math.abs(dx) > 2) { a.facing = dx < 0 ? -1 : 1; a.x += Math.sign(dx) * Math.min(Math.abs(dx), 70 * dt); a.mode = "walk"; a.hop += dt * 9; }
        else { a.mode = "sleep"; a.vx = 0; }
        return;
      }
      a.until -= dt;
      if (a.until <= 0) {
        const roll = rand(rng);
        if (roll < 0.45) { a.mode = "walk"; a.vx = (18 + rand(rng) * 26) * (rand(rng) > 0.5 ? 1 : -1); a.facing = a.vx < 0 ? -1 : 1; a.until = 1 + rand(rng) * 2.5; }
        else if (roll < 0.8) { a.mode = "idle"; a.vx = 0; a.until = 0.8 + rand(rng) * 2; }
        else { a.mode = "sit"; a.vx = 0; a.until = 1 + rand(rng) * 2.5; }
      }
      if (a.mode === "walk") {
        a.x += a.vx * dt;
        a.hop += dt * 9;
        if (a.x < pad) { a.x = pad; a.vx = Math.abs(a.vx); a.facing = 1; }
        if (a.x > width - pad) { a.x = width - pad; a.vx = -Math.abs(a.vx); a.facing = -1; }
      }
    }

    function render(moving: boolean) {
      ctx!.clearRect(0, 0, width, height);
      drawPlant();
      for (const a of actors) drawActor(a, moving && a.mode === "walk");
    }

    resize();
    syncActors();

    // Static path: one frame, no loop. Park pets evenly along the floor.
    if (stateRef.current.reduceMotion) {
      const pad = 24;
      actors.forEach((a, i) => { a.x = pad + (i + 0.5) * ((width - pad * 2) / Math.max(1, actors.length)); a.mode = stateRef.current.asleep ? "sleep" : "idle"; });
      render(false);
      const ro = new ResizeObserver(() => { resize(); actors.forEach((a, i) => { a.x = pad + (i + 0.5) * ((width - pad * 2) / Math.max(1, actors.length)); }); render(false); });
      ro.observe(canvas);
      return () => ro.disconnect();
    }

    let raf = 0;
    let last = 0;
    let acc = 0;
    let running = true;
    const FRAME = 1 / 30; // cap the sim/draw at ~30fps — plenty smooth, easy on the battery
    const loop = (t: number) => {
      if (!running) return;
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
      last = t;
      acc += dt;
      if (acc >= FRAME) {
        syncActors();
        const sleeping = stateRef.current.asleep;
        for (const a of actors) step(a, acc, sleeping);
        render(true);
        acc = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onVisible = () => {
      if (document.visibilityState === "hidden") { running = false; cancelAnimationFrame(raf); }
      else if (!running) { running = true; last = 0; raf = requestAnimationFrame(loop); }
    };
    document.addEventListener("visibilitychange", onVisible);
    const ro = new ResizeObserver(() => resize());
    ro.observe(canvas);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisible);
      ro.disconnect();
    };
    // Re-arm only when switching between animated and static rendering; all
    // other prop changes are read live from stateRef inside the loop.
  }, [reduceMotion]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}

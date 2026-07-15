// Canvas + requestAnimationFrame companion stage.
//
// Renders the user's active pets roaming around a little floor with their
// active plant/tree growing at one end. Pets pick random idle behaviors
// (wander, pause, sit, snack) and — when asleep — walk to a bed and nap until
// the timer is up.
//
// Equipped accessories (one per slot, from stageProps) are functional:
//  * bed — each pet gets a little bed; sleeping pets nap ON it instead of the
//    floor (without one they just curl up where they stand).
//  * toy — a ball sits on the floor; walking pets kick it and it rolls,
//    decelerates, and bounces off the stage edges.
//  * bowl — pets occasionally wander over to the snack bowl and pause to eat.
//  * hat / face — drawn on every pet (head or eye-line), emoji and Rive alike.
//
// Art comes from two sources, per species:
//  * A Rive state-machine animation (skeletal idle/walk/sleep) when the
//    species has an entry in RIVE_PETS. Each Rive artboard renders into its
//    own small offscreen canvas (the Rive runtime drives it) and the stage
//    loop composites that canvas at the actor's position/facing each frame.
//  * Emoji glyphs otherwise — cross-platform, zero-asset, animated purely by
//    moving/scaling the glyph. Also the automatic fallback while a .riv file
//    loads or if it fails.
//
// Motion is a first-class accessibility concern here: when reduceMotion is set
// (the a11y toggle, prefers-reduced-motion, or the parent hiding it) we draw a
// single static emoji frame and never start the rAF loop or the Rive runtime.
// The loop is also paused while the tab is hidden. Lazy-loaded by App like the
// charts bundle; the Rive runtime is dynamic-imported only when a manifest
// species is actually on stage, so emoji-only users never download it.

import { useEffect, useRef } from "react";
import { PET_ART, type AccessorySlot, type PetSpecies } from "./petCatalog";
import { RIVE_PETS } from "./petRive";

export type StagePet = { id: string; species: string };
export type StagePlant = { emoji: string; stage: number } | null;
export type StageAccessory = { slot: AccessorySlot; emoji: string };

type RiveHandle = {
  canvas: HTMLCanvasElement;
  ready: boolean;
  failed: boolean;
  cleanup: () => void;
  setWalking: (on: boolean) => void;
  setSleeping: (on: boolean) => void;
};

type Actor = {
  id0: string; // the owning pet id, so actors track active-pet toggles
  emoji: string;
  riv: RiveHandle | null; // null = emoji rendering
  x: number;
  vx: number;
  facing: 1 | -1;
  mode: "idle" | "walk" | "sit" | "sleep" | "eat";
  until: number; // seconds remaining in the current behavior
  hop: number; // running phase for the walk bob
  bedX: number;
};

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const RIVE_SURFACE = 128; // offscreen render size (px) per Rive pet

function petEmoji(species: string): string {
  return PET_ART[species as PetSpecies]?.emoji ?? "🐾";
}

// Boot a Rive artboard into an offscreen canvas. Returns a handle immediately;
// `ready` flips once loaded, `failed` on any error (the actor keeps drawing
// its emoji in both cases until `ready`).
function createRiveHandle(species: PetSpecies): RiveHandle | null {
  const def = RIVE_PETS[species];
  if (!def) return null;
  const canvas = document.createElement("canvas");
  canvas.width = RIVE_SURFACE;
  canvas.height = RIVE_SURFACE;
  const handle: RiveHandle = {
    canvas,
    ready: false,
    failed: false,
    cleanup: () => {},
    setWalking: () => {},
    setSleeping: () => {},
  };
  import("@rive-app/canvas-lite")
    .then(({ Rive }) => {
      if (handle.failed) return; // cleaned up before the runtime arrived
      const rive = new Rive({
        src: def.src,
        canvas,
        autoplay: true,
        stateMachines: def.stateMachine,
        onLoad: () => {
          rive.resizeDrawingSurfaceToCanvas();
          const inputs = rive.stateMachineInputs(def.stateMachine) ?? [];
          const byName = (n?: string) => (n ? inputs.find((i) => i.name === n) : undefined);
          const walk = byName(def.inputs.walk);
          const sleep = byName(def.inputs.sleep);
          handle.setWalking = (on) => { if (walk) walk.value = on; };
          handle.setSleeping = (on) => { if (sleep) sleep.value = on; };
          handle.ready = true;
        },
        onLoadError: () => { handle.failed = true; },
      });
      handle.cleanup = () => { handle.failed = true; handle.ready = false; rive.cleanup(); };
    })
    .catch(() => { handle.failed = true; });
  return handle;
}

// A tiny seeded PRNG so behavior varies per pet without Math.random (which is
// fine here, but keeping it deterministic-per-index avoids surprises in tests).
function rand(state: { s: number }): number {
  state.s = (state.s * 1664525 + 1013904223) >>> 0;
  return state.s / 0xffffffff;
}

export function PetStage({ pets, plant, accessories = [], asleep, reduceMotion, className }: {
  pets: StagePet[];
  plant: StagePlant;
  accessories?: StageAccessory[];
  asleep: boolean;
  reduceMotion: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Latest props for the animation loop without re-arming it every render.
  const stateRef = useRef({ pets, plant, accessories, asleep, reduceMotion });
  stateRef.current = { pets, plant, accessories, asleep, reduceMotion };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0, height = 0;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    const actors: Actor[] = [];
    const rng = { s: 20260714 };
    // Toy-ball state; placed on first frame the toy is equipped.
    const ball = { x: 0, vx: 0, placed: false };

    const slotEmoji = (slot: AccessorySlot): string | null =>
      stateRef.current.accessories.find((a) => a.slot === slot)?.emoji ?? null;
    // The snack bowl sits left of the plant so the two never overlap.
    const bowlX = () => width - 52;

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
        if (!want.some((p) => p.id === actors[i]!.id0)) {
          actors[i]!.riv?.cleanup();
          actors.splice(i, 1);
        }
      }
      want.forEach((p, i) => {
        if (actors.some((a) => a.id0 === p.id)) return;
        const pad = 24;
        actors.push({
          id0: p.id,
          emoji: petEmoji(p.species),
          // Rive only animates; the static reduce-motion frame stays emoji.
          riv: stateRef.current.reduceMotion ? null : createRiveHandle(p.species as PetSpecies),
          x: pad + rand(rng) * Math.max(1, width - pad * 2),
          vx: 0,
          facing: rand(rng) > 0.5 ? 1 : -1,
          mode: "idle",
          until: 0.5 + rand(rng) * 1.5,
          hop: rand(rng) * Math.PI * 2,
          bedX: 30 + i * 40,
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

    // Furniture layer: beds (one per pet), snack bowl, and the toy ball —
    // drawn before the actors so pets always render on top of their gear.
    function drawFurniture() {
      const floor = height - 6;
      const size = petSize();
      ctx!.textAlign = "center";
      ctx!.textBaseline = "alphabetic";
      const bed = slotEmoji("bed");
      if (bed) {
        ctx!.font = `${Math.round(size * 0.95)}px ${EMOJI_FONT}`;
        ctx!.globalAlpha = 0.9;
        for (const a of actors) ctx!.fillText(bed, a.bedX, floor);
        ctx!.globalAlpha = 1;
      }
      const bowl = slotEmoji("bowl");
      if (bowl) {
        ctx!.font = `${Math.round(size * 0.5)}px ${EMOJI_FONT}`;
        ctx!.fillText(bowl, bowlX(), floor);
      }
      const toy = slotEmoji("toy");
      if (toy) {
        if (!ball.placed) { ball.x = width * 0.4; ball.vx = 0; ball.placed = true; }
        ctx!.font = `${Math.round(size * 0.4)}px ${EMOJI_FONT}`;
        ctx!.fillText(toy, ball.x, floor);
      } else {
        ball.placed = false;
      }
    }

    function drawActor(a: Actor, moving: boolean) {
      const size = petSize();
      const floor = height - 6;
      const useRive = !!a.riv && a.riv.ready && !a.riv.failed;
      // Rive files animate their own gait — only emoji pets get the fake bob.
      const bob = !useRive && moving ? Math.abs(Math.sin(a.hop)) * 4 : 0;
      // Napping on a real bed lifts the pet slightly onto the mattress.
      const bedLift = a.mode === "sleep" && slotEmoji("bed") ? petSize() * 0.14 : 0;
      ctx!.save();
      ctx!.translate(a.x, floor - bob - bedLift);
      if (a.facing === -1) ctx!.scale(-1, 1);
      if (useRive) {
        a.riv!.setWalking(a.mode === "walk");
        a.riv!.setSleeping(a.mode === "sleep");
        ctx!.drawImage(a.riv!.canvas, -size / 2, -size, size, size);
      } else {
        ctx!.font = `${size}px ${EMOJI_FONT}`;
        ctx!.textAlign = "center";
        ctx!.textBaseline = "alphabetic";
        ctx!.fillText(a.emoji, 0, 0);
      }
      // Worn accessories ride the same transform, so they flip and bob with
      // the pet — a hat sits on the head, shades sit on the eye line.
      const hat = slotEmoji("hat");
      if (hat) {
        ctx!.font = `${Math.round(size * 0.48)}px ${EMOJI_FONT}`;
        ctx!.textAlign = "center";
        ctx!.fillText(hat, 0, -size * 0.82);
      }
      const face = slotEmoji("face");
      if (face) {
        ctx!.font = `${Math.round(size * 0.4)}px ${EMOJI_FONT}`;
        ctx!.textAlign = "center";
        ctx!.fillText(face, 0, -size * 0.42);
      }
      ctx!.restore();
      if (a.mode === "sleep") {
        ctx!.font = `${Math.round(size * 0.4)}px ${EMOJI_FONT}`;
        ctx!.textAlign = "center";
        ctx!.fillText("💤", a.x + size * 0.4, floor - size * 0.7);
      }
      if (a.mode === "eat" && Math.abs(a.x - bowlX()) < 24) {
        ctx!.font = `${Math.round(size * 0.32)}px ${EMOJI_FONT}`;
        ctx!.textAlign = "center";
        ctx!.fillText("♪", a.x + size * 0.35, floor - size * 0.8);
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
        const hasBowl = !!slotEmoji("bowl");
        if (roll < 0.45) { a.mode = "walk"; a.vx = (18 + rand(rng) * 26) * (rand(rng) > 0.5 ? 1 : -1); a.facing = a.vx < 0 ? -1 : 1; a.until = 1 + rand(rng) * 2.5; }
        else if (roll < 0.75) { a.mode = "idle"; a.vx = 0; a.until = 0.8 + rand(rng) * 2; }
        else if (roll < 0.9 || !hasBowl) { a.mode = "sit"; a.vx = 0; a.until = 1 + rand(rng) * 2.5; }
        else { a.mode = "eat"; a.until = 3 + rand(rng) * 2; } // amble to the bowl, snack until the timer rolls over
      }
      if (a.mode === "walk") {
        a.x += a.vx * dt;
        a.hop += dt * 9;
        if (a.x < pad) { a.x = pad; a.vx = Math.abs(a.vx); a.facing = 1; }
        if (a.x > width - pad) { a.x = width - pad; a.vx = -Math.abs(a.vx); a.facing = -1; }
      }
      if (a.mode === "eat") {
        const dx = bowlX() - 16 - a.x; // stand just left of the bowl
        if (Math.abs(dx) > 3) { a.facing = dx < 0 ? -1 : 1; a.x += Math.sign(dx) * Math.min(Math.abs(dx), 60 * dt); a.hop += dt * 9; }
      }
      // Walking pets kick the ball when they run into it.
      if (ball.placed && a.mode === "walk" && Math.abs(a.x - ball.x) < petSize() * 0.35) {
        ball.vx = (ball.x >= a.x ? 1 : -1) * (50 + Math.abs(a.vx));
      }
    }

    function stepBall(dt: number) {
      if (!ball.placed || ball.vx === 0) return;
      const pad = 16;
      ball.x += ball.vx * dt;
      ball.vx *= Math.max(0, 1 - 1.8 * dt); // friction
      if (Math.abs(ball.vx) < 4) ball.vx = 0;
      if (ball.x < pad) { ball.x = pad; ball.vx = Math.abs(ball.vx) * 0.7; }
      if (ball.x > width - pad) { ball.x = width - pad; ball.vx = -Math.abs(ball.vx) * 0.7; }
    }

    function render(moving: boolean) {
      ctx!.clearRect(0, 0, width, height);
      drawPlant();
      drawFurniture();
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
        stepBall(acc);
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
      for (const a of actors) a.riv?.cleanup();
    };
    // Re-arm only when switching between animated and static rendering; all
    // other prop changes are read live from stateRef inside the loop.
  }, [reduceMotion]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}

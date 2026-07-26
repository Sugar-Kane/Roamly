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
//    decelerates, and bounces off the stage edges. It's also grabbable: drag
//    it with a pointer and let go to throw it (release velocity carries into
//    an arc), and every awake pet drops what it's doing to chase it down.
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
import { BALL_PLAYERS, PET_ART, PET_GLYPH_FACING, STAGE_THEMES, type AccessorySlot, type PetSpecies } from "./petCatalog";
import { RIVE_PETS } from "./petRive";

export type StagePet = { id: string; species: string };
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
  mode: "idle" | "walk" | "sit" | "sleep" | "eat" | "chase" | "carry";
  until: number; // seconds remaining in the current behavior
  hop: number; // running phase for the walk bob
  bedX: number;
  playful: boolean; // species chases/kicks the toy ball
  glyphFacing: -1 | 0 | 1; // native direction of the emoji (0 = head-on)
};

const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const RIVE_SURFACE = 128; // offscreen render size (px) per Rive pet
const GRAVITY = 900; // px/s² for the thrown ball's arc
const BOUNCE = 0.55; // floor/ceiling restitution
const CHASE_SPEED = 105; // px/s — a notch quicker than an idle amble
const CARRY_SPEED = 80; // px/s — a proud trot home with the ball
const REST_VX = 8; // px/s below which a rolling ball is considered stopped
const REST_VY = 55; // px/s impact below which it stops bouncing and settles
const CHASE_INTEREST = 6; // seconds pets stay interested after a throw
const MAX_THROW = 700; // px/s cap on release velocity

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

export function PetStage({ pets, accessories = [], theme = null, asleep, reduceMotion, className }: {
  pets: StagePet[];
  accessories?: StageAccessory[];
  theme?: string | null; // active theme reward id — the pen's wallpaper
  asleep: boolean;
  reduceMotion: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Latest props for the animation loop without re-arming it every render.
  const stateRef = useRef({ pets, accessories, theme, asleep, reduceMotion });
  stateRef.current = { pets, accessories, theme, asleep, reduceMotion };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0, height = 0;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    const actors: Actor[] = [];
    const rng = { s: 20260714 };
    // Toy-ball state; placed on first frame the toy is equipped. `y` is height
    // above the floor (0 = resting), so a thrown ball arcs and bounces.
    // `interest` counts down the window where playful pets chase it.
    // `carrier` is the actor id that has the ball in its mouth. Whoever gets
    // there first claims it; everyone else stands down and the winner trots it
    // home to its bed before dropping it.
    const ball = { x: 0, y: 0, vx: 0, vy: 0, placed: false, held: false, interest: 0, carrier: null as string | null };

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
          // Don't let the ball vanish with a pet that was toggled off mid-fetch.
          if (ball.carrier === actors[i]!.id0) { ball.carrier = null; ball.y = 0; }
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
          playful: BALL_PLAYERS.has(p.species as PetSpecies),
          glyphFacing: PET_GLYPH_FACING[p.species as PetSpecies] ?? 0,
        });
      });
    }

    const petSize = () => Math.max(26, Math.min(46, height * 0.52));

    // Theme wallpaper: a backdrop wash plus the floor band the pets stand on.
    // No active theme = transparent, so the card's own background shows through
    // exactly as it did before themes did anything.
    function drawBackdrop() {
      const th = stateRef.current.theme ? STAGE_THEMES[stateRef.current.theme] : undefined;
      if (!th) return;
      const floor = height - 6;
      const sky = ctx!.createLinearGradient(0, 0, 0, floor);
      sky.addColorStop(0, th.skyTop);
      sky.addColorStop(1, th.skyBottom);
      ctx!.fillStyle = sky;
      ctx!.fillRect(0, 0, width, floor);
      if (th.specks) {
        // Deterministic star field — same seed every frame so it doesn't crawl.
        const stars = { s: 99991 };
        ctx!.fillStyle = th.specks;
        for (let i = 0; i < 26; i++) {
          const sx = rand(stars) * width;
          const sy = rand(stars) * floor * 0.7;
          ctx!.globalAlpha = 0.35 + rand(stars) * 0.5;
          ctx!.fillRect(sx, sy, 1.5, 1.5);
        }
        ctx!.globalAlpha = 1;
      }
      ctx!.fillStyle = th.floor;
      ctx!.fillRect(0, floor, width, height - floor);
      ctx!.fillStyle = th.floorEdge;
      ctx!.fillRect(0, floor, width, 1.5);
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
    }

    // The ball draws on its own layer: behind the pets normally, in FRONT of
    // them while one is carrying it (otherwise it vanishes into the mouth).
    function drawBall() {
      const toy = slotEmoji("toy");
      if (!toy) {
        ball.placed = false;
        ball.held = false;
        ball.interest = 0;
        ball.carrier = null;
        canvas!.style.touchAction = "";
        canvas!.style.cursor = "";
        return;
      }
      // Only claim the touch gesture while there's actually a ball to grab.
      canvas!.style.touchAction = "none";
      const floor = height - 6;
      const size = petSize();
      if (!ball.placed) { ball.x = width * 0.4; ball.y = 0; ball.vx = 0; ball.vy = 0; ball.placed = true; }
      const ballSize = Math.round(size * 0.4);
      ctx!.textAlign = "center";
      ctx!.textBaseline = "alphabetic";
      // A shrinking shadow under an airborne ball is what sells the height.
      if (ball.y > 2 && !ball.carrier) {
        ctx!.save();
        ctx!.globalAlpha = Math.max(0.05, 0.22 - ball.y / 600);
        ctx!.fillStyle = "#000";
        ctx!.beginPath();
        ctx!.ellipse(ball.x, floor - 2, ballSize * 0.34, ballSize * 0.12, 0, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.restore();
      }
      ctx!.font = `${ballSize}px ${EMOJI_FONT}`;
      ctx!.fillText(toy, ball.x, floor - ball.y);
    }

    function drawActor(a: Actor, moving: boolean) {
      const size = petSize();
      const floor = height - 6;
      const useRive = !!a.riv && a.riv.ready && !a.riv.failed;
      // Rive files animate their own gait — only emoji pets get the fake bob.
      const bob = !useRive && moving ? Math.abs(Math.sin(a.hop)) * 4 : 0;
      // Napping on a real bed lifts the pet onto the mattress AND shifts it
      // toward the bed's middle: the bed glyph's left side is the headboard,
      // so a glyph-centered pet looks like it's sleeping on the pillow.
      const onBed = a.mode === "sleep" && !!slotEmoji("bed");
      const bedLift = onBed ? size * 0.15 : 0;
      const bedShift = onBed ? size * 0.3 : 0;
      // Rive artboards are authored facing right, so they mirror when heading
      // left. Emoji mirror relative to whichever way their glyph already
      // points — and head-on glyphs (facing 0) never mirror at all.
      const flip = useRive
        ? a.facing === -1
        : a.glyphFacing !== 0 && a.facing !== a.glyphFacing;
      ctx!.save();
      ctx!.translate(a.x + bedShift, floor - bob - bedLift);
      if (flip) ctx!.scale(-1, 1);
      if (useRive) {
        a.riv!.setWalking(a.mode === "walk" || a.mode === "chase" || a.mode === "carry");
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
        ctx!.fillText("💤", a.x + bedShift + size * 0.4, floor - size * 0.7);
      }
      if (a.mode === "eat" && Math.abs(a.x - bowlX()) < 24) {
        ctx!.font = `${Math.round(size * 0.32)}px ${EMOJI_FONT}`;
        ctx!.textAlign = "center";
        ctx!.fillText("♪", a.x + size * 0.35, floor - size * 0.8);
      }
    }

    // True while the ball is worth chasing: held aloft by the pointer, or still
    // inside the interest window after a throw — and nobody has claimed it yet.
    const ballIsLive = () => ball.placed && (ball.held || ball.interest > 0) && !ball.carrier;

    function step(a: Actor, dt: number, sleeping: boolean) {
      const pad = 20;
      if (sleeping) {
        // Dropping off mid-fetch: leave the ball where it stands rather than
        // freezing it inside a sleeping pet.
        if (ball.carrier === a.id0) { ball.carrier = null; ball.y = 0; ball.vx = 0; ball.vy = 0; ball.interest = 0; }
        const dx = a.bedX - a.x;
        if (Math.abs(dx) > 2) { a.facing = dx < 0 ? -1 : 1; a.x += Math.sign(dx) * Math.min(Math.abs(dx), 70 * dt); a.mode = "walk"; a.hop += dt * 9; }
        else { a.mode = "sleep"; a.vx = 0; }
        return;
      }
      // Retrieval. Whoever grabbed the ball trots it home to its bed and drops
      // it there; the ball rides at mouth height along the way.
      if (ball.carrier === a.id0) {
        a.mode = "carry";
        a.vx = 0;
        const dx = a.bedX - a.x;
        if (Math.abs(dx) > 2) {
          a.facing = dx < 0 ? -1 : 1;
          a.x += Math.sign(dx) * Math.min(Math.abs(dx), CARRY_SPEED * dt);
          a.hop += dt * 10;
        } else {
          // Home. Drop it at the bed and go back to being a normal animal.
          ball.carrier = null;
          ball.interest = 0;
          ball.vx = 0;
          ball.vy = 0;
          ball.y = 0;
          ball.x = a.bedX;
          a.mode = "idle";
          a.until = 0.6 + rand(rng);
          return;
        }
        ball.x = a.x + a.facing * petSize() * 0.32;
        ball.y = petSize() * 0.3; // carried in the mouth, not rolling
        return;
      }
      // Someone else has it — the game is over for everyone but the carrier.
      if (ball.carrier) {
        if (a.mode === "chase" || a.mode === "carry") { a.mode = "idle"; a.vx = 0; a.until = 0.5 + rand(rng); }
      } else if (a.playful && ballIsLive()) {
        // A thrown or dangled ball is irresistible — but only to species that
        // actually play fetch. Everyone else carries on with their idle life.
        a.mode = "chase";
        a.vx = 0;
        const dx = ball.x - a.x;
        if (Math.abs(dx) > 3) {
          a.facing = dx < 0 ? -1 : 1;
          a.x += Math.sign(dx) * Math.min(Math.abs(dx), CHASE_SPEED * dt);
          a.hop += dt * 12;
        }
        a.x = Math.min(width - pad, Math.max(pad, a.x));
        // First one to reach it claims it. Only a grounded ball can be grabbed
        // — one still held by the pointer stays out of reach.
        if (!ball.held && ball.y < 10 && Math.abs(ball.x - a.x) < petSize() * 0.4) {
          ball.carrier = a.id0;
          ball.vx = 0;
          ball.vy = 0;
        }
        a.until = 0; // re-roll a fresh behavior as soon as interest lapses
        return;
      } else if (a.mode === "chase" || a.mode === "carry") {
        a.mode = "idle"; a.vx = 0; a.until = 0.4 + rand(rng);
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
      // Deliberately NO incidental kick here. Pets used to boot the ball
      // whenever they wandered into it, which meant a resting ball never
      // stayed at rest — it got re-launched forever by passing traffic. The
      // ball now only moves when you throw it or a pet is fetching it.
    }

    function stepBall(dt: number) {
      if (!ball.placed) return;
      if (ball.interest > 0) ball.interest = Math.max(0, ball.interest - dt);
      if (ball.held) { ball.vx = 0; ball.vy = 0; return; } // the pointer owns it
      if (ball.carrier) return; // the carrying pet drives its position
      if (ball.vx === 0 && ball.vy === 0 && ball.y === 0) return;
      const pad = 16;
      ball.x += ball.vx * dt;
      ball.y += ball.vy * dt;
      ball.vy -= GRAVITY * dt;
      if (ball.y <= 0) {
        ball.y = 0;
        // Settle instead of micro-bouncing forever: below REST_VY the impact
        // is absorbed outright, and rolling friction kills the last of the
        // horizontal speed. A thrown ball comes fully to rest in a second or
        // two and then stays put, like a real one.
        ball.vy = ball.vy < -REST_VY ? -ball.vy * BOUNCE : 0;
        ball.vx *= Math.max(0, 1 - 3.2 * dt); // rolling friction, ground only
        if (Math.abs(ball.vx) < REST_VX) ball.vx = 0;
      }
      const ceiling = Math.max(0, height - 14);
      if (ball.y > ceiling) { ball.y = ceiling; ball.vy = -Math.abs(ball.vy) * BOUNCE; }
      if (ball.x < pad) { ball.x = pad; ball.vx = Math.abs(ball.vx) * 0.7; }
      if (ball.x > width - pad) { ball.x = width - pad; ball.vx = -Math.abs(ball.vx) * 0.7; }
    }

    function render(moving: boolean) {
      ctx!.clearRect(0, 0, width, height);
      drawBackdrop();
      drawFurniture();
      if (!ball.carrier) drawBall();
      for (const a of actors) drawActor(a, moving && (a.mode === "walk" || a.mode === "chase" || a.mode === "carry"));
      if (ball.carrier) drawBall();
    }

    resize();
    syncActors();

    // Static path: one frame, no loop. Park pets evenly along the floor —
    // except sleeping pets with a bed, which park ON their bed.
    if (stateRef.current.reduceMotion) {
      const pad = 24;
      const park = (a: Actor, i: number) => {
        a.mode = stateRef.current.asleep ? "sleep" : "idle";
        a.x = a.mode === "sleep" && slotEmoji("bed") ? a.bedX : pad + (i + 0.5) * ((width - pad * 2) / Math.max(1, actors.length));
      };
      actors.forEach(park);
      render(false);
      const ro = new ResizeObserver(() => { resize(); actors.forEach(park); render(false); });
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

    // ---- Grab & throw ----------------------------------------------------
    // The ball is the one interactive thing on the stage: press on it, drag it
    // anywhere in the pen, and release to throw. Release velocity comes from
    // the last two pointer samples, so a flick actually flings it.
    const floorY = () => height - 6;
    const ballCenter = () => ({ x: ball.x, y: floorY() - ball.y - petSize() * 0.14 });
    const grabRadius = () => Math.max(22, petSize() * 0.45);
    const localPoint = (e: PointerEvent) => {
      const r = canvas!.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const overBall = (p: { x: number; y: number }) => {
      const c = ballCenter();
      return ball.placed && Math.hypot(p.x - c.x, p.y - c.y) <= grabRadius();
    };

    type Sample = { x: number; y: number; t: number };
    let drag: { id: number; prev: Sample | null; last: Sample } | null = null;

    const onPointerDown = (e: PointerEvent) => {
      const p = localPoint(e);
      if (!overBall(p)) return;
      drag = { id: e.pointerId, prev: null, last: { x: p.x, y: p.y, t: e.timeStamp } };
      ball.held = true;
      ball.carrier = null; // taking it back out of a pet's mouth ends the fetch
      ball.vx = 0;
      ball.vy = 0;
      canvas!.setPointerCapture(e.pointerId);
      canvas!.style.cursor = "grabbing";
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      const p = localPoint(e);
      if (!drag || drag.id !== e.pointerId) {
        canvas!.style.cursor = overBall(p) ? "grab" : "";
        return;
      }
      ball.x = Math.min(width - 16, Math.max(16, p.x));
      ball.y = Math.min(Math.max(0, height - 14), Math.max(0, floorY() - p.y));
      drag.prev = drag.last;
      drag.last = { x: p.x, y: p.y, t: e.timeStamp };
      e.preventDefault();
    };

    const releaseBall = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const from = drag.prev ?? drag.last;
      const dt = Math.max(16, drag.last.t - from.t) / 1000;
      const clamp = (v: number) => Math.max(-MAX_THROW, Math.min(MAX_THROW, v));
      ball.vx = clamp((drag.last.x - from.x) / dt);
      ball.vy = clamp(-(drag.last.y - from.y) / dt); // screen y is inverted
      ball.held = false;
      ball.interest = CHASE_INTEREST; // a plain drop still gets them curious
      drag = null;
      canvas!.style.cursor = overBall(localPoint(e)) ? "grab" : "";
      if (canvas!.hasPointerCapture(e.pointerId)) canvas!.releasePointerCapture(e.pointerId);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", releaseBall);
    canvas.addEventListener("pointercancel", releaseBall);

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
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", releaseBall);
      canvas.removeEventListener("pointercancel", releaseBall);
      ro.disconnect();
      for (const a of actors) a.riv?.cleanup();
    };
    // Re-arm when switching between animated and static rendering, and on a
    // theme change so the static (reduce-motion) frame repaints its wallpaper.
    // Every other prop is read live from stateRef inside the loop.
  }, [reduceMotion, theme]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}

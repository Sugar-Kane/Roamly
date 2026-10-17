// Where worn accessories (hat / face slot) sit on each pet.
//
// Pets are emoji glyphs, and the glyphs are not all head-on portraits: some are
// full-body side views (🦝 🦔 🐉 on Apple) and the two big emoji sets frame the
// same animal differently (Apple's 🦆 head sits top-left, Google's 🐢 has a
// head-on face low on the left). A single fixed offset therefore floats hats in
// the air and puts shades on a duck's chest. Instead each species has anchors —
// the top of its head and its eye(s) — per emoji set.
//
// Anchors are fractions of the glyph's VISIBLE ink box (0,0 = top-left of the
// opaque pixels, 1,1 = bottom-right), measured from the Apple and Google
// (Noto) art. At runtime the ink box of each glyph is measured once on an
// offscreen canvas, so the anchors land correctly whatever the font's metrics,
// size or padding. Accessory glyphs are measured the same way and fitted to
// the head width / eye span.

import type { PetSpecies } from "./petCatalog";

type Pt = [number, number];
export type WearAnchors = {
  top: Pt; // where a hat's brim rests (centre of the head's top edge)
  w: number; // head width at the hat line, as a fraction of the ink-box width
} & ({ eyes: [Pt, Pt] } | { eye: Pt; front: -1 | 1 }); // head-on: both eyes; profile: the visible eye + which way the face points

const APPLE: Record<PetSpecies, WearAnchors> = {
  dog: { top: [0.5, -0.024], w: 0.55, eyes: [[0.36, 0.569], [0.64, 0.569]] },
  cat: { top: [0.5, 0.177], w: 0.64, eyes: [[0.308, 0.671], [0.692, 0.671]] },
  bird: { top: [0.593, 0.137], w: 0.497, eye: [0.527, 0.503], front: -1 },
  rabbit: { top: [0.5, 0.37], w: 0.492, eyes: [[0.328, 0.65], [0.697, 0.65]] },
  hamster: { top: [0.5, 0.255], w: 0.533, eyes: [[0.351, 0.681], [0.66, 0.681]] },
  fox: { top: [0.5, 0.205], w: 0.516, eyes: [[0.345, 0.628], [0.645, 0.628]] },
  penguin: { top: [0.585, 0.106], w: 0.587, eye: [0.425, 0.479], front: -1 },
  owl: { top: [0.488, 0.08], w: 0.595, eyes: [[0.295, 0.25], [0.667, 0.25]] },
  turtle: { top: [0.18, 0.003], w: 0.165, eye: [0.232, 0.065], front: -1 },
  duck: { top: [0.274, 0.035], w: 0.142, eye: [0.264, 0.097], front: -1 },
  frog: { top: [0.5, 0.094], w: 0.55, eyes: [[0.31, 0.37], [0.7, 0.37]] },
  raccoon: { top: [0.203, 0.251], w: 0.142, eye: [0.183, 0.355], front: -1 },
  hedgehog: { top: [0.17, 0.443], w: 0.14, eye: [0.14, 0.53], front: -1 },
  koala: { top: [0.5, 0.124], w: 0.55, eyes: [[0.33, 0.601], [0.68, 0.601]] },
  sloth: { top: [0.15, 0.43], w: 0.18, eyes: [[0.11, 0.51], [0.2, 0.49]] },
  panda: { top: [0.5, 0.139], w: 0.587, eyes: [[0.34, 0.562], [0.649, 0.562]] },
  dragon: { top: [0.17, 0.56], w: 0.14, eye: [0.18, 0.61], front: -1 },
  unicorn: { top: [0.514, 0.276], w: 0.309, eye: [0.448, 0.439], front: -1 },
};

// Google / Noto Color Emoji (Android, ChromeOS, Linux). Also the fallback for
// other emoji sets, whose framing is closer to Noto's than to Apple's.
const GOOGLE: Record<PetSpecies, WearAnchors> = {
  dog: { top: [0.5, 0.013], w: 0.533, eyes: [[0.351, 0.506], [0.671, 0.506]] },
  cat: { top: [0.516, 0.178], w: 0.516, eyes: [[0.341, 0.551], [0.702, 0.551]] },
  bird: { top: [0.393, 0.11], w: 0.32, eye: [0.329, 0.236], front: -1 },
  rabbit: { top: [0.511, 0.393], w: 0.427, eyes: [[0.34, 0.607], [0.696, 0.607]] },
  hamster: { top: [0.5, 0.194], w: 0.593, eyes: [[0.334, 0.508], [0.666, 0.508]] },
  fox: { top: [0.511, 0.262], w: 0.427, eyes: [[0.415, 0.587], [0.617, 0.587]] },
  penguin: { top: [0.452, 0.041], w: 0.352, eye: [0.468, 0.137], front: -1 },
  owl: { top: [0.5, 0.101], w: 0.655, eyes: [[0.267, 0.318], [0.675, 0.318]] },
  turtle: { top: [0.201, 0.317], w: 0.235, eyes: [[0.137, 0.434], [0.265, 0.434]] },
  duck: { top: [0.434, 0.035], w: 0.209, eye: [0.388, 0.139], front: -1 },
  frog: { top: [0.521, 0.078], w: 0.533, eyes: [[0.308, 0.235], [0.735, 0.235]] },
  raccoon: { top: [0.5, 0.114], w: 0.48, eyes: [[0.34, 0.495], [0.66, 0.495]] },
  hedgehog: { top: [0.255, 0.315], w: 0.171, eye: [0.233, 0.485], front: -1 },
  koala: { top: [0.5, 0.108], w: 0.516, eyes: [[0.335, 0.503], [0.665, 0.503]] },
  sloth: { top: [0.209, 0.403], w: 0.217, eyes: [[0.166, 0.508], [0.253, 0.508]] },
  panda: { top: [0.5, 0.071], w: 0.568, eyes: [[0.355, 0.505], [0.655, 0.505]] },
  dragon: { top: [0.278, 0.116], w: 0.222, eye: [0.217, 0.201], front: -1 },
  unicorn: { top: [0.396, 0.297], w: 0.247, eye: [0.307, 0.479], front: -1 },
};

// Apple platforms render emoji with Apple Color Emoji (EMOJI_FONT lists it first).
const isApple = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

export function wearAnchors(species: string): WearAnchors | null {
  return (isApple ? APPLE : GOOGLE)[species as PetSpecies] ?? null;
}

// Per-accessory fit, keyed by glyph. Hats: `w` = width relative to the head,
// `sink` = how much of the hat's own height overlaps the head (a helmet sits
// down over the skull, a top hat perches). Face: `w` = width relative to the
// eye span (lens centres sit ~a quarter in from each side), `pw` = width
// relative to the head for side-on pets, `lens` = how far the glasses' centre
// sits behind the visible eye so the front lens covers it.
type HatFit = { w: number; sink: number };
type FaceFit = { w: number; pw: number; lens: number };
const HAT_FIT: Record<string, HatFit> = {
  "👑": { w: 0.75, sink: 0.18 },
  "🧢": { w: 0.95, sink: 0.3 },
  "🎩": { w: 0.7, sink: 0.12 },
  "👒": { w: 0.95, sink: 0.15 },
  "🎓": { w: 0.95, sink: 0.25 },
  "🪖": { w: 0.95, sink: 0.35 },
  "💐": { w: 0.7, sink: 0.2 },
};
const DEFAULT_HAT: HatFit = { w: 0.8, sink: 0.2 };
const FACE_FIT: Record<string, FaceFit> = {
  "🕶️": { w: 2.0, pw: 1.1, lens: 0.25 },
  "🕶": { w: 2.0, pw: 1.1, lens: 0.25 },
  "👓": { w: 2.0, pw: 1.1, lens: 0.25 },
  "🥽": { w: 2.0, pw: 1.1, lens: 0.25 },
  "🎭": { w: 1.8, pw: 1.0, lens: 0 },
};
const DEFAULT_FACE: FaceFit = { w: 2.0, pw: 1.1, lens: 0.25 };

// Tiny heads (a duck or a side-on raccoon) still get a hat you can see.
const MIN_HAT = 0.22; // × glyph font size
const MIN_FACE = 0.16;

// Visible ink box of a glyph drawn with textAlign=center, baseline=alphabetic
// at the origin, in units of the font size. null if nothing rendered (no emoji
// font) — callers then fall back to the old fixed offsets.
export type InkBox = { l: number; t: number; r: number; b: number };
const REF = 100;
const inkCache = new Map<string, InkBox | null>();
export function inkBox(glyph: string, font: string): InkBox | null {
  const key = glyph + "\u0000" + font;
  if (inkCache.has(key)) return inkCache.get(key)!;
  let box: InkBox | null = null;
  try {
    const c = document.createElement("canvas");
    c.width = REF * 3;
    c.height = REF * 3;
    const x = c.getContext("2d", { willReadFrequently: true });
    if (x) {
      const ox = REF * 1.5, oy = REF * 2;
      x.font = `${REF}px ${font}`;
      x.textAlign = "center";
      x.textBaseline = "alphabetic";
      x.fillText(glyph, ox, oy);
      const { data } = x.getImageData(0, 0, c.width, c.height);
      let l = c.width, t = c.height, r = -1, b = -1;
      for (let y = 0; y < c.height; y++) {
        for (let i = 0; i < c.width; i++) {
          if (data[(y * c.width + i) * 4 + 3]! > 24) {
            if (i < l) l = i;
            if (i > r) r = i;
            if (y < t) t = y;
            if (y > b) b = y;
          }
        }
      }
      if (r >= l && b >= t) box = { l: (l - ox) / REF, t: (t - oy) / REF, r: (r + 1 - ox) / REF, b: (b + 1 - oy) / REF };
    }
  } catch {
    box = null;
  }
  inkCache.set(key, box);
  return box;
}

// Where to draw an accessory glyph: font size, the fillText origin, and a
// rotation (radians) about (cx, cy). All in the pet's local, unflipped space —
// origin at the pet glyph's baseline centre — so it rides the pet's transform.
export type WearDraw = { font: number; x: number; y: number; rot: number; cx: number; cy: number };

export function placeHat(species: string, pet: string, hat: string, size: number, font: string): WearDraw | null {
  const an = wearAnchors(species);
  const pb = inkBox(pet, font);
  const hb = inkBox(hat, font);
  if (!an || !pb || !hb) return null;
  const pw = (pb.r - pb.l) * size, ph = (pb.b - pb.t) * size;
  const ax = pb.l * size + an.top[0] * pw;
  const ay = pb.t * size + an.top[1] * ph;
  const fit = HAT_FIT[hat] ?? DEFAULT_HAT;
  const targetW = Math.max(an.w * pw * fit.w, MIN_HAT * size);
  const fs = targetW / (hb.r - hb.l);
  const hatH = (hb.b - hb.t) * fs;
  const bottom = ay + fit.sink * hatH;
  return { font: fs, x: ax - ((hb.l + hb.r) / 2) * fs, y: bottom - hb.b * fs, rot: 0, cx: ax, cy: ay };
}

export function placeFace(species: string, pet: string, face: string, size: number, font: string): WearDraw | null {
  const an = wearAnchors(species);
  const pb = inkBox(pet, font);
  const fb = inkBox(face, font);
  if (!an || !pb || !fb) return null;
  const pw = (pb.r - pb.l) * size, ph = (pb.b - pb.t) * size;
  const px = (p: Pt) => pb.l * size + p[0] * pw;
  const py = (p: Pt) => pb.t * size + p[1] * ph;
  const fit = FACE_FIT[face] ?? DEFAULT_FACE;
  let cx: number, cy: number, targetW: number, rot = 0;
  if ("eyes" in an) {
    const [e1, e2] = an.eyes;
    const dx = px(e2) - px(e1), dy = py(e2) - py(e1);
    targetW = Math.max(Math.hypot(dx, dy) * fit.w, MIN_FACE * size);
    cx = (px(e1) + px(e2)) / 2;
    cy = (py(e1) + py(e2)) / 2;
    rot = Math.atan2(dy, dx);
  } else {
    targetW = Math.max(an.w * pw * fit.pw, MIN_FACE * size);
    // Side-on: the front lens covers the visible eye, the far one sits back
    // over the head.
    cx = px(an.eye) - an.front * fit.lens * targetW;
    cy = py(an.eye);
  }
  const fs = targetW / (fb.r - fb.l);
  return {
    font: fs,
    x: cx - ((fb.l + fb.r) / 2) * fs,
    y: cy - ((fb.t + fb.b) / 2) * fs,
    rot,
    cx,
    cy,
  };
}

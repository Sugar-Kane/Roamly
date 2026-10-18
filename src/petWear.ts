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
import { inkBounds } from "./emojiSprite";

type Pt = [number, number];
export type WearAnchors = {
  top: Pt; // where a hat's brim rests (centre of the head's top edge)
  w: number; // head width at the hat line, as a fraction of the ink-box width
} & ({ eyes: [Pt, Pt] } | { eye: Pt; front: -1 | 1 }); // head-on: both eyes; profile: the visible eye + which way the face points

const APPLE: Record<PetSpecies, WearAnchors> = {
  dog: { top: [0.508, -0.044], w: 0.577, eyes: [[0.361, 0.572], [0.655, 0.572]] },
  cat: { top: [0.5, 0.165], w: 0.64, eyes: [[0.308, 0.677], [0.692, 0.677]] },
  bird: { top: [0.596, 0.122], w: 0.515, eye: [0.528, 0.503], front: -1 },
  rabbit: { top: [0.5, 0.372], w: 0.512, eyes: [[0.321, 0.666], [0.705, 0.666]] },
  hamster: { top: [0.5, 0.251], w: 0.551, eyes: [[0.346, 0.699], [0.666, 0.699]] },
  fox: { top: [0.492, 0.195], w: 0.542, eyes: [[0.329, 0.632], [0.644, 0.632]] },
  penguin: { top: [0.588, 0.089], w: 0.607, eye: [0.422, 0.478], front: -1 },
  owl: { top: [0.5, 0.066], w: 0.64, eyes: [[0.292, 0.242], [0.692, 0.242]] },
  turtle: { top: [0.172, -0.017], w: 0.173, eye: [0.227, 0.047], front: -1 },
  duck: { top: [0.267, 0.02], w: 0.147, eye: [0.256, 0.084], front: -1 },
  frog: { top: [0.5, 0.096], w: 0.568, eyes: [[0.304, 0.377], [0.706, 0.377]] },
  raccoon: { top: [0.193, 0.237], w: 0.147, eye: [0.173, 0.347], front: -1 },
  hedgehog: { top: [0.159, 0.44], w: 0.145, eye: [0.128, 0.531], front: -1 },
  koala: { top: [0.5, 0.11], w: 0.568, eyes: [[0.325, 0.605], [0.686, 0.605]] },
  sloth: { top: [0.15, 0.437], w: 0.18, eyes: [[0.11, 0.518], [0.2, 0.498]] },
  panda: { top: [0.5, 0.126], w: 0.607, eyes: [[0.334, 0.564], [0.654, 0.564]] },
  dragon: { top: [0.159, 0.555], w: 0.145, eye: [0.17, 0.607], front: -1 },
  unicorn: { top: [0.514, 0.253], w: 0.32, eye: [0.446, 0.426], front: -1 },
};

// Google / Noto Color Emoji (Android, ChromeOS, Linux). Also the fallback for
// other emoji sets, whose framing is closer to Noto's than to Apple's.
const GOOGLE: Record<PetSpecies, WearAnchors> = {
  dog: { top: [0.5, -0.008], w: 0.551, eyes: [[0.346, 0.506], [0.677, 0.506]] },
  cat: { top: [0.482, 0.163], w: 0.571, eyes: [[0.288, 0.543], [0.688, 0.543]] },
  bird: { top: [0.389, 0.112], w: 0.331, eye: [0.323, 0.24], front: -1 },
  rabbit: { top: [0.512, 0.389], w: 0.447, eyes: [[0.333, 0.611], [0.705, 0.611]] },
  hamster: { top: [0.5, 0.182], w: 0.616, eyes: [[0.328, 0.508], [0.672, 0.508]] },
  fox: { top: [0.511, 0.249], w: 0.442, eyes: [[0.412, 0.58], [0.621, 0.58]] },
  penguin: { top: [0.449, 0.025], w: 0.371, eye: [0.466, 0.124], front: -1 },
  owl: { top: [0.5, 0.087], w: 0.686, eyes: [[0.256, 0.312], [0.683, 0.312]] },
  turtle: { top: [0.191, 0.309], w: 0.243, eyes: [[0.124, 0.431], [0.257, 0.431]] },
  duck: { top: [0.424, 0.02], w: 0.213, eye: [0.377, 0.127], front: -1 },
  frog: { top: [0.522, 0.061], w: 0.551, eyes: [[0.301, 0.225], [0.743, 0.225]] },
  raccoon: { top: [0.5, 0.097], w: 0.497, eyes: [[0.334, 0.495], [0.666, 0.495]] },
  hedgehog: { top: [0.247, 0.306], w: 0.177, eye: [0.224, 0.484], front: -1 },
  koala: { top: [0.5, 0.091], w: 0.533, eyes: [[0.33, 0.503], [0.671, 0.503]] },
  sloth: { top: [0.199, 0.4], w: 0.225, eyes: [[0.154, 0.508], [0.244, 0.508]] },
  panda: { top: [0.5, 0.055], w: 0.587, eyes: [[0.35, 0.505], [0.66, 0.505]] },
  dragon: { top: [0.254, 0.103], w: 0.236, eye: [0.189, 0.191], front: -1 },
  unicorn: { top: [0.392, 0.265], w: 0.256, eye: [0.3, 0.46], front: -1 },
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
      // Noise-tolerant scan — see inkBounds for why a plain alpha test fails on Safari.
      const ink = inkBounds(data, c.width, c.height);
      if (ink) box = { l: (ink.l - ox) / REF, t: (ink.t - oy) / REF, r: (ink.r + 1 - ox) / REF, b: (ink.b + 1 - oy) / REF };
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

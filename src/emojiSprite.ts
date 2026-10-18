// Emoji as tightly-cropped images.
//
// An emoji drawn as text sits in a line box with font-dependent padding — on
// most platforms there's empty space below the glyph, so a plant "standing" on
// the soil actually floats above it and its shadow lands in the wrong place.
// Rendering the glyph once onto a canvas and cropping to its visible pixels
// gives an image whose bottom edge IS the bottom of the plant, on whatever
// emoji font the platform has. Results are cached per glyph.

export const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

export type EmojiSprite = {
  src: string; // PNG data URL of the cropped glyph
  w: number; // cropped size, in units of the font size (e.g. 0.82 = 82% of an em)
  h: number;
};

const REF = 128; // render size; images are scaled down with CSS, so keep it crisp
const cache = new Map<string, EmojiSprite | null>();

// Bounds of a glyph's solid pixels in RGBA data, or null if there are none.
//
// Safari's fingerprinting protection adds random noise to getImageData, which
// lights up the transparent padding around an emoji's bitmap — a plain
// "alpha > small" scan then returns the whole emoji square, and a hat meant for
// the top of a dog's head floats a sixth of the head above it. Emoji art is
// opaque inside its outline, so only rows/columns with a few near-opaque
// pixels count as ink; noise doesn't produce those.
export function inkBounds(data: Uint8ClampedArray, w: number, h: number): { l: number; t: number; r: number; b: number } | null {
  const SOLID = 200;
  const MIN_RUN = 2;
  const rows = new Uint16Array(h);
  const cols = new Uint16Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3]! >= SOLID) {
        rows[y]++;
        cols[x]++;
      }
    }
  }
  let t = 0, b = h - 1, l = 0, r = w - 1;
  while (t < h && rows[t]! < MIN_RUN) t++;
  while (b >= t && rows[b]! < MIN_RUN) b--;
  while (l < w && cols[l]! < MIN_RUN) l++;
  while (r >= l && cols[r]! < MIN_RUN) r--;
  return t <= b && l <= r ? { l, t, r, b } : null;
}

export function emojiSprite(glyph: string): EmojiSprite | null {
  if (cache.has(glyph)) return cache.get(glyph)!;
  let sprite: EmojiSprite | null = null;
  try {
    if (typeof document !== "undefined") {
      const c = document.createElement("canvas");
      c.width = REF * 2;
      c.height = REF * 2;
      const x = c.getContext("2d", { willReadFrequently: true });
      if (x) {
        x.font = `${REF}px ${EMOJI_FONT}`;
        x.textAlign = "center";
        x.textBaseline = "middle";
        x.fillText(glyph, REF, REF);
        const { data } = x.getImageData(0, 0, c.width, c.height);
        const box = inkBounds(data, c.width, c.height);
        if (box) {
          // One pixel of margin keeps the glyph's anti-aliased rim.
          const l = Math.max(0, box.l - 1), t = Math.max(0, box.t - 1);
          const r = Math.min(c.width - 1, box.r + 1), b = Math.min(c.height - 1, box.b + 1);
          const w = r - l + 1, h = b - t + 1;
          const out = document.createElement("canvas");
          out.width = w;
          out.height = h;
          out.getContext("2d")!.drawImage(c, l, t, w, h, 0, 0, w, h);
          sprite = { src: out.toDataURL("image/png"), w: w / REF, h: h / REF };
        }
      }
    }
  } catch {
    sprite = null; // tainted canvas / no 2D context — callers fall back to text
  }
  cache.set(glyph, sprite);
  return sprite;
}

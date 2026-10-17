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
        let l = c.width, t = c.height, r = -1, b = -1;
        for (let y = 0; y < c.height; y++) {
          for (let i = 0; i < c.width; i++) {
            if (data[(y * c.width + i) * 4 + 3]! > 12) {
              if (i < l) l = i;
              if (i > r) r = i;
              if (y < t) t = y;
              if (y > b) b = y;
            }
          }
        }
        if (r >= l && b >= t) {
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

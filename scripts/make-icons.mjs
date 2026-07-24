// One-off generator for the raster app icons, rendered from the single source
// of truth: public/favicon.svg (the canonical dot + 3/4-circle mark — a dark
// rounded square with a dashed ring and a center dot). Keeping these PNGs in
// sync with favicon.svg is what stops the icons from drifting to an old mark.
//
// Run manually with:  node scripts/make-icons.mjs
// The PNGs it writes are committed as static assets; this is NOT part of the
// normal build. Uses Playwright (already a dev dependency), same as make-og.mjs.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");

// The canonical mark. Read the committed SVG so this script can never disagree
// with favicon.svg about what the logo is.
const markSvg = readFileSync(join(publicDir, "favicon.svg"), "utf8").trim();

// output file -> pixel size
const targets = [
  ["favicon.png", 64],
  ["apple-touch-icon.png", 180],
  ["icon-512.png", 512],
  // Logo for HTML emails (Supabase auth templates). Email clients can't render
  // SVG, so they reference this hosted PNG by absolute URL. 256px gives a crisp
  // mark when displayed at ~64-128px on retina screens.
  ["logo-email.png", 256],
];

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
});

for (const [file, size] of targets) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { margin: 0; padding: 0; }
    html, body { width: ${size}px; height: ${size}px; background: transparent; }
    svg { display: block; width: ${size}px; height: ${size}px; }
  </style></head><body>${markSvg}</body></html>`;

  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: "networkidle" });
  const out = join(publicDir, file);
  await page.screenshot({
    path: out,
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  await page.close();
  console.log("wrote", out, `(${size}x${size})`);
}

await browser.close();

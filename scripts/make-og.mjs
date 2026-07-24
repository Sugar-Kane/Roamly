// One-off generator for the social share image (public/og-image.png, 1200x630).
// Run manually with:  node scripts/make-og.mjs
// The PNG it produces is committed as a static asset; this script is NOT part
// of the normal build. Playwright (already a dev dependency) renders a small
// branded HTML card and screenshots it at the exact Open Graph dimensions.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "og-image.png");

// Use the canonical mark (public/favicon.svg) so the share image shows the same
// dot + 3/4-circle logo as the app icon and header, not a one-off drawing.
const markSvg = readFileSync(join(root, "public", "favicon.svg"), "utf8").trim();

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    display: flex; flex-direction: column; justify-content: center;
    padding: 96px;
    background: radial-gradient(1100px 700px at 78% 22%, #24203f 0%, #16181D 62%);
    color: #f2f2f5;
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  .brand { display: flex; align-items: center; gap: 22px; margin-bottom: 40px; }
  .mark { width: 68px; height: 68px; }
  .mark svg { display: block; width: 68px; height: 68px; }
  .name { font-size: 40px; font-weight: 700; letter-spacing: -0.01em; }
  h1 { font-size: 74px; line-height: 1.05; font-weight: 800; letter-spacing: -0.02em; max-width: 20ch; }
  h1 .accent { color: #b7acff; }
  p { margin-top: 30px; font-size: 34px; color: #b6b6bf; max-width: 26ch; line-height: 1.3; }
  .url { margin-top: 52px; font-size: 26px; color: #8f8f99; font-weight: 600; letter-spacing: 0.02em; }
</style></head><body>
  <div class="brand">
    <div class="mark">${markSvg}</div>
    <div class="name">Roamly Flow</div>
  </div>
  <h1>Focus timer and <span class="accent">study planner</span></h1>
  <p>Pomodoro sessions, study planning, and progress tracking. Free to start.</p>
  <div class="url">www.roamlyflow.com</div>
</body></html>`;

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined,
});
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle" });
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log("wrote", out);

/**
 * Builds out/contact-sheet.html — every capture at review size, with the shot
 * it is supposed to be and a checklist beside it.
 *
 * This is the sign-off artifact: the brief requires the captures to be
 * reviewed and approved before any animation work is trusted, and reviewing
 * ten files by opening them one at a time is how a logged-out corner or a
 * stranger's avatar slips through.
 *
 * Video captures are embedded as playable <video> so the clips can be checked
 * for the same things as the stills.
 */

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "out/contact-sheet.html");

const source = await readFile(resolve(ROOT, "src/captures.ts"), "utf8");
const entries = [
  ...source.matchAll(
    /file:\s*"([^"]+)",\s*\n\s*kind:\s*"(image|video)",\s*\n\s*scene:\s*"([^"]+)",\s*\n\s*intent:\s*"([^"]+)"/g,
  ),
].map((m) => ({ file: m[1], kind: m[2], scene: m[3], intent: m[4] }));

const isPlaceholder = existsSync(resolve(ROOT, "public/captures/.placeholders"));

const cards = await Promise.all(
  entries.map(async (e) => {
    const path = resolve(ROOT, "public/captures", e.file);
    const present = existsSync(path);
    const size = present ? Math.round((await stat(path)).size / 1024) : 0;
    const media = !present
      ? `<div class="missing">not captured</div>`
      : e.kind === "video"
        ? `<video src="../public/captures/${e.file}" controls muted loop></video>`
        : `<img src="../public/captures/${e.file}" alt="${e.file}">`;

    return `<figure${present ? "" : ' class="absent"'}>
  ${media}
  <figcaption>
    <div class="file">${e.file} ${present ? `<span class="kb">${size} KB</span>` : ""}</div>
    <div class="scene">Scene ${e.scene}</div>
    <div class="intent">${e.intent}</div>
    <ul class="checks">
      <li>Signed in — no "Sign in" button, no auth prompt</li>
      <li>Populated — no empty state, no zeroed stats</li>
      <li>No real names, emails, or avatars but the demo account's</li>
    </ul>
  </figcaption>
</figure>`;
  }),
);

const html = `<!doctype html>
<meta charset="utf-8">
<title>RoamlyFlow promo — capture contact sheet</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 40px;
         background: #F0E9E0; color: #4A3A2E; }
  h1 { font-size: 28px; margin: 0 0 6px; }
  .lede { color: #7A6857; max-width: 62ch; margin: 0 0 28px; }
  .warn { background: #C47A5B; color: #fff; padding: 14px 18px; border-radius: 8px;
          margin: 0 0 28px; max-width: 62ch; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(460px, 1fr)); gap: 26px; }
  figure { margin: 0; background: #fff; border-radius: 10px; overflow: hidden;
           box-shadow: 0 8px 24px rgba(74,58,46,.12); }
  figure.absent { opacity: .55; outline: 2px dashed #C47A5B; }
  img, video { width: 100%; display: block; background: #E7DED2; aspect-ratio: 16/9;
               object-fit: cover; }
  .missing { aspect-ratio: 16/9; display: grid; place-items: center; background: #E7DED2;
             color: #88613F; font-weight: 600; }
  figcaption { padding: 14px 16px 18px; }
  .file { font-family: ui-monospace, monospace; font-weight: 600; }
  .kb { color: #7A6857; font-weight: 400; }
  .scene { color: #88613F; font-size: 13px; margin-top: 2px; }
  .intent { margin-top: 8px; }
  .checks { margin: 12px 0 0; padding-left: 18px; color: #7A6857; font-size: 13px; }
</style>
<h1>Capture contact sheet</h1>
<p class="lede">Every shot the promo depends on. Approve all of them before any
animation work is trusted — the video's credibility is entirely downstream of
whether these look like a real account in use.</p>
${
  isPlaceholder
    ? `<p class="warn"><strong>These are generated placeholders</strong>, not real
captures. Run the capture pipeline against a signed-in demo account before
reviewing. Rendering is blocked until they are replaced.</p>`
    : ""
}
<div class="grid">
${cards.join("\n")}
</div>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, html, "utf8");
console.log(`Wrote out/contact-sheet.html (${entries.length} shots). Open it to review.`);

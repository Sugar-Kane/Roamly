// Post-build prerender for the public marketing routes.
//
// The app is a client-rendered Vite SPA: `vite build` emits a single
// dist/index.html whose <head> carries the HOME page's metadata. This script
// generates an additional static HTML file per indexable non-root route (e.g.
// dist/premium.html) by cloning that shell and swapping in the route's own
// title / description / canonical / Open Graph / Twitter values.
//
// The result: a crawler or social scraper that does NOT run our JavaScript
// still receives correct, unique per-route metadata in the raw HTML, and the
// same JS bundle then boots the SPA to the right view on load. Route metadata
// comes from src/seo-routes.json, the single source shared with the runtime
// head manager (src/seo.ts), so the two never drift.
//
// Vercel serves dist/premium.html at /premium automatically (extensionless
// static file). vercel.json routes the remaining app views to the SPA shell.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SITE_ORIGIN = "https://www.roamlyflow.com";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distIndex = join(root, "dist", "index.html");

/** @type {{view:string,path:string,index:boolean,title:string,description:string}[]} */
const routes = JSON.parse(readFileSync(join(root, "src", "seo-routes.json"), "utf8"));

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Replace the content of a specific meta/link/title tag, tolerating Vite's
// self-closing style. Throws if a tag we expect to swap isn't found, so a
// silent metadata regression can't ship.
function replaceTag(html, re, replacement, label, file) {
  if (!re.test(html)) throw new Error(`prerender: could not find ${label} in ${file}`);
  return html.replace(re, replacement);
}

if (!existsSync(distIndex)) {
  console.error("prerender: dist/index.html not found — run vite build first.");
  process.exit(1);
}
const shell = readFileSync(distIndex, "utf8");

let generated = 0;
for (const r of routes) {
  if (!r.index || r.path === "/") continue; // home is already dist/index.html
  const url = SITE_ORIGIN + r.path;
  const t = esc(r.title);
  const d = esc(r.description);
  let html = shell;
  html = replaceTag(html, /<title>[\s\S]*?<\/title>/, `<title>${t}</title>`, "title", distIndex);
  html = replaceTag(html, /<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${d}"/>`, "description", distIndex);
  html = replaceTag(html, /<link rel="canonical" href="[^"]*"\s*\/?>/, `<link rel="canonical" href="${url}"/>`, "canonical", distIndex);
  html = replaceTag(html, /<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${t}"/>`, "og:title", distIndex);
  html = replaceTag(html, /<meta property="og:description" content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${d}"/>`, "og:description", distIndex);
  html = replaceTag(html, /<meta property="og:url" content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${url}"/>`, "og:url", distIndex);
  html = replaceTag(html, /<meta name="twitter:title" content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${t}"/>`, "twitter:title", distIndex);
  html = replaceTag(html, /<meta name="twitter:description" content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${d}"/>`, "twitter:description", distIndex);

  const slug = r.path.replace(/^\//, "");
  const out = join(root, "dist", `${slug}.html`);
  writeFileSync(out, html, "utf8");
  generated += 1;
  console.log(`prerender: wrote dist/${slug}.html`);
}
console.log(`prerender: ${generated} page(s) generated.`);

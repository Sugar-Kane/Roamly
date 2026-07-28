/**
 * Refuses to render until the project can actually produce an honest video.
 *
 * The brief's hard rule is that no placeholder, no logged-out screen, and no
 * empty state may reach a finished file. The Capture component renders a
 * visible placeholder so the Studio is usable during development, which means
 * the only thing standing between a placeholder and a shipped .mp4 is this
 * check. It runs before every render.
 */

import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CAPTURES = resolve(ROOT, "public/captures");

/** Below this, a "capture" is a broken or blank file rather than a screen. */
const MIN_BYTES = { image: 40_000, video: 150_000 };

// Parse the manifest out of src/captures.ts so this script and the scenes agree
// on what is required without duplicating the list.
const source = await readFile(resolve(ROOT, "src/captures.ts"), "utf8");
const entries = [
  ...source.matchAll(/file:\s*"([^"]+)",\s*\n\s*kind:\s*"(image|video)"/g),
].map((m) => ({ file: m[1], kind: m[2] }));

if (entries.length === 0) {
  console.error("Could not parse the capture manifest from src/captures.ts.");
  process.exit(1);
}

const problems = [];

// The placeholder marker is checked first and reported on its own, because it
// means every capture below is a stand-in card rather than a real screen.
if (existsSync(join(CAPTURES, ".placeholders"))) {
  console.error(
    "\nPreflight failed: public/captures/ holds generated placeholders.\n\n" +
      "  Run the real capture pipeline against a signed-in demo account:\n" +
      "    npm run placeholders:clean\n" +
      "    ROAMLY_EMAIL=... ROAMLY_PASSWORD=... node scripts/capture-auth.mjs\n" +
      "    node scripts/capture-shots.mjs\n",
  );
  process.exit(1);
}

for (const { file, kind } of entries) {
  const path = join(CAPTURES, file);
  if (!existsSync(path)) {
    problems.push(`missing   ${file}`);
    continue;
  }
  const { size } = await stat(path);
  if (size < MIN_BYTES[kind]) {
    problems.push(
      `too small ${file} (${Math.round(size / 1024)} KB — looks blank or truncated)`,
    );
  }
}

if (!existsSync(resolve(ROOT, "public/qr.png"))) {
  problems.push("missing   qr.png — run npm run qr");
}

if (!existsSync(resolve(ROOT, "public/roamly-logo.png"))) {
  problems.push("missing   roamly-logo.png — copy it from the app's public/ directory");
}

if (problems.length > 0) {
  console.error("\nPreflight failed. The render would contain placeholders.\n");
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    "\nCaptures come from scripts/capture-auth.mjs then scripts/capture-shots.mjs,\n" +
      "against a signed-in demo account. Do not hand-make substitutes.\n",
  );
  process.exit(1);
}

console.log(`Preflight OK — ${entries.length} captures present, QR and logo in place.`);

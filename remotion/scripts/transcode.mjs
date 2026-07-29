/**
 * Converts any leftover .webm in public/captures/ to the .mp4 the compositions
 * expect, using the ffmpeg that ships with Remotion's compositor package.
 *
 * capture-shots.mjs now does this automatically. This exists for clips recorded
 * before it did, and as a repair step if a transcode failed mid-run.
 *
 *   node scripts/transcode.mjs
 */

import { readdir, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "public/captures");

const ffmpegBin = (() => {
  for (const pkg of [
    "compositor-darwin-arm64",
    "compositor-darwin-x64",
    "compositor-linux-x64-gnu",
    "compositor-linux-x64-musl",
    "compositor-linux-arm64-gnu",
    "compositor-win32-x64-msvc",
  ]) {
    const candidate = resolve(ROOT, "node_modules/@remotion", pkg, "ffmpeg");
    if (existsSync(candidate)) return candidate;
  }
  return "ffmpeg";
})();

const webms = (await readdir(OUT).catch(() => [])).filter((f) => f.endsWith(".webm"));

if (webms.length === 0) {
  console.log("No .webm files in public/captures/ — nothing to transcode.");
  process.exit(0);
}

let failed = 0;
for (const webm of webms) {
  const target = webm.replace(/\.webm$/, ".mp4");
  try {
    execFileSync(
      ffmpegBin,
      [
        "-y", "-i", join(OUT, webm),
        "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
        join(OUT, target),
      ],
      { stdio: "ignore" },
    );
    await rm(join(OUT, webm), { force: true });
    const { size } = await stat(join(OUT, target));
    console.log(`  ✓ ${target}  (${Math.round(size / 1024)} KB)`);
  } catch {
    failed++;
    console.error(`  ! ${webm} — ffmpeg failed at ${ffmpegBin}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} clip(s) could not be transcoded.`);
  process.exit(1);
}
console.log(`\nTranscoded ${webms.length} clip(s). Re-run: npm run contact-sheet`);

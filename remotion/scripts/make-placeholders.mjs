/**
 * Generates stand-in captures so `npm run dev` is usable before the capture
 * session happens. Composition, timing, and typography can all be worked on
 * against these; nothing about the real footage can.
 *
 * Every placeholder is a diagonally striped card that could not be mistaken
 * for a screenshot, and the run drops a `.placeholders` marker beside them.
 * preflight.mjs treats that marker as a hard render block, so a placeholder
 * physically cannot reach an exported video — the point is to make the honest
 * path the only path, not to rely on remembering.
 *
 *   npm run placeholders        # create
 *   npm run placeholders:clean  # remove, ahead of a real capture session
 */

import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { PNG } from "pngjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = resolve(ROOT, "public/captures");
const MARKER = join(OUT, ".placeholders");

if (process.argv.includes("--clean")) {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  console.log("Placeholders removed. public/captures/ is empty and ready for real captures.");
  process.exit(0);
}

const source = await readFile(resolve(ROOT, "src/captures.ts"), "utf8");
const entries = [
  ...source.matchAll(/file:\s*"([^"]+)",\s*\n\s*kind:\s*"(image|video)"/g),
].map((m) => ({ file: m[1], kind: m[2] }));

await mkdir(OUT, { recursive: true });

/**
 * Remotion ships its own ffmpeg with the platform compositor package, so the
 * video placeholders work without a system install. It is a slim build with no
 * SVG decoder, which is why the cards are rasterised here rather than drawn as
 * vectors.
 */
const ffmpegBin = (() => {
  for (const pkg of [
    "compositor-linux-x64-gnu",
    "compositor-linux-x64-musl",
    "compositor-linux-arm64-gnu",
    "compositor-darwin-arm64",
    "compositor-darwin-x64",
    "compositor-win32-x64-msvc",
  ]) {
    const candidate = resolve(ROOT, "node_modules/@remotion", pkg, "ffmpeg");
    if (existsSync(candidate)) return candidate;
  }
  return "ffmpeg";
})();

const W = 1920;
const H = 1080;

/**
 * A coral-on-cream diagonal hazard stripe with a dashed border. Deliberately
 * ugly: if one of these ever shows up in a review copy, it is unmistakable.
 */
const stripedCard = (seedIndex) => {
  const png = new PNG({ width: W, height: H });
  const paper = [231, 222, 210];
  const coral = [196, 122, 91];
  const ink = [74, 58, 46];

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (W * y + x) << 2;
      // 64px diagonal bands, offset per shot so consecutive placeholders in a
      // montage are visibly different frames rather than one static image.
      const band = Math.floor((x + y + seedIndex * 24) / 64) % 2 === 0;
      const border = x < 26 || x > W - 27 || y < 26 || y > H - 27;
      const c = border ? ink : band ? paper : coral;
      png.data[i] = c[0];
      png.data[i + 1] = c[1];
      png.data[i + 2] = c[2];
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
};

let madeVideo = 0;
for (const [index, e] of entries.entries()) {
  const target = join(OUT, e.file);

  if (e.kind === "image") {
    await writeFile(target, stripedCard(index));
    continue;
  }

  // Videos: hold the card for the clip's nominal length so scene timing
  // behaves the same as it will with real footage.
  const still = join(OUT, `.${e.file}.png`);
  await writeFile(still, stripedCard(index));
  try {
    execFileSync(
      ffmpegBin,
      [
        "-y", "-loop", "1", "-i", still,
        "-t", "12", "-r", "30",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        target,
      ],
      { stdio: "ignore" },
    );
    madeVideo++;
  } catch {
    console.error(`  could not encode ${e.file} — ffmpeg unavailable at ${ffmpegBin}`);
  }
  await rm(still, { force: true });
}

await writeFile(
  MARKER,
  "These captures are generated placeholders, not real screen recordings.\n" +
    "preflight.mjs blocks rendering while this file exists.\n" +
    "Remove with: npm run placeholders:clean\n",
  "utf8",
);

console.log(
  `Wrote ${entries.length} placeholders (${madeVideo} clips) to public/captures/, ` +
    `plus the .placeholders marker.`,
);
console.log("Rendering stays blocked until real captures replace them.");

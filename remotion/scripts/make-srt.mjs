/**
 * Writes out/captions.srt from src/captions.ts.
 *
 * The burned-in open captions and this file are generated from the same array,
 * so a caption can never appear on screen without a matching subtitle cue.
 *
 * This also enforces the brief's rule that every caption holds for at least two
 * seconds — a rule that is easy to state and easy to violate by nudging a
 * delay, so it is asserted here rather than eyeballed.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../out/captions.srt");

// captions.ts is TypeScript; rather than pull in a transpiler for one array,
// the cue list is parsed out of it with a narrow regex. If the shape of
// captions.ts changes, this fails loudly instead of silently emitting nothing.
const { readFile } = await import("node:fs/promises");
const source = await readFile(resolve(HERE, "../src/captions.ts"), "utf8");

const cues = [];
const entry = /\{\s*scene:\s*"([^"]+)",\s*start:\s*([\d.]+),\s*end:\s*([\d.]+),\s*lines:\s*\[([^\]]*)\](?:,\s*sub:\s*"([^"]*)")?/g;
let m;
while ((m = entry.exec(source)) !== null) {
  const lines = [...m[4].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) =>
    x[1].replace(/\\"/g, '"').replace(/\\'/g, "'"),
  );
  cues.push({
    scene: m[1],
    start: Number(m[2]),
    end: Number(m[3]),
    lines,
    sub: m[5],
  });
}

if (cues.length === 0) {
  console.error("Parsed zero cues from src/captions.ts — the file's shape changed.");
  process.exit(1);
}

const tooShort = cues.filter((c) => c.end - c.start < 2);
if (tooShort.length > 0) {
  console.error("These captions hold for less than the required 2 seconds:");
  for (const c of tooShort) {
    console.error(`  [${c.scene}] ${(c.end - c.start).toFixed(2)}s — "${c.lines[0]}"`);
  }
  process.exit(1);
}

const stamp = (s) => {
  const ms = Math.round((s % 1) * 1000);
  const total = Math.floor(s);
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss},${String(ms).padStart(3, "0")}`;
};

const srt = cues
  .map((c, i) => {
    const text = [...c.lines, ...(c.sub ? [c.sub] : [])].join("\n");
    return `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${text}\n`;
  })
  .join("\n");

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, srt, "utf8");
console.log(`Wrote ${cues.length} cues to out/captions.srt`);

// Rebuild the bundled focus-music library from incompetech.com.
//
// Replaces the old shell-in-YAML fetcher, which hardcoded a track list, tried
// freepd.com first (permanently closed in 2025), and committed the source files
// untouched — that is how the catalog ended up at ~500MB with a single 82MB
// track. This version:
//
//   * reads incompetech's own catalog (pieces.json) and picks tracks per channel
//     by genre / feel / instrumentation / tempo, so the music actually matches
//     the station it lands on;
//   * hard-excludes anything startling (Dark, Eerie, Intense…) — a focus timer
//     must never make you look up — and any title that would read badly in the
//     "now playing" line;
//   * re-encodes to VBR ~112kbps at -16 LUFS, so files are a third of the size
//     and the shuffle doesn't jump in volume between tracks;
//   * regenerates public/audio/lofi/manifest.json (the offline fallback) and
//     writes supabase-seed.sql for registering the results in music_tracks.
//
// Usage: node scripts/fetch-music.mjs [tracksPerChannel]
// Requires: ffmpeg + ffprobe on PATH.

import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, statSync, unlinkSync, existsSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const AUDIO = path.join(ROOT, "public/audio");
const MANIFEST = path.join(AUDIO, "lofi/manifest.json"); // legacy path, still what focusSounds fetches
const CATALOG = "https://incompetech.com/music/royalty-free/pieces.json";
const MP3_BASE = "https://incompetech.com/music/royalty-free/mp3-royaltyfree";
const PER_CHANNEL = Number(process.argv[2] || 16);
const CONCURRENCY = 4;

const GENRE = {
  2: "African", 3: "Blues", 4: "Classical", 5: "Contemporary", 6: "Disco", 7: "Electronica",
  8: "Funk", 9: "Holiday", 10: "Horror", 11: "Jazz", 12: "Latin", 13: "Modern", 14: "Musical",
  15: "Polka", 16: "Pop", 18: "Reggae", 19: "Rock", 20: "Silent Film Score", 21: "Ska",
  22: "Soundtrack", 23: "Stings", 24: "Unclassifiable", 25: "World", 26: "Urban",
};

const BANNED_FEEL = ["Eerie", "Unnerving", "Suspenseful", "Aggressive", "Action", "Intense", "Horror", "Dark"];
const BANNED_GENRE = ["Horror", "Stings", "Holiday", "Polka", "Musical", "Disco", "Ska"];
const BANNED_TITLE = /ghost|apocalypse|death|dead|funeral|grave|blood|war|battle|demon|devil|hell|zombie|creepy|nightmare|sad|depress|anxiet|wounded|grief|amazing grace|christmas|santa|halloween|tyrant|brady|opium|dark waltz/i;

const norm = (s) => String(s || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
const listOf = (s) => norm(s).split(",").map((x) => x.trim()).filter(Boolean);
const secs = (s) => { const [h, m, x] = String(s || "0:0:0").split(":").map(Number); return (h || 0) * 3600 + (m || 0) * 60 + (x || 0); };
const slug = (t) => t.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const has = (set, ...n) => n.some((x) => set.has(x.toLowerCase()));
const anyInst = (r, ...n) => n.some((x) => [...r.instSet].some((i) => i.includes(x.toLowerCase())));

// Gate = must match; score = ranking within the matches. Kept declarative so a
// channel's taste can be adjusted without touching the fetch/encode machinery.
const CHANNELS = {
  melody: {
    gate: (r) => has(r.feelSet, "Relaxed", "Calming", "Calm", "Bright") && r.bpm > 0 && r.bpm <= 110
      && anyInst(r, "piano", "guitar", "strings", "marimba", "flute", "celesta", "harp", "glock", "violin", "cello"),
    score: (r) => (has(r.feelSet, "Calming", "Calm") ? 3 : 0) + (has(r.feelSet, "Relaxed") ? 2 : 0)
      + (anyInst(r, "marimba", "celesta", "glock", "harp") ? 2 : 0)
      + (["Classical", "Contemporary", "Modern", "Soundtrack"].includes(r.genre) ? 1 : 0) - (has(r.feelSet, "Somber") ? 3 : 0),
  },
  lofi: {
    gate: (r) => ["Jazz", "Blues", "Latin"].includes(r.genre) && r.bpm > 0 && r.bpm <= 130
      && has(r.feelSet, "Relaxed", "Grooving", "Bright", "Bouncy"),
    score: (r) => (r.genre === "Jazz" ? 3 : 0) + (has(r.feelSet, "Relaxed") ? 3 : 0)
      + (anyInst(r, "ep", "electric piano", "trumpet", "sax", "clarinet", "vibra") ? 2 : 0)
      + (r.bpm >= 80 && r.bpm <= 120 ? 1 : 0),
  },
  calm: {
    gate: (r) => has(r.feelSet, "Calming", "Calm") && (r.bpm === 0 || r.bpm <= 100)
      && !has(r.feelSet, "Grooving", "Humorous", "Bouncy") && !anyInst(r, "kit", "drum"),
    score: (r) => (has(r.feelSet, "Calm") ? 3 : 0) + (has(r.feelSet, "Calming") ? 2 : 0)
      + (r.seconds >= 180 ? 2 : 0) + (anyInst(r, "synth", "pad", "strings", "piano", "choir") ? 1 : 0)
      - (has(r.feelSet, "Somber") ? 1 : 0),
  },
  beats: {
    gate: (r) => has(r.feelSet, "Grooving", "Bouncy") && r.bpm >= 60 && r.bpm <= 105
      && anyInst(r, "kit", "drums", "percussion", "bass"),
    score: (r) => (has(r.feelSet, "Relaxed") ? 3 : 0) + (has(r.feelSet, "Grooving") ? 2 : 0)
      + (anyInst(r, "ep", "electric piano", "rhodes") ? 2 : 0)
      + (["Urban", "Funk", "Electronica", "Blues", "Jazz"].includes(r.genre) ? 2 : 0),
  },
  piano: {
    gate: (r) => anyInst(r, "piano") && r.instSet.size <= 3 && !anyInst(r, "kit", "drums")
      && has(r.feelSet, "Relaxed", "Calming", "Calm", "Somber", "Bright"),
    score: (r) => (r.instSet.size === 1 ? 4 : r.instSet.size === 2 ? 2 : 0)
      + (has(r.feelSet, "Calming", "Calm") ? 3 : 0) + (has(r.feelSet, "Relaxed") ? 2 : 0)
      + (r.bpm > 0 && r.bpm <= 100 ? 1 : 0),
  },
  ambient: {
    // No kit or hand-drum groove: a pulse to follow is the opposite of a
    // soundscape you stop noticing.
    gate: (r) => has(r.feelSet, "Calming", "Calm", "Mystical") && (r.bpm === 0 || r.bpm <= 90)
      && r.seconds >= 150 && !anyInst(r, "kit", "drum") && !has(r.feelSet, "Epic", "Grooving", "Bouncy"),
    score: (r) => (anyInst(r, "synth", "pad", "drone") ? 4 : 0) + (has(r.feelSet, "Calming", "Calm") ? 3 : 0)
      + (r.seconds >= 240 ? 2 : 0) - (has(r.feelSet, "Mysterious") ? 1 : 0),
  },
  rain: {
    // Piano only — the rainfall is generated live and layered underneath by
    // focusSounds (see BED), so these have to sit under it without competing.
    gate: (r) => anyInst(r, "piano") && r.instSet.size <= 4 && (r.bpm === 0 || r.bpm <= 95)
      && has(r.feelSet, "Relaxed", "Calming", "Calm", "Somber") && !anyInst(r, "kit", "drums", "trumpet", "brass"),
    score: (r) => (has(r.feelSet, "Calming", "Calm") ? 3 : 0) + (has(r.feelSet, "Somber") ? 2 : 0)
      + (has(r.feelSet, "Relaxed") ? 1 : 0) + (r.instSet.size <= 2 ? 2 : 0) + (r.seconds >= 180 ? 1 : 0)
      - (has(r.feelSet, "Bouncy", "Grooving") ? 3 : 0),
  },
};

// Alternate cuts of one piece ("… for Two Harps" / "… (clean)") are the same
// music to a listener; collapse them or the shuffle replays the same tune.
const family = (t) => t.toLowerCase().replace(/\(.*?\)/g, "")
  .replace(/\b(clean|instrumental|remix|mix|edit|version|reprise|alternate|loop(ing)?)\b/g, "")
  .replace(/\bfor (two |the )?[a-z ]+$/g, "").replace(/[^a-z0-9]+/g, " ").trim();

async function main() {
  console.log("fetching catalog…");
  const res = await fetch(CATALOG, { headers: { "user-agent": "roamly-music-fetch" } });
  if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
  const pieces = await res.json();

  const rows = pieces.map((p) => {
    const inst = listOf(p.instruments);
    return {
      title: norm(p.title), filename: norm(p.filename), seconds: secs(p.length),
      bpm: Number(p.bpm) || 0, genre: GENRE[Number(p.genre)] || "?",
      feelSet: new Set(listOf(p.feel).map((f) => f.toLowerCase())),
      instSet: new Set(inst.map((f) => f.toLowerCase())),
    };
  }).filter((r) => r.title && r.filename && !BANNED_GENRE.includes(r.genre) && !BANNED_TITLE.test(r.title)
    && !BANNED_FEEL.some((b) => r.feelSet.has(b.toLowerCase())) && r.seconds >= 90 && r.seconds <= 600);

  const picks = [];
  const seenFamily = new Set();
  for (const [channel, cfg] of Object.entries(CHANNELS)) {
    const ranked = rows.filter(cfg.gate).map((r) => ({ ...r, s: cfg.score(r) }))
      .sort((a, b) => b.s - a.s || b.seconds - a.seconds);
    let taken = 0;
    for (const r of ranked) {
      if (taken >= PER_CHANNEL) break;
      const fam = family(r.title);
      if (seenFamily.has(fam)) continue;
      seenFamily.add(fam);
      picks.push({ ...r, channel });
      taken++;
    }
    console.log(`  ${channel}: ${taken} of ${ranked.length} candidates`);
  }

  for (const ch of Object.keys(CHANNELS)) mkdirSync(path.join(AUDIO, ch), { recursive: true });

  const done = [];
  const failed = [];
  const queue = [...picks];
  let n = 0;

  const one = async (p) => {
    const out = path.join(AUDIO, p.channel, `${slug(p.title)}.mp3`);
    const tmp = path.join(os.tmpdir(), `roamly-${slug(p.title)}-${process.pid}.mp3`);
    try {
      const r = await fetch(`${MP3_BASE}/${encodeURIComponent(p.filename)}`, { headers: { "user-agent": "roamly-music-fetch" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 200000) throw new Error(`too small (${buf.length}b)`);
      writeFileSync(tmp, buf);
      await run("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-i", tmp,
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-c:a", "libmp3lame", "-q:a", "6", "-ar", "44100", "-ac", "2",
        "-map_metadata", "-1", "-metadata", `title=${p.title}`, "-metadata", "artist=Kevin MacLeod",
        out], { maxBuffer: 1 << 20 });
      const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]);
      done.push({ channel: p.channel, title: p.title, url: `/audio/${p.channel}/${slug(p.title)}.mp3`,
        seconds: Math.round(parseFloat(stdout)), bytes: statSync(out).size });
    } catch (e) {
      failed.push(`${p.title}: ${e.message}`);
    } finally {
      try { unlinkSync(tmp); } catch { /* never written */ }
      if (++n % 10 === 0) console.log(`  …${n}/${picks.length}`);
    }
  };

  console.log(`\ndownloading ${picks.length} tracks…`);
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await one(queue.shift()); }));

  // A run that mostly failed must not be allowed to truncate the catalog.
  if (done.length < picks.length * 0.8) {
    throw new Error(`only ${done.length}/${picks.length} succeeded — refusing to rewrite the manifest`);
  }

  // Preserve any manifest entry whose file is still on disk and wasn't just
  // re-fetched, so hand-added tracks survive a refresh.
  const previous = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : [];
  const fresh = new Set(done.map((d) => d.url));
  const kept = previous.filter((r) => !fresh.has(r.file) && existsSync(path.join(ROOT, "public", r.file)));

  const manifest = [
    ...kept,
    ...done.map((d) => ({ file: d.url, title: d.title, artist: "Kevin MacLeod", license: "CC BY 4.0", category: d.channel })),
  ];
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");

  const esc = (s) => String(s).replace(/'/g, "''");
  writeFileSync(path.join(ROOT, "supabase-seed.sql"),
    "insert into public.music_tracks (channel, title, artist, url, license, source, duration_seconds) values\n  "
    + done.map((d) => `('${esc(d.channel)}','${esc(d.title)}','Kevin MacLeod','${esc(d.url)}','CC BY 4.0','bundled',${d.seconds})`).join(",\n  ")
    + "\non conflict (channel, url) do nothing;\n");

  const mb = done.reduce((a, d) => a + d.bytes, 0) / 1048576;
  const min = done.reduce((a, d) => a + d.seconds, 0) / 60;
  console.log(`\n${done.length} ok, ${failed.length} failed — ${min.toFixed(0)} min, ${mb.toFixed(0)} MB`);
  console.log(`manifest: ${manifest.length} entries (${kept.length} preserved)`);
  console.log("wrote supabase-seed.sql — apply it to register these in music_tracks");
  if (failed.length) console.log("failed:\n  " + failed.join("\n  "));
}

main().catch((e) => { console.error(e.message); process.exit(1); });

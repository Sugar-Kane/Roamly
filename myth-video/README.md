# Before Olympus: film

A 1 min 46 s narrated film of the Greek creation myth, from Chaos to the birth of Zeus. It is the
video companion to the `/origins` story page.

| File | What |
|---|---|
| `before-olympus.mp4` | 1920×1080, 30 fps, H.264 High, AAC 48 kHz, −14 LUFS (delivered separately, not in git) |
| `src/` | The film: `index.html` + `film.js` + local fonts. Pure canvas JS, no libraries |
| `tools/vo-lines.json` | The narration, one entry per line |
| `audio/vo/` | Narration, one WAV per line (xAI TTS, voice `leo`) |
| `tools/` | Render and audio pipeline |

## Look
Styled after Attic vase painting:
- terracotta clay and black glaze
- figures in silhouette with incised cream detail
- Greek-key (meander) bands framing every frame, like the neck and foot of a vase
- display lettering with Greek letterforms (`A → Λ`, `E → Σ`)
- each figure's name also shown in Greek (ΧΑΟΣ, ΓΑΙΑ, ΟΥΡΑΝΟΣ, ΚΡΟΝΟΣ, ΖΕΥΣ, ΟΛΥΜΠΟΣ)

Fonts: Cinzel, Cormorant Garamond and GFS Didot, all under the SIL Open Font License.

## Preview
```bash
cd myth-video
npm install                 # tone (score) + playwright (rendering)
npm run preview             # → http://127.0.0.1:8123/src/index.html  (add ?t=60 to jump)
```

## How it's built
- **Deterministic timeline.** `window.renderAt(seconds)` draws each frame from `t` alone, using seeded
  noise and no timers, so any frame can be rendered on its own and renders the same every time.
- **Timed to the voice.** Each narration line starts at a fixed cue. Key moments (a name card
  appearing, the sickle stroke, the thunderbolt) are anchored to the estimated time the word is
  spoken inside the measured speech span of its line.
- **Score.** `tools/music.html` is an original Tone.js score rendered offline. It is in D minor with
  Phrygian colour for the dark acts and turns to D major when Zeus opens his eyes. Sound effects
  (drums, the slash, thunder, rumbles) come from the film's own cue sheet (`window.FILM.cues`).
- **Mix.** `tools/build-audio.py` places the narration, adds a little hall and ducks the music under
  speech. `tools/master-audio.sh` then masters the mix to −14 LUFS with true peak below −1 dBTP.
- **Render.** `tools/render-frames.mjs` steps `t = frame / 30`, captures lossless PNGs over CDP and
  pipes them to ffmpeg/libx264. Nothing is screen-recorded.

## Full rebuild
```bash
python3 tools/gen-vo.py                  # needs XAI_API_KEY in env; normalise headers afterwards (see below)
node tools/render-music.mjs              # score + audio/cues.json
python3 tools/build-audio.py && tools/master-audio.sh
node tools/render-frames.mjs 4           # → before-olympus.mp4
node tools/stills.mjs out/ 10 25 61 90   # review stills at chosen times
```
The TTS returns streamed WAVs with a placeholder length. Re-write their headers before mixing with
`ffmpeg -i in.wav -c:a pcm_s16le out.wav`. If you regenerate a line, update its measured speech span
in the `VO` table in `src/film.js`.

Requires Node 18+, Python 3 with numpy and imageio-ffmpeg, and Chromium (`CHROMIUM=/path` to override).

# Roamly Flow — 30 s Focus-tab promo (Remotion)

| | |
|---|---|
| Output | `out/roamlyflow-focus-30s-final.mp4`: 1920×1080, 30 fps, H.264 + AAC, mastered to −14 LUFS / −1 dBTP (not in git) |
| Composition | `src/FocusPromo.tsx` (`FocusPromo`, 900 frames). All timings live in `src/timeline.ts` |
| Screens | `public/shots/*.png`: real app screens at 2×, captured from the unchanged production `App` by `../focus-harness/` |
| Clip | `public/clips/focus-mode.mp4`: 5 s of focus mode (pets and garden animating), captured frame by frame |
| Voice | `public/vo/f01…f09.wav`: xAI TTS, voice `eve` (same voice as the 60 s promo) |
| Music | `public/music.mp3`: original instrumental generated with Suno for this spot |
| SFX | `public/sfx/*.wav`: synthesized by `tools/make-sfx.py` (no samples) |

## Beats
| Time | Feature | VO |
|---|---|---|
| 0.0–5.0 | Exam schedule: pick PANCE from the list, add a custom "Pharm final", live day countdowns | "Your exam has a date. Add it, or create your own, and watch the countdown." |
| 5.0–8.0 | Timer methods: Classic 25/5, then the Count-up stopwatch | "Pick a classic timer, or count up instead." |
| 8.0–11.7 | Start → Focus mode | "Hit start, and focus mode clears everything but your task." |
| 11.7–16.2 | Pets and garden in focus mode, then Customize Session switches them off | "Your pets and garden keep you company. Or switch them off in settings." |
| 16.2–19.7 | Music: built-in focus sounds, Spotify presets, Apple Music presets | "Play our study channels, or connect Spotify and Apple Music." |
| 19.7–22.9 | PC: Pop out timer floating over lecture notes | "On your computer, pop the timer out over your notes." |
| 22.9–25.3 | The 8 color themes | "And make it yours with color themes." |
| 25.3–30.0 | End card: logo, "Study with flow.", roamlyflow.com | "Roamly Flow. Study with flow." |

## Build
```bash
cd promo-output/focus-30s
npm install
python3 tools/gen-vo.py && tools/prep-vo.sh   # needs XAI_API_KEY in env (only to regenerate the voice)
python3 tools/make-sfx.py
npm run render                                # Remotion → out/roamlyflow-focus-30s.mp4
tools/master.sh                               # loudness master → out/roamlyflow-focus-30s-final.mp4
npm run studio                                # optional: scrub it in Remotion Studio
```
Rendering uses Playwright's `chromium_headless_shell` (path in `package.json`); point `--browser-executable` elsewhere if needed.

## Re-capturing the screens
Sign-in on production is protected by Cloudflare Turnstile, so the screens come from `../focus-harness/`: the real
`src/main.tsx` + `App` with only `supabaseClient` swapped for an in-memory stand-in holding a sample Premium account
(exams, three tasks, dog + cat, a five-plant garden). Every screen, label and control is the production UI.
```bash
npx vite --config promo-output/focus-harness/vite.config.ts      # from the repo root (port 5191)
cd promo-output/focus-harness
node cap-exams.mjs; node cap-timer.mjs; node cap-countup.mjs; node cap-focus.mjs; node cap-focus2.mjs; node cap-music.mjs
# then copy the used shots into ../focus-30s/public/shots and encode frames/focus → public/clips/focus-mode.mp4
```
Two harness-only stand-ins, both disclosed here: headless Chromium has no Document Picture-in-Picture, so the pop-out
is opened as a popup and its DOM is photographed in a 180×203 page; and the Spotify/Apple mini-player iframe (blocked
offline) is hidden in the music captures. The lecture-notes window in the pop-out scene is a prop, not app UI.

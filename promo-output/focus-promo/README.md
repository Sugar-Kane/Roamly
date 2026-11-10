# Roamly Flow — Focus-tab promo (Remotion, 50 s)

| | |
|---|---|
| Output | `out/roamlyflow-focus-promo-final.mp4`: 1920×1080, 30 fps, 50 s, H.264 + AAC, mastered to −14 LUFS / −1 dBTP (not in git) |
| Composition | `src/FocusPromo.tsx` (`FocusPromo`, 1500 frames). Scene times are `T` in that file; VO and SFX times are in `src/timeline.ts` |
| Screens | `public/shots/*.png`: real app screens at 2×, captured from the unchanged production `App` by `../focus-harness/` |
| Clip | `public/clips/focus-mode.mp4`: 10 s of focus mode (pets and garden animating), captured frame by frame |
| Voice | `public/vo/*.wav`: xAI TTS, voice `eve` (same voice as the 60 s promo) |
| Music | `public/music.mp3`: original instrumental generated with Suno for this spot |
| SFX | `public/sfx/*.wav`: synthesized by `tools/make-sfx.py` (no samples) |

## Beats
| Time | Picture | VO |
|---|---|---|
| 0.0–2.2 | Hook | "Your exam has a date." |
| 2.2–6.0 | Intro: logo draws, "Roamly Flow", "The Pomodoro method built for PA school." | "Meet Roamly Flow, the focus timer built for PA school." |
| 6.0–12.0 | Exam schedule: PANCE from the list, a custom "Pharm final", live day countdowns | "Add it, or create your own, and watch the countdown." |
| 12.0–17.0 | Timer methods: Classic 25/5, then the Count-up stopwatch | "Pick a classic timer, or count up instead." |
| 17.0–23.0 | Start → Focus mode | "Hit start, and focus mode clears everything but your task." |
| 23.0–29.4 | Pets and garden in focus mode; Customize Session switches them off | "Your pets and garden keep you company. Or switch them off in settings." |
| 29.4–35.0 | Music: built-in focus sounds, Spotify presets, Apple Music presets | "Play our study channels, or connect Spotify and Apple Music." |
| 35.0–40.5 | PC: Pop out timer floating over lecture notes | "On your computer, pop the timer out over your notes." |
| 40.5–44.4 | The 8 color themes | "And make it yours with color themes." |
| 44.4–50.0 | End card: logo, "Study with flow.", roamlyflow.com | "Roamly Flow. Study with flow. Start free at roamlyflow.com." |

## Build
```bash
cd promo-output/focus-promo
npm install
python3 tools/gen-vo.py && tools/prep-vo.sh   # needs XAI_API_KEY in env (only to regenerate the voice)
python3 tools/make-sfx.py
npm run render                                # Remotion → out/roamlyflow-focus-promo.mp4
tools/master.sh                               # loudness master → out/roamlyflow-focus-promo-final.mp4
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
# then copy the used shots into ../focus-promo/public/shots and encode frames/focus → public/clips/focus-mode.mp4
```
Two harness-only stand-ins, both disclosed here: headless Chromium has no Document Picture-in-Picture, so the pop-out
is opened as a popup and its DOM is photographed in a 180×203 page; and the Spotify/Apple mini-player iframe (blocked
offline) is hidden in the music captures. The lecture-notes window in the pop-out scene is a prop, not app UI.

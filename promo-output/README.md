# Roamly Flow — 60 s promo

| File | What |
|---|---|
| `roamlyflow-promo-vertical.mp4` | 1080×1920, 60 fps, H.264 High, AAC 48 kHz (delivered separately; not in git) |
| `roamlyflow-promo-wide.mp4` | 1920×1080, 60 fps, recomposed layout (delivered separately; not in git) |
| `src/` | The animation: `index.html` + `promo.js` + `styles.css` + local fonts. Pure JS, no libraries |
| `voiceover-script.md` | Final VO lines with timestamps |
| `storyboard.md` | Shot list and timings |
| `review-notes.md` | Review passes, success-test answers, measured loudness |
| `ref/` | Production research: 2× screenshots of every state + `product-notes.md` |
| `voice-samples/` | The 5 xAI voice auditions (the client picked `eve`) |
| `audio/vo/` | Final VO, one file per line |
| `tools/` | Render + audio pipeline |
| `room-harness/` | Renders the production Rooms and AI-upload components offline, with sample data, to capture their screens |

## Run it locally
```bash
cd promo-output
npm install                      # tone (music) + playwright (rendering)
npm run preview                  # → http://127.0.0.1:8123/src/index.html?format=vertical  (or ?format=wide)
```
The preview has a scrubber and plays `audio/mix.wav` once it has been built. Add `&t=25` to jump to a time.

## How it's built
- **Deterministic timeline.** `window.renderAt(seconds)` sets every element from `t` alone: keyframe
  tracks with custom easing, seeded noise for hand-drawn wobble, and no timers or rAF state.
- **Real UI.** Every Roamly Flow screen is rebuilt in HTML/CSS from the production DOM tokens
  (Fraunces / Inter / IBM Plex Mono, `:root` colours) and screenshots in `ref/`, with copy taken verbatim.
- **Rendering.** `tools/render-frames.mjs` steps `t = frame / 60`, captures each frame with CDP
  (lossless PNG), and pipes the frames to ffmpeg/libx264. Nothing is screen-recorded.
- **Audio.** `tools/music.html` holds the original score in Tone.js, rendered offline
  (`tools/render-music.mjs`). `tools/build-audio.py` synthesizes every SFX from the cue sheet the animation
  exports (`tools/dump-cues.mjs`), places the VO lines and ducks the music. `tools/master-audio.sh` does
  two-pass loudnorm to −14 LUFS.
- **VO.** `tools/gen-vo.py` (xAI TTS, voice `eve`) reads `XAI_API_KEY` from the environment only.

## Full rebuild
```bash
python3 tools/gen-vo.py            # needs XAI_API_KEY in env
node tools/render-music.mjs
node tools/dump-cues.mjs && python3 tools/build-audio.py && tools/master-audio.sh
node tools/render-frames.mjs vertical 3 && node tools/render-frames.mjs wide 3
tools/video-sheet.sh roamlyflow-promo-vertical.mp4 vertical review/sheet-vertical-final.jpg
```
Requires Node 18+, Python 3 with numpy/pillow/imageio-ffmpeg, and Chromium (`CHROMIUM=/path` to override).

## Room + AI-upload screens (account-only features)
Sign-in is protected by Cloudflare Turnstile, so the in-room UI is captured from the app's own component:
```bash
npx vite --config promo-output/room-harness/vite.config.ts     # from the repo root
node promo-output/room-harness/capture.mjs                     # → promo-output/ref/31-room-*.png
node promo-output/room-harness/capture-upload.mjs              # → promo-output/ref/40–42-upload-*.png
```

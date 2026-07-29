# RoamlyFlow promo video

A 60-second Remotion project marketing Roamly Flow to PA students, in two cuts:
`RoamlyPromo` (1920x1080) and `RoamlyPromoVertical` (1080x1920, for Instagram
and TikTok). Both compositions share one timeline and one set of scene
components — each scene reads `useVideoConfig()` and lays itself out for the
aspect ratio it finds.

```bash
npm install
npm run placeholders   # stand-in captures, so the Studio works before the shoot
npm run dev            # Remotion Studio
```

## The rule this project is built around

**Every frame of product footage must come from a signed-in account with real
data.** Logged-out screens, empty states, and zeroed stats are disqualifying,
and so is faking data by editing the DOM or mocking the API.

That rule is enforced mechanically rather than by memory:

- `scripts/capture-shots.mjs` aborts if a "Sign in" button is visible on any
  page it is about to capture, or if a view has fewer items than a seeded
  account would.
- `scripts/make-placeholders.mjs` drops a `.placeholders` marker beside the
  stand-in cards.
- `scripts/preflight.mjs` refuses to render while that marker exists, or while
  any capture is missing or suspiciously small. It runs before every render.

So the honest path is the only path that produces an `.mp4`.

## Capture pipeline

Run this before any render. It needs a demo account whose data you are happy to
publish — these captures become public marketing material, so prefer an account
created for the purpose over a personal one, and check the contact sheet for any
name, email, or avatar that should be blurred.

> **Run this on your own machine, not in a Claude Code web session.** Those
> containers apply a network egress allowlist that does not include
> `roamlyflow.com`, its Vercel previews, or `supabase.co`, so the browser
> cannot reach the app or its database. Everything else in this project — the
> Studio, placeholder development, rendering — works fine there.

```bash
cd remotion
npm install
npx playwright install chromium   # once, if you have never run Playwright here
```

### 1. Seed the account

Sign in as the demo user and make sure all of the following are populated. If
any are empty, seed them and re-check — do not work around an empty view.

- 6–10 tasks tagged by subject, a couple completed. The run starts with a
  seed check against `/tasks`; note that the home view caps its "Up next" list
  at three rows, so three there is a full list, not a short one.
- at least one exam countdown a few weeks out
- a visible streak of 7+ days and a few weeks of analytics history
- at least one unlocked study companion, and some garden growth
- a study room to enter, with the shared timer already running

### 2. Save a session

**Production sits behind Cloudflare, which will not let a Playwright-driven
browser near the sign-in form — headed or not, real Chrome or bundled
Chromium.** Do not fight it. Sign in with your ordinary browser, where you are
already a trusted human, and hand the session over.

1. Sign in at the app in your normal browser and confirm you can see your tasks.
2. Open DevTools → Console on that tab and run:

   ```js
   copy(JSON.stringify(localStorage))
   ```

   `copy` is a DevTools helper — it prints `undefined` and puts the result on
   your clipboard. Chrome blocks pasting into the console until you type
   `allow pasting` once, so this snippet is deliberately short enough to type.

3. Import it:

   ```bash
   pbpaste > /tmp/roamly-session.json      # macOS; on Linux use your clipboard tool
   node scripts/import-session.mjs /tmp/roamly-session.json
   rm /tmp/roamly-session.json             # it holds a live session token
   ```

The import refuses anything without a `sb-…-auth-token` key, or with an expired
one, so a signed-out export cannot quietly become a run of logged-out captures.

Only the sign-in is defended this way — the captures themselves run fine under
Playwright once a session exists.

#### If the sign-in is not behind a bot check

Two older paths remain for deployments without Cloudflare in front:

```bash
node scripts/capture-auth.mjs                 # opens a browser, sign in by hand
ROAMLY_EMAIL=… ROAMLY_PASSWORD=… node scripts/capture-auth.mjs --auto
```

`--auto` reads credentials from the environment, never writes or prints them,
and aborts with an explanation if it detects a Turnstile widget.

`.auth/` is gitignored in both this project and the repo root. Set `ROAMLY_URL`
to point at a preview deployment instead of production.

### 3. Capture

```bash
node scripts/capture-shots.mjs          # all ten shots
node scripts/capture-shots.mjs 01 04    # just these, by number prefix
```

Desktop shots are 1920x1080 at `deviceScaleFactor: 2`; mobile shots use the
iPhone 14 device profile at 390x844. Shot 03 needs a sample lecture file —
put one at `fixtures/sample-lecture.pdf` or set `ROAMLY_SAMPLE_NOTES`, and use
material you have the right to show on camera.

Clips stay in the `.webm` Playwright records. Remotion's `OffthreadVideo`
decodes it directly, so there is no transcode step and no dependency on an
ffmpeg build being present.

### 4. Review and sign off

```bash
npm run contact-sheet   # writes out/contact-sheet.html
```

Open it and check every shot against the three questions printed beside it:
signed in, populated, and free of anyone's name, email, or avatar but the demo
account's. Blur or replace anything that fails the third.

## Rendering

```bash
npm run render            # 1920x1080 H.264, CRF 18
npm run render:vertical   # 1080x1920
npm run render:gif        # first 10s, for Slack/GroupMe
npm run render:all
```

`npm run render` regenerates the QR, runs preflight, and writes
`out/captions.srt` before it renders, so the exported video and its subtitles
cannot drift apart.

### Chromium

Remotion downloads its own headless shell on first render. If outbound access
to `remotion.media` is blocked, point it at a local browser:

```bash
npx remotion render RoamlyPromo out/roamly-promo-1080p.mp4 \
  --codec=h264 --crf=18 \
  --browser-executable=/path/to/headless_shell
```

## Post-capture adjustments

Four constants position overlays against footage that does not exist until the
shoot happens. Re-check them once the real captures land — each is a single
named constant at the top of its scene file.

| Constant | File | What it controls |
| --- | --- | --- |
| `CLOCK_ORIGIN` | `src/scenes/Timer.tsx` | Where the live countdown sits over the timer ring |
| `LIST_APPEARS_AT` | `src/scenes/Upload.tsx` | Frame at which the generated task list is on screen |
| `TASK_ROWS` | `src/scenes/Upload.tsx` | Vertical position of the three highlighted rows |
| `CHART_REGION` | `src/scenes/Progress.tsx` | The chart area the bar-growth reveal uncovers |

## Fonts

Fraunces, Inter, and IBM Plex Mono are vendored into `public/fonts/` rather
than pulled from Google at frame time. `@remotion/google-fonts` fetches every
weight and subset during the render — hundreds of requests — and a single
failure silently falls back to a system face, producing a subtly wrong video
instead of an error.

Re-vendor with `node scripts/fetch-fonts.mjs` (only latin subsets, only the
weights the scenes use).

## Audio

**No music is committed, and the compositions render silent by default.**

`Promo` takes a `withAudio` prop; setting it expects a licensed track at
`public/audio/bed.mp3`. Choosing and clearing that track is a decision with a
licence attached, so it is left to a human:

- pick a royalty-free lo-fi instrumental and record the exact track and licence
  terms in this README before enabling it
- duck to −18 dB under any voiceover
- soft tick at each caption change, no louder than −24 dB

Captions are burned in as open captions regardless, because most plays will be
muted, and `out/captions.srt` is emitted alongside every render.

A voiceover script has not been synthesised — the brief asks for approval before
generating a voice.

## Layout

```
src/
  brand.ts        Colour, gradient, and shadow tokens lifted from the app
  timing.ts       Scene boundaries — the storyboard's source of truth
  captions.ts     Every on-screen caption, shared with the .srt writer
  captures.ts     Manifest of required screen captures
  fonts.ts        Vendored @font-face installation
  components.tsx  SceneWrap, Capture, BrowserFrame, PhoneBezel, CaptionBlock, TickingClock
  Promo.tsx       Assembles the eight scenes
  Root.tsx        The two compositions
  scenes/         One file per storyboard scene
scripts/
  capture-auth.mjs      Sign in once, save storageState
  capture-shots.mjs     Produce all ten captures
  contact-sheet.mjs     Review page for sign-off
  make-placeholders.mjs Stand-ins for pre-shoot development
  preflight.mjs         Blocks rendering on placeholders or missing captures
  make-qr.mjs           Builds public/qr.png
  verify-qr.mjs         Decodes it and asserts the exact target URL
  make-srt.mjs          Writes out/captions.srt, enforcing the 2s minimum
  fetch-fonts.mjs       Vendors the brand typefaces
```

See `SHOTLIST.md` for the capture-to-scene mapping.

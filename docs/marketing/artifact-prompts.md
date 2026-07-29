# RoamlyFlow marketing artifact prompts

Three copy-paste prompts for producing marketing collateral aimed at PA
students. Each is self-contained — paste **Section 0 (shared context)** first,
then the prompt for the artifact you want.

The shared context exists because every fact in these artifacts must match what
the product actually does. Everything in Section 0 was read out of this repo
(`src/data.ts`, `src/App.tsx`, `src/petCatalog.ts`, `index.html`,
`tailwind.config.js`, `src/index.css`, `README.md`) on 2026-07-28. If the
product changes, update Section 0 before reusing these prompts.

---

## Section 0 — Shared context (paste this first, every time)

```
You are producing marketing collateral for RoamlyFlow, a study platform built
specifically for Physician Assistant (PA) students. Read this context block
carefully and treat it as the only source of truth about the product. Do not
invent features, prices, statistics, user counts, testimonials, ratings, or
outcome claims. If you need a fact that is not here, ask me instead of guessing.

PRODUCT
- Name: Roamly Flow (written "RoamlyFlow" in casual copy; the app title is
  "Roamly Flow").
- URL: https://www.roamlyflow.com
- One-line: A Pomodoro-style focus timer and study planner built for PA school.
- The core focus timer is genuinely free and works with no account.

WHAT IT DOES (accurate feature list)
1. Focus timer with PA-shaped presets. Real method names and intervals:
   - Classic 25/5 — "The original. 25 on, 5 off."
   - Sprint 15/3 — short bursts for flashcards and quick review
   - Gentle 20/10 — lower-intensity days, more recovery
   - Anatomy 45/15 — balanced blocks for systems and structures
   - Deep Work 50/10 — longer blocks for dense material like pharmacology
   - 52/17 — the productivity-study ratio
   - Clinical 90/20 — ultradian rhythm, mirrors a focused rotation block
   - PANCE Drill 60/10 — exam-pace endurance blocks (Premium)
   - Marathon 120/30 — for long library sits before an exam (Premium)
   - Custom — set your own focus, break, and cadence (Premium)
2. Task list with tags (Cardio, Pharm, Clinical, PANCE), Pomodoro estimates,
   and per-task session counts.
3. AI task generation from lecture notes. Upload a PDF, image, Word doc,
   PowerPoint, or text file and it returns a structured task list. Quota:
   3 uploads/month free, 10/month Premium, extra credits purchasable.
4. Live study rooms — a shared timer every participant sees identically,
   text chat that only opens during breaks, and (Premium) voice chat during
   breaks. Four always-on community rooms; Premium members can host up to 3.
5. Exam countdowns and planned study scheduling (planned study is Premium).
6. Streaks, XP levels, achievements, a study garden, and unlockable study
   companions (pets) earned by completing sessions — e.g. Pip the Pup and
   Mochi the Cat from the start, Sunny the Finch at 5 sessions, Professor Hoot
   at 150. Max 2 active companions.
7. Built-in focus audio: Melody, Café music, Calm music, Lo-fi beats, Piano,
   Ambient drift, Rainy piano. Spotify / Apple Music embeds supported.
8. Healthy break prompts — drink water, stand up, gentle back stretch, rest
   your eyes, slow breaths, brief walk, reset posture. Written inclusively
   ("if your space and mobility allow").
9. Analytics: focus time, block completion, subject breakdowns, achievements,
   and session post-mortems. Free tier gets 7-day basics; Premium gets full
   history and breakdowns.
10. Picture-in-picture timer that floats over other windows, plus eight visual
    themes (Coffee Shop, White Coat, Library Night, Night Shift, Deep Sea,
    Sage Calm, Sunset Study, Ocean Desk). All themes are free.
11. Friends list and notifications.

PRICING (exact — do not round, discount, or embellish)
- No account: $0. 5 tasks stored on that device, browse rooms, core timer
  methods, 7-day local analytics basics.
- Free account: $0. Unlimited synced tasks, multiple exam schedules, 3 AI note
  uploads a month, join any room, break chat, 7-day synced analytics.
- Premium: $3 monthly or $30 yearly. Adds planned study, 10 AI uploads a month,
  PANCE Drill & Marathon & Custom methods, host up to 3 rooms, voice chat in
  break windows, full analytics history with breakdowns and achievements.

BRAND
- Typefaces: Fraunces (display/headlines, serif), Inter (body/UI),
  IBM Plex Mono (timer digits, numerals, small labels).
- Palette (warm, calm, paper-like — NOT the blue-purple SaaS look):
  - Background / paper: hsl(34 38% 92%)  ≈ #F0E9E0
  - Ink / foreground:   hsl(25 30% 22%)  ≈ #4A3A2E
  - Primary brown:      hsl(24 33% 40%)  ≈ #88613F
  - Roamly purple:      hsl(24 30% 51%)  ≈ #A87B5C
  - Roamly coral:       hsl(18 45% 55%)  ≈ #C47A5B
  - Roamly blue:        hsl(157 16% 55%) ≈ #7DA396
  - Roamly green:       hsl(157 22% 45%) ≈ #5C8C7C
  - Dark theme color:   #16181D
- Signature gradients: purple→blue (primary), coral→purple (accent).
- Logo assets in this repo: public/roamly-logo.png, public/icon-512.png,
  public/favicon.svg, public/og-image.png.

VOICE
Warm, calm, specific, peer-to-peer. Never hustle-culture, never "grind harder,"
never guilt. RoamlyFlow's emotional position is *relief*, not pressure: PA
school is a firehose, and this is the thing that makes the next 25 minutes
manageable. Speak like a PA student one year ahead, not like a marketer.
Concrete beats abstract — "Pharm block at 6pm" lands, "boost productivity"
does not.

AUDIENCE — PA students
Their reality: 15+ credit didactic semesters, exams every 1–2 weeks, ~7,000
pages of material, pharmacology and cardiology as recurring pain points, PANCE
looming over the whole thing, clinical rotations that wreck any fixed schedule,
imposter syndrome, guilt about breaks, and studying alone at 11pm wondering if
everyone else has it figured out. The emotional hooks that work:
  - "You are not behind. You just need the next 25 minutes."
  - Permission to take a break without guilt.
  - Not studying alone — someone else's timer is running too.
  - Turning an overwhelming lecture into a finite list you can finish.
Hooks that do NOT work: fear-mongering about failing PANCE, productivity-bro
language, anything implying they aren't working hard enough.

HARD CONSTRAINTS (non-negotiable)
- No fabricated statistics, user counts, star ratings, or testimonials.
- No claims about exam scores, PANCE pass rates, GPA, or study outcomes.
- No medical advice and no clinical claims. Break prompts are comfort
  suggestions, not health recommendations.
- No implication of affiliation with, or endorsement by, the NCCPA, ARC-PA,
  AAPA, PAEA, or any PA program.
- Accessibility: body text never below 10pt in print; maintain at least 4.5:1
  contrast for body copy and 3:1 for large text; never use color alone to carry
  meaning.
- Every screenshot must come from a signed-in account with realistic data.
  Empty states, "Sign in to continue" prompts, and zeroed stats are
  disqualifying.
```

---

## Section 1 — Remotion promotional video

Paste Section 0, then this.

```
GOAL
Build a Remotion project that renders a 60-second promotional video for
RoamlyFlow, targeted at PA students, using real screen recordings and
screenshots captured from a SIGNED-IN account — never a logged-out or empty
state.

PART A — GET REAL, AUTHENTICATED CAPTURES FIRST

Do this before you write a single frame of animation. The video's credibility
lives entirely in whether the footage looks like a real account in use.

A1. Ask me for credentials. Say exactly what you need:
    - a RoamlyFlow account email and password (I will provide a dedicated demo
      account — do not use or store any other account), and
    - whether that account is on Premium, so you know which features will
      render unlocked.
    Do not proceed to capture until I give you the account. Do not sign up for
    a new account yourself, and do not capture logged-out screens as a
    substitute.

A2. Seed the account so it looks lived-in, then confirm with me that these are
    populated before capturing:
    - 6–10 tasks with realistic PA tags (Cardio, Pharm, Clinical, PANCE), a
      couple already completed
    - at least one exam countdown a few weeks out
    - a visible streak (7+ days) and a few weeks of analytics history
    - at least one unlocked study companion and some garden growth
    - a study room to enter with the shared timer already running
    If any of these are empty, tell me which and stop — do not fake data by
    editing the DOM or mocking the API.

A3. Capture with Playwright, authenticated via a saved storage state, at
    1920x1080, deviceScaleFactor 2, in a fresh profile with animations allowed:

    - Write scripts/capture-auth.mjs that logs in once and writes
      .auth/roamly.json via context.storageState(). Add .auth/ to .gitignore
      and never commit the file or print credentials to logs.
    - Write scripts/capture-shots.mjs that reuses that storage state and
      produces, into remotion/public/captures/:
        01-focus-timer.png       timer mid-focus-block, task list visible
        02-methods.png           method picker open showing the PA presets
        03-upload.mp4            (8–12s) the AI note upload flow: choose file →
                                 processing → generated task list appears
        04-room.mp4              (8–12s) a live study room, shared countdown
                                 ticking, participants visible
        05-analytics.png         analytics view with real weekly history
        06-garden.png            companions / garden with unlocked pets
        07-pip.mp4               (4–6s) picture-in-picture timer floating
        08-themes.mp4            (4–6s) switching between two or three themes
      Use page.video or a screencast for the .mp4 clips. Blur or replace any
      real human names, email addresses, or avatars belonging to anyone other
      than the demo account.

    - Also capture a mobile set at 390x844 (iPhone 14 viewport) for at least
      the timer and rooms views: 09-mobile-timer.png, 10-mobile-room.png.

A4. Show me contact sheets of every capture and get my sign-off before
    animating. List any shot you could not get and why.

PART B — THE VIDEO

Project setup:
  npm create video@latest  (Remotion, TypeScript, blank template)
  Composition: id "RoamlyPromo", 1920x1080, fps 30, durationInFrames 1800 (60s).
  Also export a 1080x1920 vertical composition "RoamlyPromoVertical" reusing
  the same scene components with a vertical layout — Instagram and TikTok are
  where PA students actually are.
  Load Fraunces, Inter, and IBM Plex Mono via @remotion/google-fonts.
  Put every capture in remotion/public/captures/ and reference with staticFile().

Storyboard — 8 scenes. Times are seconds; use <Series> with
<Series.Sequence> and a 12-frame cross-dissolve between scenes.

  SCENE 1 — The feeling (0:00–0:07)
    Paper-background (#F0E9E0) card. Type on in Fraunces, one line at a time,
    each fading up 6px:
      "Four exams in three weeks."
      "A pharm deck you haven't opened."
      "And it's already 9pm."
    Then all three fade back and one line remains, centered:
      "You're not behind. You just need the next 25 minutes."
    No footage yet. This scene is pure empathy — hold it.

  SCENE 2 — The timer (0:07–0:16)
    01-focus-timer.png slides up with a subtle scale-from-0.96 spring.
    Overlay an animated IBM Plex Mono countdown in the Roamly coral that
    actually ticks down (drive it from useCurrentFrame, don't fake it in the
    image). Caption, lower third, Inter semibold:
      "A focus timer built for PA school. Free. No account needed."

  SCENE 3 — The methods (0:16–0:24)
    02-methods.png. Animate callout chips popping in one at a time on the
    right, each with a 4-frame spring:
      "Sprint 15/3 — flashcards"
      "Deep Work 50/10 — pharm"
      "Anatomy 45/15 — systems"
      "Clinical 90/20 — rotation pace"
      "PANCE Drill 60/10"
    Caption: "Pick the block that matches the material."

  SCENE 4 — AI from your notes (0:24–0:34)
    Play 03-upload.mp4 in a rounded browser frame (12px radius, soft shadow).
    As the generated task list appears, highlight three task rows with a
    coral underline sweep. Caption:
      "Drop in a lecture PDF. Get a task list you can actually finish."
    Small legal-safe subcaption in muted ink: "3 free AI uploads a month."

  SCENE 5 — You're not studying alone (0:34–0:44)
    Play 04-room.mp4. Split-screen it with 10-mobile-room.png on the right in
    a phone bezel so both surfaces show the same countdown. Caption:
      "Live study rooms. One shared timer. Chat only opens on breaks."
    This is the emotional peak — let the shared countdown be legible and let
    the scene breathe. Slight slow push-in on the room footage.

  SCENE 6 — Breaks without guilt (0:44–0:50)
    Warm coral→purple gradient wash. Break prompts fade in as soft cards:
      "Drink water." / "Rest your eyes." / "Stand up, if your space allows."
    Caption: "Breaks are part of the method, not a failure of it."

  SCENE 7 — Progress you can see (0:50–0:56)
    Quick 3-beat montage, ~2s each: 05-analytics.png (animate a bar chart
    growing), 06-garden.png (pets pop in with a spring), 07-pip.mp4.
    Caption: "Streaks, analytics, and a companion that grows with your hours."

  SCENE 8 — Close (0:56–1:00)
    Paper background. Logo (public/roamly-logo.png) scales in.
    Fraunces headline: "Start your next 25 minutes."
    Inter line: "roamlyflow.com — free, no account needed."
    Static QR code to https://www.roamlyflow.com?utm_source=video in the
    lower right, ~180px, generated at build time with the `qrcode` package
    into a data URI (not fetched from a remote API at render time).

Motion rules
- Springs, not linear easing: spring({frame, fps, config:{damping:200}}) for
  entrances; interpolate with Easing.out(Easing.cubic) for opacity.
- Nothing moves faster than ~300ms. This is a calm brand; snappy reads as
  frantic.
- Never more than two moving elements at once.
- Every caption on screen for at least 2 seconds.
- Respect the palette. No blue-purple SaaS gradients, no neon, no drop shadows
  harsher than 0 8px 24px rgba(74,58,46,0.12).

Audio
- Lo-fi instrumental bed, royalty-free and license-cleared — tell me the exact
  track and license you used. Duck to -18dB under any voiceover.
- Optional VO: write the script but do not synthesize a voice without asking me.
- Include a soft tick at each caption change, no louder than -24dB.
- Burn in open captions (not just an SRT) — most of this will play muted.
  Also emit captions.srt alongside the render.

Deliverables
  1. The Remotion project, committed, with README render instructions.
  2. out/roamly-promo-1080p.mp4    (H.264, 1920x1080, ~8Mbps)
  3. out/roamly-promo-vertical.mp4 (1080x1920)
  4. out/roamly-promo.gif          (first 10s, ≤5MB, for Slack/GroupMe)
  5. captions.srt
  6. A shot list mapping every capture file to the scene that uses it.
  Render with: npx remotion render RoamlyPromo out/roamly-promo-1080p.mp4
               --codec=h264 --crf=18

Before you deliver, verify: no logged-out screen appears anywhere; no empty
state appears anywhere; every number on screen matches the pricing in Section 0;
no statistic or testimonial appears that I did not give you.
```

---

## Section 2 — 4x6 handout with QR code

Paste Section 0, then this.

```
GOAL
Design a double-sided 4x6 inch handout card for RoamlyFlow, to be handed to PA
students at tabling events, orientation, and club meetings. It has about three
seconds to land emotionally before someone decides whether to pocket it.

SPECS
- Trim 4 x 6 in. Bleed 0.125 in on all sides (document 4.25 x 6.25 in).
- Safe margin 0.25 in from trim. Nothing important outside it.
- 300 DPI, CMYK for the print PDF; also export an RGB PNG for digital sharing.
- Double-sided, portrait.
- Deliver as a print-ready PDF with crop marks, plus flat PNG previews of both
  sides at 300 DPI.

BUILD METHOD
Build it as a single self-contained HTML file with print CSS
(@page { size: 4.25in 6.25in; margin: 0 }), then render to PDF with Playwright's
page.pdf({ printBackground: true, preferCSSPageSize: true }). Embed fonts and
images as base64 data URIs so the file is portable. Generate the QR with the
`qrcode` npm package at build time — never hotlink a QR generator API, because
that link dying silently would kill the whole print run.

FRONT — emotional hook, minimal information

  Layout, top to bottom:
  - Full-bleed warm paper background (#F0E9E0) with a very soft coral→purple
    gradient bloom in the top-right corner at ~8% opacity.
  - Headline, Fraunces, ~34pt, ink (#4A3A2E), max three lines:
      "It's 9pm.
       You still have pharm.
       Start with 25 minutes."
  - Below it, Inter regular ~13pt, muted ink, two lines max:
      "A free focus timer and study planner built for PA school —
       by people who know what your week looks like."
  - A single visual: a simplified illustration of the timer ring mid-countdown
    with "24:13" in IBM Plex Mono. Do not use a photograph of a person. Do not
    use stock imagery of stethoscopes or scrubs — PA students are exhausted by
    that visual language.
  - Bottom band: logo lockup, "roamlyflow.com", and the word "Free" in coral.

  That's it. Resist adding features to the front. The front sells the feeling.

BACK — the quick information, scannable in 10 seconds

  - Small header, Fraunces ~16pt: "What you get, free:"
  - Four short bullets, Inter ~11pt, each with a simple line icon:
      • Focus timer with blocks sized for the material — 15/3 for flashcards,
        50/10 for pharm, 90/20 for rotation pace
      • Turn a lecture PDF into a finite task list (3 free a month)
      • Live study rooms — one shared timer, so you're not grinding alone
      • Streaks, analytics, and breaks that don't make you feel guilty
  - A quiet line under the bullets, Inter italic ~10pt:
      "No account needed to start. Premium is $3/month if you want more."
  - QR CODE: minimum 1 x 1 in, quiet zone of at least 4 modules, high error
    correction (level H), pure ink-on-paper contrast — dark #4A3A2E on the
    #F0E9E0 background, never a gradient QR, never light-on-dark.
    Target: https://www.roamlyflow.com?utm_source=handout&utm_medium=print
    Next to the QR, in ~10pt Inter: "Scan to start your first session"
    and the plain URL "roamlyflow.com" underneath, because a meaningful share
    of cards get scanned by a phone that fails and a person who then types.
  - Bottom-left corner: logo mark, small.

  Print-safety check before you deliver: render the QR at final size, then
  actually decode the rendered PDF's QR (use a decoding library, e.g. jsQR on a
  rasterized page) and confirm it resolves to the exact target URL. Report the
  decode result. An unverified QR is an unusable card.

CHECKS
- Body text is at least 10pt; nothing on the card is below 9pt.
- Contrast of every text/background pair is at least 4.5:1 (state the measured
  ratios).
- No text or QR within 0.25 in of the trim.
- Both sides use only the Section 0 palette and typefaces.
- Give me three headline variants for the front so I can pick, rendered as
  three separate front previews.
```

---

## Section 3 — 8.5x11 one-pager for PA school tables

Paste Section 0, then this.

```
GOAL
Design a single-sided 8.5 x 11 inch one-pager for RoamlyFlow, intended to sit
in an acrylic stand on a table in PA school common areas, student lounges, and
club fairs. Unlike the 4x6, this one gets read standing up for 30–60 seconds,
so it can carry real detail — but it still has to earn the first five seconds
emotionally.

SPECS
- Trim 8.5 x 11 in, bleed 0.125 in (document 8.75 x 11.25 in).
- Safe margin 0.5 in. 300 DPI. CMYK print PDF + RGB PNG preview.
- Single-sided, portrait. Designed to be legible from about three feet away for
  the headline, and at arm's length for the body.
- Same build method as the 4x6: self-contained HTML + print CSS → Playwright
  page.pdf, fonts and images embedded, QR generated at build time and decode-
  verified before delivery.

STRUCTURE — five zones, top to bottom

  ZONE 1 — Headline (top ~2.5 in). This is what gets read from three feet.
    Fraunces, ~46pt, ink, two lines:
      "PA school is a firehose.
       This is the cup."
    Subhead, Inter regular ~15pt, muted ink, one line:
      "A free focus timer and study planner made for PA students."
    Right side of this zone: the timer ring illustration, mid-countdown.

  ZONE 2 — The empathy block (~1.5 in). A tinted panel in the palest coral,
    with a thin left rule in coral. Fraunces italic ~15pt:
      "You've reread the same slide four times. You feel guilty taking a
       break. You're studying alone at 11pm wondering if everyone else has
       this figured out.
       They don't. Start a 25-minute block. That's the whole ask."
    This paragraph is the reason someone keeps reading. Do not shorten it into
    a slogan and do not make it cheerful — it should feel *seen*, not sold.

  ZONE 3 — Features (~4 in). A 2x3 grid of six cards. Each card: a simple line
    icon in a palette color, a Fraunces ~14pt title, and 2–3 lines of Inter
    ~10.5pt body. Use these six, in this order:

      1. "Blocks that match the material"
         Nine timer methods, from Sprint 15/3 for flashcards to Clinical 90/20
         for rotation pace — plus PANCE Drill 60/10 when you're building
         exam-day endurance.

      2. "Your lecture, turned into a to-do list"
         Upload a PDF, slide deck, or photo of your notes and get back a
         structured task list with Pomodoro estimates. Three free a month.

      3. "Study rooms with a shared timer"
         Join a live room and everyone sees the same countdown. Chat opens
         only during breaks, so the focus block stays a focus block.

      4. "Exams you can see coming"
         Countdowns for every exam, tasks tagged by block — Cardio, Pharm,
         Clinical, PANCE — so what's next is never a question.

      5. "Breaks that aren't a failure"
         Drink water. Rest your eyes. Stand up, if your space and mobility
         allow. Prompts that treat recovery as part of the method.

      6. "Proof you're doing the work"
         Streaks, focus-time analytics, subject breakdowns, and a study
         companion that grows with your hours.

  ZONE 4 — What's free vs. Premium (~1.5 in). A clean three-column comparison
    strip, not a heavy table. Columns: "No account", "Free account", "Premium
    $3/mo or $30/yr". Six rows maximum, pulled verbatim from the pricing block
    in Section 0. Use a check glyph AND a text label in each cell — never rely
    on color or a checkmark alone to communicate tier. Keep this zone visually
    quiet; it's reference, not persuasion.

  ZONE 5 — Call to action (bottom ~1.5 in). Full-width band in the
    purple→blue gradient, white text.
      Fraunces ~24pt: "Start your next 25 minutes."
      Inter ~12pt: "Free. No account needed. roamlyflow.com"
      QR code, minimum 1.5 x 1.5 in, high error correction, dark-on-light —
      place it on a white/paper tile inside the gradient band rather than
      putting the QR directly on a gradient, which breaks scanning.
      Target: https://www.roamlyflow.com?utm_source=onepager&utm_medium=print
      Caption beside it: "Scan to start" plus the plain URL.

TYPOGRAPHY AND LAYOUT RULES
- Establish a baseline grid and stick to it. Vertical rhythm is what makes a
  dense page feel calm.
- Maximum three type sizes per zone.
- Generous whitespace — at least 0.35 in gutters between feature cards. If the
  page feels tight, cut a feature card rather than shrinking type.
- Palette only. The gradient appears exactly once (Zone 5).
- No stethoscopes, no scrubs, no stock photos of smiling students, no medical
  iconography clichés. Abstract, warm, paper-like.

DELIVERABLES
  1. roamly-onepager.pdf — print-ready, CMYK, crop marks, bleed.
  2. roamly-onepager.png — 300 DPI RGB preview.
  3. roamly-onepager-web.pdf — RGB, no bleed, for emailing to program
     coordinators.
  4. The source HTML + build script, committed.
  5. A QR decode-verification report confirming the rendered code resolves to
     the exact target URL.
  6. Measured contrast ratios for every text/background pair, including the
     white-on-gradient CTA band.

FINAL CHECK
Read the whole page back as if you are a second-year PA student who slept five
hours. Does the top half make you feel understood within five seconds? Is every
claim on the page one I gave you in Section 0? Is the smallest type at least
10pt? If any answer is no, revise before delivering.
```

---

## Notes on running these

- **Order matters for the video.** The capture pipeline (Part A) has to finish
  and be signed off before animation starts, otherwise you get a beautiful
  video built around empty-state screenshots.
- **Credentials.** Use a dedicated demo account. Don't paste real account
  credentials into a chat transcript you don't control, and keep the Playwright
  `storageState` file out of git (`.auth/` is the convention used above).
- **QR verification is not optional.** Both print pieces ask for a decode of the
  *rendered* artifact. A QR that only works in the design file is the single
  most expensive mistake available in a print run.
- **UTM parameters** differ per artifact (`video`, `handout`, `onepager`) so
  scans are attributable in analytics.

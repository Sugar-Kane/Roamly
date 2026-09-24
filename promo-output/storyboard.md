# Roamly Flow — "Better way through it" · 60s storyboard & shot list

**Revision 2 (client direction): the middle now focuses on AI note uploads and group sessions (Rooms).**

**Concept.** The whole ad lives on one student's notebook desk at 10:47 PM. The same objects
appear in every act: Lecture 12 (heart failure) slides, a stack of pharm flashcards, renal slides,
a highlighted textbook page, sticky notes, a coffee cup, a phone, and a calendar with the exam
date circled in red. Act 1 throws them into chaos. A single hand-drawn amber line (the arc from the
Roamly Flow logo) cuts through, tidies them, and closes into the logo. Each real Roamly Flow screen
then *absorbs* one of those objects: the lecture slide morphs into a task row, the phone and the
stray papers blow off the page when Focus mode starts, the garden gets rain on the break, and the
finished lecture is stamped ✓ and stacked. Act 4 is the same desk and the same workload, but it's
organized. For the CTA, the organized desk rises into the logo.

**Music grid.** 96 BPM, 4/4, one bar = 2.5 s. Bars land on 10.0, 12.5, 15.0 … 57.5, so every act
boundary sits on a downbeat. No music during the chaos. The first note is the pickup at 10.625 s,
after the silence beat.

**Formats.** Vertical 1080×1920 (key content held inside y 250–1520) and wide 1920×1080
(recomposed: props spread horizontally and the UI panels sit side by side, with no letterboxing).
Both are driven by the same `renderAt(t)`.

**Real-UI rule.** Every Roamly Flow surface is rebuilt in HTML/CSS from `ref/*.png` and the live DOM
tokens (Fraunces / Inter / IBM Plex Mono, colors from `:root`), with copy taken verbatim. Real
screenshots (`ref/21-mobile-focus-mode.png`, `ref/22-mobile-break.png`, `ref/16-analytics.png`) also
appear as physical "printouts/phone" moments.

| # | Time | Shot | Picture | Sound | VO |
|---|------|------|---------|-------|----|
| 1 | 0.00–1.20 | **Blank page** | Cream notebook paper (blue rules, red margin) under warm lamp vignette. Pencil writes "10:47 pm" in the corner. Slow camera drift. | Room tone, desk lamp hum, pencil scratch | — |
| 2 | 1.20–3.00 | **It piles up** | Lecture 12 slide drops in (paper thwack), then flashcards fan out, the renal slides, and a textbook page with yellow highlighter. Handwritten thought #1 draws on: *"Where do I even start?"* | Page slaps, pencil, first notification ping | — |
| 3 | 3.00–5.00 | **Exam date** | Calendar page slides in, and a red marker circle draws around **EXAM**. Coffee cup lands. Phone buzzes with notification bubbles. Thought #2: *"Did I actually learn that?"* Camera starts a nervous micro-shake. | Coffee clunk, marker squeak, phone buzz, typing starts | — |
| 4 | 5.00–10.00 | **Just a countdown** | A plain, generic kitchen-style timer sticky (**25:00**) slaps onto the center and starts ticking. The chaos keeps building: more stickies, papers sliding, notification bubbles stacking. Thought #3 scrawls big: *"Wait… I've been studying for THREE HOURS?"* | Ticking loop, layered typing, pings, pages. Everything builds and gets denser | 5.0 "Studying doesn't get easier just because you started a timer." · 8.6 "You need more than a countdown." |
| 5 | 10.00–10.62 | **Freeze** | Everything stops mid-motion. Color drains slightly and a film-grain hold. | **Near-silence** (≥0.5 s) | — |
| 6 | 10.62–12.50 | **The line** | An amber hand-drawn line enters from the left and weaves through the pile. Each object it touches squares up and slides into a neat column. The generic timer gets struck through and falls off the page. | Pencil glide, soft paper settles, first music pluck notes | — |
| 7 | 12.50–15.00 | **Logo** | The line spirals and closes into the **Roamly Flow arc ring** (logo geometry: ring with a gap and a center dot) on a dark rounded tile. The Fraunces wordmark **Roamly Flow** wipes on. | Chord bloom on the downbeat | 12.6 "This is Roamly Flow." |
| 8 | 15.00–17.50 | **Unfold** | The logo tile flies to the top-left of a paper "screen". The paper folds open (card flip) to reveal the real Tasks screen. | Paper fold, whoosh | 14.6 "A timer that knows what you're studying." |
| 9 | 17.50–23.20 | **AI note upload** | The real Tasks screen with the production upload panel: "Upload study material and AI will create editable tasks for you · Choose file · You have 3 uploads left". The Lecture 12 printout flies in, hovers, and drops into **Choose file**. The panel opens (Upload notes, slides, or a photo · Lecture-12-Heart-Failure.pdf) and runs "Uploading your file…" → "Reading text and using OCR only if needed…" → **✓ Done: 5 tasks added.** It collapses ("You have 2 uploads left"), and the lecture's bullets (HFrEF vs HFpEF, ↓CO → RAAS, JVD · S3 · BNP, GDMT, 15 Qs) lift out as paper strips and land as five task rows under CARDIOLOGY · 4 / PHARMACOLOGY · 1. | Whoosh, paper drop, tap, highlighter scans, soft chime, a swish + pop per task | 17.76 "Upload tonight's lecture." · 19.62 "AI turns it into tasks you can actually finish." |
| 10 | 23.30–24.00 | **Pick a rhythm** | Quick Timer method sheet: highlighter on Deep Work 50/10 ("Longer blocks for dense material like pharmacology."), tap to select. | Sheet, highlighter, tap | — |
| 11 | 24.00–28.80 | **Focus mode** | Page-turn to Focus: task "Review HFrEF vs HFpEF definitions and EF cutoffs", Deep Work 50/10. The **Start** tap on the 25.0 downbeat blows the chrome, phone and stickies off the page, leaving FOCUS MODE. Time-lapse 50:00 → 00:00. | Tap, whoosh-away, clean groove | 25.28 "Press start… and everything else falls away." |
| 12 | 28.80–33.00 | **On a break** | Confetti, then ON A BREAK (sage) with rain on the garden. Task 1 is a 1-session task, so it auto-completes (✓ 1/1) and "Map RAAS and sympathetic activation…" becomes *Focusing*. Resume → break time-lapse, then back to FOCUS 50:00. | Chime, confetti, rain, tap | 29.30 "Take the break. Your next task is already waiting." |
| 13 | 33.00–35.00 | **Rooms lobby** | Page-turn into the real **Rooms** lobby: ALWAYS-ON ROOMS (The Grind Hall, **Deep Work Hall**, Sprint Studio, Marathon Library) with live focus timers and occupancy. Deep Work Hall highlights (7/50 → 8/50) and **Join** is tapped at 34.6. | Page turns, tap | — |
| 14a | 35.00–40.00 | **Study together** | In **Deep Work Hall**: FOCUS · BLOCK 2/3, the shared timer at 31:08, "Everyone in this room sees the same timer." Eight members pop in, then an amber ring circles the group. The **Break-time chat** card is locked: "Opens at break · 31:0x", "Chat opens in … Keep focusing". From 38.6 the shared timer time-lapses to 00:00. | Pop per member, pencil ring, riser | 35.40 "And you don't have to do it alone." · 37.46 "Everyone shares one timer, and chat only opens on the break." |
| 14b | 40.00–45.00 | **Break together** | Everyone hits the break at once: SHORT BREAK · BLOCK 2/3 (green), confetti. The chat unlocks ("Open, it's break time") and messages arrive: maya.r "block 2 done. heart failure makes sense now lol", sofia_l "same. stretching then pharm cards", priya "see you all next block". At 44.55 the room shrinks into the phone on the desk. | Chime, confetti, a ping per message | — |
| 14c | 45.00–50.00 | **Same desk** | The desk, now organized: slides stacked (Lecture 12 stamped ✓), flashcards squared, and the same calendar with the exam still circled. The phone runs Focus mode; Analytics shows Today **75 / 120 min** and a **1-day streak**. The opening thoughts get rewritten: "start here ↓", "1 of 5 done ✓", "75 min. on purpose." | Pencil rewrites, tape, paper settles | 46.04 "Same workload. Better way through it." |
| 15 | 50.00–55.00 | **Rise** | The camera tilts up off the desk. The organized cards orbit into a ring with a gap, the coffee cup (top-down) becomes the center dot, and the whole thing is the logo. Kinetic type: **DON'T JUST STUDY LONGER.** / **STUDY WITH FLOW.** | Riser into a resolving phrase | 50.6 "Don't just study longer. Study with flow." |
| 16 | 55.00–60.00 | **CTA** | Logo tile + wordmark **Roamly Flow**. "Start your next study session free." / "Free account: AI note uploads + study rooms." URL pill **roamlyflow.com** with a hand-drawn underline. Hold, then a gentle vignette fade. | Final chord at 57.5, ring out | 55.2 "Start your next session free, at roamlyflow.com." |

## Timing notes
- Silence beat: 10.00–10.62 s (music, SFX and VO all muted, room-tone floor only).
- All VO lines sit inside their shots and none cross an act boundary. Final positions after TTS are in
  `voiceover-script.md`.
- Vertical safe area: nothing essential above y=250 or below y=1520.


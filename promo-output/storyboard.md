# Roamly Flow — "Better way through it" · 60s storyboard & shot list

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
| 9 | 17.50–22.50 | **Queue** | Real **Tasks** UI: "Queue what you'll study." The lecture slide shrinks and morphs into the typed row **Cardio lecture 12: heart failure** · Cardiology · **2 sessions** → Add Task. The flashcards become **Pharm flashcards: antiarrhythmics** and the renal slides become **Renal slides + practice questions**. Counter "0 of 3 done". | Drums enter at 17.5. Key clicks, soft UI pops | 17.6 "Queue up what you're studying." |
| 10 | 22.50–25.00 | **Pick a rhythm** | **Timer method** sheet slides up. Highlighter swipes *Deep Work 50/10: "Longer blocks for dense material like pharmacology."* A handwritten arrow to *Sprint 15/3* reads "flashcards →". Deep Work is selected. | Highlighter swipe, tap | 22.6 "Pick a rhythm that fits the material." |
| 11 | 25.00–30.00 | **Focus mode** | The **Start** tap lands on the downbeat. The phone, notification bubbles and stray stickies blow off the page, the vignette softens, and the camera pushes into **FOCUS MODE**: garden, `FOCUS`, 50:00, the task, "Deep Work 50/10", "Eyes here." Time-lapse: digits roll down, the progress bar fills, a margin progress path draws segment 1. At 30.0: block done, confetti. | Whoosh-away, then a clean groove. Completion chime at 30.0 | 25.1 "Press start… and everything else falls away." |
| 12 | 30.00–35.00 | **On a break** | UI turns sage: **ON A BREAK · SHORT BREAK 10:00**. Rain falls on the garden ("Watering 💧"). Optional break reset: *Slow breaths*, *Gentle back stretch*. The notebook world relaxes: camera eases out and doodled clouds drift. Task count **1/2**. | Drums drop out, soft rain, warm pad | 30.4 "Take the break. Even your garden gets watered." |
| 13 | 35.00–40.00 | **It adds up** | **Resume** → second focus time-lapse → Cardio hits **2/2** and is checked off. The row lifts into **Completed · 1** and the physical lecture slide gets a big ✓ stamp and stacks neatly. **Pharm flashcards** becomes the **Focusing** task. The progress path fills segment 2. | Drums back, check "tick", stack thud | 35.3 "Every session counts toward the task…" · 37.7 "…and the next one's already waiting." |
| 14 | 40.00–50.00 | **Same desk** | Pull back to the opening desk, now organized: slides stacked and ticked, flashcards squared, stickies in a row, and the same calendar with the exam still circled. The phone shows Roamly Flow Focus mode running calmly. The opening thoughts come back and get rewritten: "Where do I even start?" → ~~struck~~ "start here →" (points at the queue); "Did I actually learn that?" → "1 of 3 done ✓"; "THREE HOURS?" → "75 min. on purpose." The Analytics card (Today **75 / 120 min**, **1-day streak**) pins to the page. | Warm groove, pencil rewrites | 41.0 "Same lectures. Same exam." · 44.0 "Same workload." · 45.6 "Just a better way through it." |
| 15 | 50.00–55.00 | **Rise** | The camera tilts up off the desk. The organized cards orbit into a ring with a gap, the coffee cup (top-down) becomes the center dot, and the whole thing is the logo. Kinetic type: **DON'T JUST STUDY LONGER.** / **STUDY WITH FLOW.** | Riser into a resolving phrase | 50.6 "Don't just study longer. Study with flow." |
| 16 | 55.00–60.00 | **CTA** | Logo tile + wordmark **Roamly Flow**. "Start your next study session free." / "No account needed. Just start." URL pill **roamlyflow.com** with a hand-drawn underline. Hold, then a gentle vignette fade. | Final chord at 57.5, ring out | 55.2 "Start your next session free, at roamlyflow.com." |

## Timing notes
- Silence beat: 10.00–10.62 s (music, SFX and VO all muted, room-tone floor only).
- All VO lines sit inside their shots and none cross an act boundary. Final positions after TTS are in
  `voiceover-script.md`.
- Vertical safe area: nothing essential above y=250 or below y=1520.

## Addendum: group sessions (Rooms). In progress.
Requested after the first delivery. Placement (chosen by the client): the start of the payoff.
- **40.0–43.6 s, "Not alone"**: the Focus-mode phone pulls back into a live **Room**: others focusing on the
  same shared timer, and chat locked during focus. VO v09b at 40.35 s: "And you don't have to do it alone."
  (generated, eve, STT-verified).
- The payoff VO moves later to make room: v10 → 44.0 s, v11 → 47.1 s, v12 → 48.3 s (ends 49.82 s). Thought
  rewrites follow at ~44.6 / 47.2 / 48.5 s.
- Confirmed from the signed-out "How rooms work" dialog (`ref/28-rooms-how-it-works.png`): the timer inside a room
  is already running and everyone shares it, chat stays locked during focus, and chat + voice open on breaks.
- **Blocked on a test login.** Joining a room needs an account. Once `ROAMLY_TEST_EMAIL` /
  `ROAMLY_TEST_PASSWORD` are in the environment, run `node tools/capture-rooms.mjs`, rebuild the room screen
  from `ref/31-room-focus-*.png`, then re-render.

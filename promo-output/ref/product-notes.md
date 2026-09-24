# Roamly Flow — product notes (observed on production)

Source of truth: https://www.roamlyflow.com (roamlyflow.com 308-redirects to www), explored with
Playwright (Chromium, 1440×900 @2x and 390×844 @2x) on 2026-09-24, **without an account**.
A fake browser clock (`page.clock`) was used to fast-forward through real timer blocks; nothing
else was simulated. Only features listed here may appear in the promo.

## Brand
- Product name as written in the UI: **Roamly Flow** (two words). Domain: roamlyflow.com.
- Page title: "Roamly Flow: focus timer and study planner for PA school".
- Hero line: **"The Pomodoro method built for PA school."**
  Sub: "Plan what to study, stay focused, and track your progress toward upcoming exams."
- Logo mark (`/favicon.svg`): dark rounded square `#16181D`, amber arc ring `#E8A33D`
  (circle r=9, stroke 2.5, dash 42/14 → a ring with a gap), center dot `#F2C078`.
- Fonts: **Fraunces** (display serif; wordmark, headings, timer digits), **Inter** (UI text),
  **IBM Plex Mono** (letter-spaced labels like `FOCUS MODE`, `ON A BREAK`, counts like `0/2`).
- Color tokens (HSL, from `:root`): background `34 38% 92%` (warm beige), foreground `25 30% 22%`
  (dark brown), primary `24 33% 40%` (brown; Start button), card `36 44% 97%`, border `32 24% 82%`,
  muted text `27 20% 40%`, accent `157 16% 55%` (sage; break state, Resume button).
  Buttons use a brown→sage `gradient-primary` (Add Task, Sign in, Create free account).
- Bottom nav: Focus · Tasks · Rooms · Garden · Analytics · Premium.

## Focus page (no account) — ref/01-landing.png, 20-mobile-focus.png
- "Select timer" dropdown (default **Classic 25/5**), GARDEN widget (a sprout: "Sprout, Seedling"),
  `FOCUS` label, big `25:00`, **Start**, Reset, Skip, **Focus mode**, **Pop out timer**,
  **Customize Session**.
- Banner: "Save your sessions and track progress toward upcoming exams." → Create free account / Sign in.
- **Music** panel → **Focus sounds**: Melody, Café music, Calm music, Lo-fi beats, Piano,
  Ambient drift, Rainy piano. "Play with timer — Starts with either timer, fades out for breaks."
  Also Spotify / Apple Music playlists (Deep Focus, Lo-Fi Beats, Peaceful Piano) and "paste a Spotify link".
- **Up next** — "What are you focusing on today? Add a task to connect your study time to
  something you want to complete." → **Add a task** / **Start without a task**.
  With tasks queued it lists them with subject filters (All subjects / Cardiology / …),
  a **Focusing** badge on the active task and `0/2 sessions` counts (ref/09b-up-next.png).
- "How Roamly Flow works" dialog (ref/02-how-it-works.png): Focus, Tasks & exams, Progress, Rooms,
  Music, Garden. Verbatim: "The timer works without an account. A free account adds tasks, exams,
  rooms, and synced progress."

## Timer method (ref/03-select-timer.png)
Classic 25/5 ("The original. 25 on, 5 off."), **Deep Work 50/10** ("Longer blocks for dense material
like pharmacology."), Clinical 90/20 ("Ultradian rhythm. Mirrors a focused rotation block."),
**Sprint 15/3** ("Short bursts for flashcards and quick review."), Anatomy 45/15 ("Balanced blocks for
systems and structures."), Gentle 20/10 ("Lower-intensity days. More recovery."), 52/17 ("The
productivity-study ratio."), PANCE Drill 60/10 👑, Marathon 120/30 👑, Custom 👑 ("Set your own focus,
break, and cadence."), Count-up timer ("Stopwatch mode, no countdown.").
Selecting Deep Work shows the line: "Depth over coverage. Leave this session knowing one thing
better than when you started."

## Customize Session (ref/04-customize-session.png)
SESSION EXPERIENCE: Show pets during focus, Show garden during focus ("It rains on breaks — the plants
are getting watered."), Completion confetti. TIMER BEHAVIOR: Auto-flow ("Focus rolls into break and
back without pressing Start."). SESSION ENDING: Completion sound, Browser notifications.

## Tasks (guest) — ref/05…08, 19, 23
- "Tasks — Queue what you'll study. Pick one to focus on."
- Guest notice: "Guest tasks stay on this device. 0 of 5 used. Create a free account to sync and use AI uploads."
- Add row: "Add a study task…" · Subject ("Subject, e.g. Pharm", then a dropdown with "＋ New subject…")
  · session count "1 session … 9 sessions" (aria: "How many focus sessions will it take to complete this
  task?") · **Add Task**.
- Tasks group under subject headers (`CARDIOLOGY · 1`), each row: checkbox, title, colored subject pill,
  ▷ focus button, `0/2` session count, ✕. Progress line: "0 of 3 done" → "1 of 3 done" with a
  **"Completed · 1"** section once a task is finished.
- Task preferences: "Complete tasks automatically — When on, a task is checked off as soon as it reaches
  its planned focus-session count." (observed behaviour: after 2/2 sessions the task was completed and
  the next task became the active **Focusing** task).
- Planned study → "Account required" (not shown in video).

## A study session (observed end-to-end) — ref/09…14, 21, 22
1. Focus page with the queued task shown under the timer.
2. Pick **Deep Work 50/10** → timer 50:00.
3. **Start** → the app switches into **FOCUS MODE** (full-screen, "✕ Exit"): garden card, `FOCUS`,
   huge countdown, task title, method name, the Deep Work line, a progress bar with session pips,
   "Eyes here. Notifications quiet themselves in your device's Focus mode.", Pause / Skip /
   Pop out timer / Customize Session. Right column: **STUDYING** list (active task with **Focusing**
   badge and `0/2`, the other queued tasks), Music panel. A tip card: "A website can't silence your
   phone. Turn on your device's Focus / Do Not Disturb for a true deep-work block."
4. Block ends → **ON A BREAK** state: sage-green labels, `SHORT BREAK 10:00`, the garden gets rain and a
   "Watering 💧" tag ("Break time — your garden is getting watered."), "Break time. Look away, stretch,
   breathe. Your alerts are back on.", sage **Resume** button. The task count moves to `1/2`.
   List shows "Optional break reset" items: e.g. Slow breaths, Gentle back stretch, Stand up,
   Relax your hands (each tagged **Optional**). A house ad card ("Advertise on Roamly Flow") also shows
   on breaks for non-premium users (not used in the video).
5. A streak chip "🔥 1 day" appears in the header after the first finished session.
6. Second block → Cardio task reaches 2/2, is completed, and "Pharm flashcards: antiarrhythmics" becomes
   the **Focusing** task automatically.

## Analytics (guest) — ref/16, 24
"Analytics — Live from your timer. Every session you finish counts here." **Your progress**:
"1-day streak", Today `75 / 120 min` bar, **Daily goal** stepper (120 min). Tiles: This week `1h 15m`,
Streak `1 day`, Best day (7d) `Today 75m`. "Focus minutes by day — Your last 7 days." bar chart.
"Guest analytics stay in this browser only." Premium "Deeper insights" section (not used).

## Rooms: group sessions (used in the payoff)
- Signed out (observed on production, `ref/17-rooms*.png`, `ref/28-rooms-how-it-works.png`): "Rooms: Focus
  alongside other PA students in real time." Guests can browse only. "How rooms work", verbatim:
  1. "With an account, pick a room and hit Join. The timer inside is already running, and everyone in the room shares it."
  2. "Focus together in silence. Music plays if you want it; chat stays locked so nobody can distract you."
  3. "When the break hits, chat and voice open. Say hi, compare notes, then the next focus block starts automatically."
  4. "Premium members can host public or private rooms…" and "Always-on rooms never stop, so there's always one to drop into."
- **In-room screens** (`ref/30-room-lobby-mobile.png`, `ref/31-room-{focus,break}-{mobile,desktop}[-full].png`,
  `ref/rooms-dom.txt`). Signing in with the client's test account was blocked by Cloudflare Turnstile, which is
  verified server-side by Supabase. At the client's choice, the in-room UI was rendered from the **production source**
  (`src/RoomsLive.tsx`, which main auto-deploys) in `room-harness/`: the component is unchanged, and only the
  Supabase client is swapped for an offline stand-in. Room data is production's real always-on rooms, read
  read-only from the database: The Grind Hall 25/5, **Deep Work Hall 50/10** ("Long 50/10 blocks for dense
  material"), Sprint Studio 15/3, Marathon Library 90/20. Member usernames and chat lines are **fictional**.
- In-room copy used: "Deep Work Hall", "Always on · 50/10 rhythm · study anything", Invite / Leave,
  "FOCUS · BLOCK 2/3", "Everyone in this room sees the same timer.", member chips "alex (you)", Focus mode,
  Pop out timer, "Break-time chat", "Opens at break · 31:06", "No messages yet. Say hi at the next break.",
  "Chat unlocks during short and long breaks, then locks again when focus starts."

## AI note uploads (used 17.5–23 s)
- Production component `src/UploadTasks.tsx` (`UploadTasksPanel`), rendered unchanged in `room-harness/upload.html`,
  with screenshots `ref/40-upload-idle-*.png`, `41-upload-reading-*.png`, `41b-…`, `42-upload-done-*.png` and text in
  `ref/upload-dom-*.txt`. Copy: "Upload study material and AI will create editable tasks for you" · "Choose file" ·
  "You have 3 uploads left" · "Top up" · "Upload notes, slides, or a photo" · "Roamly Flow AI reads your PDF, Word file,
  PowerPoint, text, screenshot, or photo and creates editable study tasks from the material. Files can be up to 12 MB;
  scans use OCR automatically and handwriting is best effort." · "Uploading your file…" · "Reading text and using OCR
  only if needed…" · "Done: 5 tasks added."
- Quotas (`FREE_MONTHLY_UPLOAD_QUOTA = 3`, Premium 10; Pricing page: free account "3 a month").
- `api/generate-tasks.ts` sends the file to Claude (claude-haiku-4-5) with a PA-school prompt that returns
  `{title, tag, est}` per topic, reusing the student's existing subjects, with 1–2 sessions per task typical.
- **The 5 tasks in the video are SAMPLE output** (`room-harness/sample-ai-tasks.json`), written to follow that prompt's
  rules for a "Lecture 12 — Heart Failure" upload. No Anthropic key was available in the render environment, and the
  production endpoint requires a signed-in session. Everything around it (panel, progress states, copy) is the real
  component.
- One small liberty: the open panel's native file input ("Choose File · No file chosen") is shown as a filename chip.

## Other (observed, mostly not used)
- Garden tab: "Sign in to unlock your Garden" (XP, pets, plants) — account required, so the video only
  shows the **timer's garden widget**, which works for guests.
- Premium: $3/month or $30/year. No account: tasks 5 on this device, core timer methods,
  7-day local analytics basics. Free account: unlimited synced tasks, exam schedules, 3 AI note
  uploads/month, join rooms. Premium: planned study, PANCE Drill & Marathon, breakdowns, host rooms.

## Claims the promo may make (all verified above)
- It's a Pomodoro timer built around **what you're studying** (tasks + subjects + planned session counts).
- Timer methods matched to material (Deep Work 50/10 for dense material, Sprint 15/3 for flashcards).
- Start → Focus mode clears everything but the timer and the task.
- Breaks are their own state (On a break, the garden gets watered, optional break reset).
- Sessions count toward the task; finished tasks are checked off and the next one is up.
- Daily goal / streak / focus minutes in Analytics.
- Rooms: study alongside others on one shared timer, with chat locked during focus and open on breaks (free account).
- **Free to start.** The timer, 5 tasks and basic analytics work with no account. A free account adds AI note uploads
  (3/month) and joining study rooms → "Start your next study session free. Free account: AI note uploads + study rooms."
- AI note uploads: upload lecture material and AI creates editable study tasks (free account, 3 a month).

## Not to be shown (account-only or not observed)
Exam countdown UI, Planned study, Garden XP/pets, voice chat in use (Premium).
(An exam date may appear only as a physical paper prop in the collage — never as Roamly UI.)

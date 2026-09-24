# Review notes

Method: I can't watch video, so each render is reviewed from a contact sheet built from the encoded
MP4 (one frame every 0.5 s, timestamp labels, vertical safe-area lines at y=250 and y=1520).
I also pull key frames at 540×960 or 960×540, and check against `storyboard.md`, `voiceover-script.md`
and `ref/product-notes.md`. The audio is checked by measurement (ffmpeg loudnorm/ebur128 plus numpy
stem analysis), and every VO line is round-tripped through xAI speech-to-text.

Sheets: `review/sheet-vertical-pass1.jpg`, `review/sheet-vertical-pass2.jpg`, `review/sheet-wide-pass2.jpg`,
`review/sheet-*-final.jpg`.

---

## Pass 0: pre-render preview sheets (direct `renderAt` screenshots)
Caught before any encode:
- `.appcard {position: relative}` overrode `.abs`, so the app cards fell into normal flow (off-centre). Fixed.
- `#preview {display:flex}` beat the `hidden` attribute, so preview controls leaked into frames. Fixed.
- `PROPS.notifs` was an array, and `.keys` resolved to `Array.prototype.keys`. Moved to its own list.
- Vertical Tasks card too small, with empty space under it. Now top-anchored in the safe band and scaled
  to fit; the wide version gets a desktop-width Tasks layout (like `ref/06-tasks-queued.png`).
- Scaling around a non-centre `transform-origin` (paper fold / page flip) shifted the scaled cards, so the
  Focus card sat off-centre and the header logo landed above the card. The origin now stays centred.
- Thought strips showed an empty white strip before the handwriting. The reveal now clips the whole strip.
- Wide CTA headline collided with the logo ring. Now two stacked lines on the left.
- Payoff was cluttered (thoughts on top of the phone and Analytics). Re-composed: workload row on top,
  phone on the left, the three thoughts as a right-hand column, Analytics below.

## Pass 1: `roamlyflow-promo-vertical.mp4` (first full encode)
Findings:
1. **Tasks card: Add Task button clipped.** The three controls overflowed the 390 px card.
   Fixed: fixed-width session select, subject shrinks and truncates like the real app ("Subject, e.g. Ph…").
2. **Object → task-row morph mostly invisible.** The slide/flashcards hovered at y≈1780, inside the
   bottom unsafe zone. Fixed: they hover just under the card (y≈1290–1370) before shrinking into their row.
3. **Payoff phone too small / overlapping Analytics.** Phone enlarged (0.9) and moved up. Analytics moved down.
4. **Render speed.** Playwright's `page.screenshot` took about 1 s/frame. Switched to CDP
   `Page.captureScreenshot` (lossless PNG, `optimizeForSpeed`) at 0.27 s/frame.
5. CTA ring cards were small, so they were enlarged (0.30 → 0.36). Added hand-drawn sparkles to the end card.

Success test, pass 1 (vertical):
1. Relevant to a student within 5 s? **Yes.** By 1.2 s it's "10:47 pm" in pencil on notebook paper plus a
   printed "Lecture 12 — Heart Failure" slide. By 3.4 s: flashcards, a highlighted pharm textbook, and
   "Where do I even start?".
2. Problem obvious within 15 s? **Yes.** The pile, three anxious thoughts, a generic 25:00 timer that changes
   nothing, then VO "You need more than a countdown."
3. Can someone explain Roamly Flow by 30 s? **Partly.** The queue → method → Focus mode arc is there, but in
   pass 1 the object-to-task morph was mostly off-screen, which weakens "a timer tied to what you study".
   Fixed for pass 2.
4. More useful than a generic Pomodoro timer? **Yes.** There's an explicit generic-timer foil. Then tasks with
   session counts, a method matched to material, a break with its own state, and auto-advancing tasks.
5. Real product visible enough? **Yes.** Real Tasks, Timer method, Focus mode, On a break, Studying and
   Analytics screens, rebuilt from production DOM/CSS with verbatim copy.
6. CTA makes you want to visit? **Mostly.** The lockup is clear, but it was a bit static. Sparkles and the
   URL underline were added.

## Pass 2: both formats (`review/sheet-vertical-pass2.jpg`, `review/sheet-wide-pass2.jpg`)
Checked frame by frame against the storyboard:
- 0–10 s chaos reads clearly at phone size. Thoughts are 64–78 px handwriting on paper strips with a
  highlighter swipe, all inside the vertical safe band. The generic LCD timer ticks 25:00 → 24:55 and
  freezes at 10.0 s.
- 10.6–12.5 s: the amber line tidies the pile into two margin columns, strikes the generic timer, and
  closes into the logo ring. The wordmark wipes on at 12.85 s under "This is Roamly Flow."
- 17.5–22 s: the lecture slide, flashcards and renal slides each shrink into their typed task row.
  The vertical Add Task button is no longer clipped.
- 25 s: Start → the page chrome, phone and stickies blow away → FOCUS MODE. 30 s: confetti + ON A BREAK
  (sage), rain on the garden. 37.5 s: Cardio 2/2 ✓ → "Completed · 1", Pharm flashcards is *Focusing*.
- 40–50 s payoff: the same objects, organized. The thoughts are rewritten in sync with the VO beats.

Findings fixed for the final render:
1. The CTA wordmark faded in while the logo was still moving up, so they overlapped at 55.5 s.
   The wordmark now waits until the logo settles (55.75 s).
2. The end card was undersized for a phone: logo 300 → 340 px, wordmark 132 → 150 px, sub 50 px,
   URL pill 58 px. The sparkles are retimed.
3. The payoff (41–50 s) was compositionally static for 9 s, so I added a slow 4.5% push-in.
4. The wide Tasks card sat in the top half with an empty lower half. It's now anchored lower, so the
   finished list is centred.
5. File size: CRF 15 gave 133 MB/min. The final uses CRF 17 capped at 12 Mbps (the standard 1080p60
   delivery rate).

Success test, pass 2 (both formats): all six answers are now **yes**.
1. Student-relevant within 5 s: pencil "10:47 pm", a cardiology lecture slide, pharm flashcards.
2. The problem is obvious by 10 s. By 15 s the fix has been introduced.
3. By 30 s a viewer can say: "you queue what you're studying, pick a block length that fits it, and it
   runs a focus mode + break around that task."
4. It's clearly more than a countdown: the generic timer is literally struck out, and each Roamly screen
   shows something a plain timer can't (tasks with session counts, a method per material, auto-advancing
   tasks, a break state, progress).
5. The real app is recognisable. Six production screens appear with their real copy, colours and fonts,
   and the phone in the payoff shows Focus mode running.
6. The CTA is frictionless and true: "Start your next study session free. No account needed. Just start.
   roamlyflow.com".

## Fresh-eyes read (as someone who's never heard of Roamly Flow)
"It's 10:47 pm, there's too much to study, and a timer doesn't help. Roamly Flow is a study timer
where you list what you're studying (lecture, flashcards, slides). It picks a block length for that
material, hides everything else while you focus, gives you a real break, and ticks things off
as you finish sessions. It's free and I don't need an account." That's the intended message.
Two things a first-time viewer might miss:
the garden (it's just a nice detail, which is fine), and that the exam date isn't a feature (on purpose: exam
countdowns need an account, so the calendar stays a paper prop only).

## Audio measurements (final mix, `audio/mix.wav`, ffmpeg loudnorm analysis)
| Metric | Target | Measured |
|---|---|---|
| Integrated loudness | −14 LUFS | **−13.99 LUFS** (pass 3); **−14.01 LUFS** final, with Rooms |
| True peak | < −1 dBTP | **−1.26 dBTP** (pass 3); **−1.60 dBTP** final |
| Loudness range | — | 7.4 LU |
| Music duck under VO | 8–10 dB | **9.0 dB** (60 ms attack / 180 ms hold / 350 ms release) |
| Silence beat 10.00–10.62 s (0.62 s) | near-silent ≥ 0.5 s | **−74.2 dBFS RMS, −62.0 dBFS peak** |
| VO over bed (music+SFX), per line | intelligible | **7.9–12.8 dB** (lowest is v01, inside the deliberately busy chaos section) |

Final MP4 audio: AAC-LC 256 kb/s, 48 kHz stereo, muxed from `audio/mix.wav`.

## Pass 3: final renders (`review/sheet-vertical-final.jpg`, `review/sheet-wide-final.jpg`)
Confirmed on the encoded MP4s: all pass-2 fixes landed and nothing regressed. Key content sits inside
y 250–1520 on vertical throughout, except deliberately peripheral props and the page chrome that flies away.

| File | Size | Video | Audio | Loudness (from the MP4) |
|---|---|---|---|---|
| `roamlyflow-promo-vertical.mp4` | 86 MB | 1080×1920, 60 fps, H.264 High, yuv420p/bt709, 60.00 s | AAC-LC 48 kHz stereo | −13.99 LUFS, −1.27 dBTP |
| `roamlyflow-promo-wide.mp4` | 85 MB | 1920×1080, 60 fps, H.264 High, yuv420p/bt709, 60.00 s | AAC-LC 48 kHz stereo | −13.99 LUFS, −1.27 dBTP |

Things only a human listen can confirm:
- The pronunciation of "Roamly". The line is sent with IPA `/ˈroʊmli/`. STT transcribes it as "Romley",
  but it does the same for an unambiguous "Roamlee" spelling, so this looks like STT spelling, not a mispronunciation.
- The balance of the synthesized SFX against the music. Levels were set by measurement, not by ear.

## Pass 4: group sessions (Rooms) added, re-rendered (`review/sheet-*-final.jpg`)
The client asked to include group sessions. The beat sits at 40.0–43.6 s, with the desk payoff moved to 43.6–50 s.
- **Source of the room UI.** Logging in with the client's test account hit Cloudflare Turnstile (verified
  server-side by Supabase). I didn't try to get around it. At the client's choice, the in-room screens were
  rendered from the production `RoomsLive` component itself (`room-harness/`), with the real always-on room
  data (read-only query) and fictional member names. See `ref/product-notes.md`.
- Checked on the encoded MP4s:
  - 40.0 s: the Focus-mode card page-turns into Deep Work Hall.
  - 40.55–41.66 s: eight member chips pop in, under VO v09b (40.45–41.98 s).
  - 41.35 s: an amber ring draws around the group.
  - 41.9 s: the locked "Break-time chat · Opens at break" card arrives.
  - 43.15–43.6 s: the room shrinks into the payoff phone.
- Payoff VO moved to 44.07 / 47.16 / 48.33 s. The rewrites follow at 45.0 / 47.3 / 48.5 s, and the last VO line
  ends at 49.82 s, before the CTA act.
- Success test re-check. Q3 and Q4 are stronger: a viewer now also sees that you can study *with* people on one
  shared timer, which a plain Pomodoro timer can't do. The other answers are unchanged: **all yes**.
- Final measurements (both MP4s): 60.00 s, 60 fps, H.264 High, AAC 48 kHz. **−14.01 LUFS, −1.60 dBTP**.
  Silence beat: −74.6 dBFS RMS.

## Pass 5: re-cut around AI note uploads and group sessions (`review/sheet-*-final.jpg`)
Client direction: "focus more on the group sessions and the AI note uploads". The chosen structure is
Upload → Focus → Room, with the CTA changed to "Free to start".
- **New middle act.** 17.5–23.2 s AI upload (production `UploadTasksPanel`) · 23.3–33 s method + focus + break,
  condensed · 33–45 s Rooms (lobby → join → shared timer → break chat) · 45–50 s desk payoff. See `storyboard.md`.
- **Sample AI output.** The five tasks the upload produces are sample output written to the production prompt's
  rules. The real endpoint needs a signed-in session and an Anthropic key, and neither was available. The panel,
  its states and its copy are the real component. This is disclosed in `ref/product-notes.md`.
- **CTA truth fix.** Both featured features need a free account, so "No account needed" was replaced with
  "Free account: AI note uploads + study rooms."
- **VO.** Rewrote v05/v06 (STT heard "Upload" as "Grok in", and v06 ran 5.75 s), added v10, and dropped v09/v12.
  Every line was re-checked with STT.
- **Audio chain.** A 3:1 VO bus compressor kept VO under the bed, so the music was lowered 3 dB and SFX 2 dB. The
  master is now measure → exact gain → 4× oversampled limiter, because two-pass loudnorm stalled around −14.2.

Checked on the encoded MP4s, frame by frame:
- 17.9–19.0 s: the Lecture 12 printout hovers and drops into **Choose file**. 19.45–21.3 s: Uploading → Reading
  (progress bar climbs) → "Done: 5 tasks added." 21.95–22.4 s: five paper strips fly into five rows, grouped
  CARDIOLOGY · 4 / PHARMACOLOGY · 1, and the quota reads "You have 2 uploads left".
- 28.8 s: confetti, then ON A BREAK. Task 1 (1 session) auto-completes and task 2 becomes *Focusing*.
- 33.3 s: lobby with four always-on rooms and live timers. Deep Work Hall is joined at 34.6 s.
- 35–38.6 s: eight members join, an amber ring circles them, and the chat stays locked. 38.6–40 s: the shared
  timer time-lapses. 40.0 s: every member hits SHORT BREAK · BLOCK 2/3 together (green), confetti, the chat
  opens, and three messages arrive. I checked 39.95 / 40.00 / 40.03 / 40.10 s directly: the lift is smooth.
- Vertical: all key content stays inside y 250–1520, including the chat card after it moves up for the break.

Success test, pass 5 (both formats):
1. Student-relevant within 5 s: **yes** (unchanged opening).
2. Problem obvious within 15 s: **yes** (unchanged).
3. Explain Roamly Flow by 30 s: **yes, and more concretely**. "You upload your lecture, it turns it into tasks,
   then runs focus blocks and breaks on those tasks."
4. More useful than a generic Pomodoro timer: **yes, strongest so far**. AI-made tasks from your own material,
   plus a room of people on one shared timer with chat only on the break. A plain timer does neither.
5. Real product visible enough: **yes**. Upload panel, Tasks, Timer method, Focus mode, On a break, Rooms lobby,
   in-room focus/break, and Analytics, all from production components or DOM.
6. CTA makes you want to visit: **yes**, and it's now accurate about what needs a free account.

| Metric | Target | Measured (`audio/mix.wav`) |
|---|---|---|
| Integrated loudness | −14 LUFS | **−14.00 LUFS** |
| True peak | < −1 dBTP | **−1.38 dBTP** |
| Loudness range | — | 8.1 LU |
| Music duck under VO | 8–10 dB | **9.0 dB** |
| Silence beat 10.00–10.62 s | ≥ 0.5 s near-silent | **−70.9 dBFS RMS** |
| VO over bed, per line | intelligible | **7.7–12.1 dB** |

| File | Size | Video | Audio | Loudness (from the MP4) |
|---|---|---|---|---|
| `roamlyflow-promo-vertical.mp4` | 86 MB | 1080×1920, 60 fps, H.264 High, yuv420p/bt709, 60.00 s | AAC-LC 48 kHz stereo | −14.01 LUFS, −1.40 dBTP |
| `roamlyflow-promo-wide.mp4` | 86 MB | 1920×1080, 60 fps, H.264 High, yuv420p/bt709, 60.00 s | AAC-LC 48 kHz stereo | −14.01 LUFS, −1.40 dBTP |

## Pass 6: Rooms beat cut to the voice, and the feature called out on screen
Client note: "time the group rooms transitioned properly with the voice and emphasize that feature better".
Problems in pass 5:
- The lobby (33.3–35.0 s) played with no VO, and "And you don't have to do it alone" only started after
  the room was already open.
- The break hit at 40.0 s while the VO was still on "…and chat only opens on the…". The word "break"
  landed about 1.5 s late.
- 41.8–46.0 s had no VO over the break chat, which is the feature's payoff.
- The vertical break layout lifted the room above the safe band (title at about y 145).

Changes:
- **VO rewritten for the beat.** Three lines replace v09b/v10: v09c "And you don't have to do it alone. Join a
  study room." · v10b "Everyone shares one timer, and chat only opens on the break." · v10c "Say hi, compare notes,
  then start the next block together." (The last one paraphrases production's "How rooms work" step 3.)
- **Cut to the words.** The lines were transcribed with word timestamps, and each event sits on its word:
  - "Join" → the Join tap (35.2).
  - "Everyone" → the ring around the members (36.7).
  - "one timer" → the digits pulse amber (37.6).
  - "chat" → the chat card lands, locked (39.2).
  - "break" → SHORT BREAK, confetti, chat unlocks (40.85).
  - "hi" / "notes" / "next block" → one message each (41.5 / 42.2 / 43.5).
- **Emphasis.**
  - Four taped callouts: "real students, studying live", "one timer for everyone", "chat stays locked while you
    focus", "break = chat time ✓".
  - Before the chat arrives, the room sits alone, centred and larger.
  - The chat card flashes green when it opens.
- **Safe area.** On the break in vertical, the room and chat scale down together, so they fit inside y 250–1520.
- The payoff moves 0.3 s later (45.3 s), and v11 moves to 46.14 s.

Success test re-check: Q3 and Q4 get stronger. By 45 s a viewer can say what a room is (a live, shared timer
with strangers, where chat is locked during focus and opens on the break). No other answers change: **all yes**.

Checked on the encoded MP4s (sheet of 33–46.5 s at 2 fps, both formats): every event lands on its word, the callouts
wipe on in order, and vertical stays inside y 250–1520 through the break.

| File | Size | Video | Audio | Loudness (from the MP4) |
|---|---|---|---|---|
| `roamlyflow-promo-vertical.mp4` | 86 MB | 1080×1920, 60 fps, H.264 High, 60.00 s | AAC-LC 48 kHz stereo | −13.98 LUFS, −1.36 dBTP |
| `roamlyflow-promo-wide.mp4` | 86 MB | 1920×1080, 60 fps, H.264 High, 60.00 s | AAC-LC 48 kHz stereo | −13.98 LUFS, −1.36 dBTP |

Silence beat 10.00–10.62 s: −71.2 dBFS RMS.

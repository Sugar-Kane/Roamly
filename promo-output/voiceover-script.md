# Roamly Flow — 60 s promo · final voiceover

**Voice:** xAI TTS `eve` (chosen from the five samples in `voice-samples/`), English, speed 1.0.
Each line is its own file (`audio/vo/v01.wav` … `v14.wav`, 48 kHz), placed on the timeline by
`tools/vo-lines.json`. Pauses use the xAI `[pause]` speech tag, not split sentences.
"Roamly" is sent with an IPA override (`/ˈroʊmli/`, "ROAM-lee"). The URL is read as "roamly flow dot com".
Every line was checked with xAI speech-to-text: all words match, and no tag was read aloud.
The Rooms lines were also transcribed with word timestamps, and the picture is cut to those words.
v09c has 0.3 s of silence spliced in after "alone," so "Join a study room." lands as its own beat.

**Tone:** a young adult who got through grad school, talking to a classmate: warm, calm, a little
playful, not a motivational speaker.

| # | In → out (s) | Line (as sent to TTS) | Picture under it |
|---|---|---|---|
| v01 | 5.01 → 7.94 | Studying doesn't get easier just because you started a timer. | A generic 25:00 kitchen-style timer slaps down and ticks. The pile keeps growing. |
| v02 | 8.38 → 9.90 | You need more than a countdown. | Peak chaos. It ends 0.1 s before the freeze. |
| — | 10.00 → 10.62 | *(silence)* | Everything freezes. The mix is near-silent (−74 dBFS RMS). |
| v03 | 12.71 → 14.18 | This is Roamly Flow. | The amber line closes into the logo ring, then the wordmark wipes on. |
| v04 | 14.48 → 16.24 | A timer that knows what you're studying. | The logo flies into the app header and the Tasks screen unfolds. |
| v05 | 17.76 → 19.16 | Upload tonight's lecture. | The Lecture 12 printout drops into the real upload panel. |
| v06 | 19.62 → 22.43 | AI turns it into tasks you can actually finish. | "Reading text…" → "Done: 5 tasks added." The lecture's bullets land as 5 tasks. |
| v07 | 25.28 → 28.54 | Press start, [pause] and everything else falls away. | Start tap. Chrome and distractions blow off the page, leaving FOCUS MODE. |
| v08 | 29.30 → 32.92 | Take the break. [pause] Your next task is already waiting. | ON A BREAK: rain on the garden. Task 1 is done ✓ and task 2 is *Focusing*. |
| v09c | 33.04 → 36.11 | And you don't have to do it alone. Join a study room. | The Rooms lobby turns in ("real students, studying live"). **Join** is tapped on the word "Join" (35.2). |
| v10b | 36.67 → 41.12 | Everyone shares one timer, [pause] and chat only opens on the break. | The ring draws around the members on "Everyone"; the digits pulse on "one timer" (37.6). The chat card lands on "chat" (39.2), locked. The time-lapse runs under "only opens on the", and the break hits on "break" (40.85). |
| v10c | 41.52 → 45.05 | Say hi, compare notes, [pause] then start the next block together. | The chat unlocks and a message pops on "hi", "notes" and "next block". The room then shrinks into the phone. |
| v11 | 46.14 → 49.44 | Same workload. [pause] Better way through it. | The same desk, organized. Thoughts rewritten, Analytics 75 / 120 min. |
| v13 | 50.75 → 53.93 | Don't just study longer. [pause] Study with flow. | Camera rises. The materials orbit into the logo. DON'T JUST STUDY LONGER. / STUDY WITH FLOW. |
| v14 | 55.35 → 58.91 | Start your next session free, at roamly flow dot com. | Lockup: Roamly Flow · "Start your next study session free." · "Free account: AI note uploads + study rooms." · roamlyflow.com |

In/out times are the measured speech onset and offset (−40 dBFS gate) after placement.

## On-screen copy (all verified against production, see `ref/product-notes.md`)
- Handwritten thoughts: "Where do I even start?" · "Did I actually learn that?" · "Wait… I've been
  studying for THREE HOURS?" → rewritten in the payoff as "start here ↓" · "1 of 5 done ✓" · "75 min. on purpose."
- Rooms callouts (taped notes): "real students, studying live" · "one timer for everyone" · "chat stays locked
  while you focus" · "break = chat time ✓". Each paraphrases the production "How rooms work" copy.
- End card: **DON'T JUST STUDY LONGER. / STUDY WITH FLOW.** · **Roamly Flow** · Start your next study
  session free. · Free account: AI note uploads + study rooms. · **roamlyflow.com**
  (Both featured features need a free account: 3 AI uploads a month, and joining rooms. So the old
  "No account needed" line was replaced, at the client's choice.)

## Mix notes
Music ducks 9 dB under VO (60 ms attack, 180 ms hold, 350 ms release). SFX dip 3 dB under VO.
Chaos SFX swell +4 dB from 2 s to the freeze. The VO bus has a 3:1 compressor above −16 dBFS. The master measures integrated loudness, applies the exact gain
to reach −14 LUFS, then a 4× oversampled true-peak limiter (ceiling −1.4 dBFS). See `review-notes.md`
for the measured values.

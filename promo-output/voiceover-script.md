# Roamly Flow — 60 s promo · final voiceover

**Voice:** xAI TTS `eve` (chosen from the five samples in `voice-samples/`), English, speed 1.0.
Each line is its own file (`audio/vo/v01.wav` … `v14.wav`, 48 kHz), placed on the timeline by
`tools/vo-lines.json`. Pauses use the xAI `[pause]` speech tag, not split sentences.
"Roamly" is sent with an IPA override (`/ˈroʊmli/`, "ROAM-lee"). The URL is read as "roamly flow dot com".
Every line was checked with xAI speech-to-text: all words match, and no tag was read aloud.

**Tone:** a young adult who got through grad school, talking to a classmate: warm, calm, a little
playful, not a motivational speaker.

| # | In → out (s) | Line (as sent to TTS) | Picture under it |
|---|---|---|---|
| v01 | 5.01 → 7.94 | Studying doesn't get easier just because you started a timer. | A generic 25:00 kitchen-style timer slaps down and ticks. The pile keeps growing. |
| v02 | 8.38 → 9.90 | You need more than a countdown. | Peak chaos. It ends 0.1 s before the freeze. |
| — | 10.00 → 10.62 | *(silence)* | Everything freezes. The mix is near-silent (−74 dBFS RMS). |
| v03 | 12.71 → 14.18 | This is Roamly Flow. | The amber line closes into the logo ring, then the wordmark wipes on. |
| v04 | 14.48 → 16.24 | A timer that knows what you're studying. | The logo flies into the app header and the Tasks screen unfolds. |
| v05 | 17.65 → 20.74 | Queue up tonight's lectures, slides, and flashcards. | Real Tasks UI: the lecture slide morphs into "Cardio lecture 12: heart failure · 2 sessions", then flashcards, then renal slides. |
| v06 | 22.59 → 24.36 | Pick a rhythm that fits the material. | Timer method sheet: Deep Work 50/10, "Longer blocks for dense material like pharmacology." |
| v07 | 25.28 → 28.54 | Press start, [pause] and everything else falls away. | Start tap. Page chrome, phone and stickies blow off the page, leaving FOCUS MODE. |
| v08 | 30.38 → 34.31 | Take the break. [pause] Even your garden gets watered. | ON A BREAK: sage UI, rain on the garden ("Watering"), optional break reset. |
| v09 | 35.39 → 39.97 | Every session counts. [pause] Finish a task, and the next one's already up. | Cardio hits 2/2, gets checked off into "Completed · 1", and Pharm flashcards becomes *Focusing*. |
| v10 | 41.07 → 43.91 | Same lectures. [pause] Same exam. | Back on the same desk, now organized. The exam is still circled. |
| v11 | 44.21 → 45.27 | Same workload. | The opening thoughts get struck out and rewritten. |
| v12 | 45.63 → 47.12 | Just a better way through it. | Analytics: Today 75 / 120 min, 1-day streak. "75 min. on purpose." |
| v13 | 50.75 → 53.93 | Don't just study longer. [pause] Study with flow. | Camera rises. The materials orbit into the logo. DON'T JUST STUDY LONGER. / STUDY WITH FLOW. |
| v14 | 55.35 → 58.91 | Start your next session free, at roamly flow dot com. | Lockup: Roamly Flow · "Start your next study session free." · "No account needed. Just start." · roamlyflow.com |

In/out times are the measured speech onset and offset (−40 dBFS gate) after placement.

## On-screen copy (all verified against production, see `ref/product-notes.md`)
- Handwritten thoughts: "Where do I even start?" · "Did I actually learn that?" · "Wait… I've been
  studying for THREE HOURS?" → rewritten in the payoff as "start here ↓" · "1 of 3 done ✓" · "75 min. on purpose."
- End card: **DON'T JUST STUDY LONGER. / STUDY WITH FLOW.** · **Roamly Flow** · Start your next study
  session free. · No account needed. Just start. · **roamlyflow.com**
  ("No account needed" is true on production: the timer, 5 guest tasks and 7-day local analytics work signed-out.)

## Mix notes
Music ducks 9 dB under VO (60 ms attack, 180 ms hold, 350 ms release). SFX dip 3 dB under VO.
Chaos SFX swell +4 dB from 2 s to the freeze. The master is two-pass loudnorm (linear): see `review-notes.md`
for the measured values.

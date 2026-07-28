# Shot list

Which capture feeds which scene, and what each one has to show. Produced by
`scripts/capture-shots.mjs`; reviewed via `npm run contact-sheet`.

## Timeline

| # | Scene | In–out | Captures used |
| --- | --- | --- | --- |
| 1 | The feeling | 0:00–0:07 | *(none — typography only)* |
| 2 | The timer | 0:07–0:16 | `01-focus-timer.png` |
| 3 | The methods | 0:16–0:24 | `02-methods.png` |
| 4 | AI from your notes | 0:24–0:34 | `03-upload.mp4` |
| 5 | You're not studying alone | 0:34–0:44 | `04-room.mp4`, `10-mobile-room.png` |
| 6 | Breaks without guilt | 0:44–0:50 | *(none — gradient wash)* |
| 7 | Progress you can see | 0:50–0:56 | `05-analytics.png`, `06-garden.png`, `07-pip.mp4` |
| 8 | Close | 0:56–1:00 | `roamly-logo.png`, `qr.png` (generated) |

## Captures

| File | Kind | Scene | Must show |
| --- | --- | --- | --- |
| `01-focus-timer.png` | still | 2 | Timer mid focus block, task list visible beside it |
| `02-methods.png` | still | 3 | Method picker open, PA presets visible |
| `03-upload.mp4` | 8–12s | 4 | Choose file → processing → generated task list appears |
| `04-room.mp4` | 8–12s | 5 | Live room, shared countdown ticking, participants visible |
| `05-analytics.png` | still | 7 | Analytics with real weekly history |
| `06-garden.png` | still | 7 | Companions / garden with unlocked pets |
| `07-pip.mp4` | 4–6s | 7 | Picture-in-picture timer floating over another window |
| `08-themes.mp4` | 4–6s | reserve | Switching between two or three themes |
| `09-mobile-timer.png` | still | reserve | Timer at 390x844 |
| `10-mobile-room.png` | still | 5 | Same room as `04-room.mp4`, at 390x844 |

## Captured but not placed

Two shots the brief asks for are captured and reviewed, but do not appear in
the 60-second cut:

- **`08-themes.mp4`** — theme switching was cut from Scene 7. The montage is
  three beats in six seconds; a fourth would have pushed each below two seconds
  and made the closing stretch feel frantic, against the brief's motion rules.
  All eight themes are free on every tier, so nothing about the offer is lost
  by leaving it out. It is captured and available if the montage is ever given
  more room, and it is a natural standalone clip for social.
- **`09-mobile-timer.png`** — Scene 5 uses `10-mobile-room.png` for its phone
  bezel because that scene is about the *shared* timer, and the room view is
  what shows it. The mobile timer shot is kept for the vertical cut's future
  revisions and for still marketing.

Both are still produced by the capture script and still checked on the contact
sheet, so neither is a gap in coverage — they are held in reserve.

## Not yet captured

Everything in the table above is currently a **generated placeholder**
(`npm run placeholders`). No real capture session has run, because it requires
a signed-in demo account that has not been provided yet. `scripts/preflight.mjs`
blocks rendering until real captures replace them.

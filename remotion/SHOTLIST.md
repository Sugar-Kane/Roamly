# Shot list

Which capture feeds which scene, and what each one has to show. Produced by
`scripts/capture-shots.mjs`; reviewed via `npm run contact-sheet`.

## Timeline

| # | Scene | In–out | Captures used |
| --- | --- | --- | --- |
| 1 | The feeling | 0:00–0:07 | *(none — typography only)* |
| 2 | The timer | 0:07–0:16 | `01-focus-timer.png` |
| 3 | The methods | 0:16–0:24 | `02-methods.png` |
| 4 | AI from your notes | 0:24–0:34 | `03-upload.webm` |
| 5 | You're not studying alone | 0:34–0:44 | `04-room.webm`, `10-mobile-room.png` |
| 6 | Breaks without guilt | 0:44–0:50 | *(none — gradient wash)* |
| 7 | Progress you can see | 0:50–0:56 | `05-analytics.png`, `06-garden.png`, `08-themes.webm` |
| 8 | Close | 0:56–1:00 | `roamly-logo.png`, `qr.png` (generated) |

## Captures

| File | Kind | Scene | Must show |
| --- | --- | --- | --- |
| `01-focus-timer.png` | still | 2 | Timer mid focus block, task list visible beside it |
| `02-methods.png` | still | 3 | Method picker open, PA presets visible |
| `03-upload.webm` | 8–12s | 4 | Choose file → processing → generated task list appears |
| `04-room.webm` | 8–12s | 5 | Live room, shared countdown ticking, participants visible |
| `05-analytics.png` | still | 7 | Analytics with real weekly history |
| `06-garden.png` | still | 7 | Companions / garden with unlocked pets |
| `08-themes.webm` | 6–10s | 7 | Cycling six themes, so the palette visibly changes |
| `09-mobile-timer.png` | still | reserve | Timer at 390x844 |
| `10-mobile-room.png` | still | 5 | Same room as `04-room.webm`, at 390x844 |

## Captured but not placed

One shot the brief asks for is captured and reviewed, but does not appear in
the 60-second cut:

- **`09-mobile-timer.png`** — Scene 5 uses `10-mobile-room.png` for its phone
  bezel because that scene is about the *shared* timer, and the room view is
  what shows it. The mobile timer shot is kept for the vertical cut's future
  revisions and for still marketing.

It is still produced by the capture script and still checked on the contact
sheet, so it is not a gap in coverage — it is held in reserve.

## Dropped: picture-in-picture

The brief asks for a clip of the floating PiP timer. **It cannot be captured
with this pipeline, and the feature is not in the video.**

Document Picture-in-Picture opens a separate OS-level window. Playwright records
the page viewport only, so a recording of the flow shows the page the timer just
left — never the floating timer itself. The first capture run produced exactly
that: a clip that did not show its subject.

Scene 7's third beat is theme cycling instead. If PiP is wanted later it needs a
screen recorder (macOS `screencapture`, OBS) driven by hand, not Playwright.

## Not yet captured

Everything in the table above is currently a **generated placeholder**
(`npm run placeholders`). No real capture session has run, because it requires
a signed-in demo account that has not been provided yet. `scripts/preflight.mjs`
blocks rendering until real captures replace them.

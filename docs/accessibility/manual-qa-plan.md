# Manual Accessibility QA Plan

**Last updated:** 2026-07-21

Automated scans catch ~30–40% of WCAG issues. These journeys **must** be walked
by a human with a keyboard and a screen reader. This plan is the template; record
results in the table at the bottom (copy a row per run).

## Environments to cover

- **Screen readers:** VoiceOver (macOS + Safari; iOS + Safari) and NVDA (Windows + Firefox and/or Chrome).
- **Keyboard-only:** no mouse/trackpad — Tab, Shift+Tab, Enter, Space, Escape, Arrows, Home/End.
- **Zoom/reflow:** browser zoom 200% and 400%; 320px-wide viewport; portrait + landscape; text-spacing bookmarklet (WCAG 1.4.12).
- **Reduced motion & color-blind mode:** toggle both in Settings and re-check status cues.

## Journeys (walk each keyboard-only, then with a screen reader)

1. Homepage → reach **Sign up** without a mouse.
2. Create an account.
3. Verify email / complete the supported auth flow (magic link or password).
4. Log in; recover a password.
5. Focus session: **start, pause, resume, reset, skip, complete** a block; confirm completion is announced (not only sound/animation).
6. Adjust **timer + sound** settings (volume, mute, method, custom durations).
7. Task: **create, edit, complete, reorder (keyboard), delete**; confirm status cues aren't color-only.
8. **Upload** a document; confirm progress + processing + errors are announced; review generated study content structure (headings/lists).
9. Join and use a **study room**; confirm participant list, join/leave, connection loss are perceivable and not spammy.
10. **Analytics**: read data via chart *and* its text/table alternative; reach tooltips by keyboard.
11. **Change + save a theme**; confirm preference persists and focus ring stays visible.
12. Start a **Premium** subscription (reach Stripe checkout with keyboard/SR).
13. **Manage / cancel** a subscription (confirm cancel isn't harder than signup).
14. Submit **feedback / an accessibility report**.
15. Repeat the core loop on a **real phone**.

## What to check on every screen

- Logical focus order; visible focus on every control; no keyboard trap; no hidden focusable elements.
- One descriptive `h1`; sensible heading order; landmarks present and named.
- Every control has an accurate accessible name; icon-only buttons labeled.
- Dialogs: focus moves in, stays trapped, returns on close; Escape closes; background inert.
- Errors: associated with the field, announced, explain the fix, not color-only; valid input preserved on failed submit.
- Status updates (save, upload %, room events) announced politely, not disruptively.
- Route change communicates the new page/heading and updates the title.

## Results log (copy a row per test)

| Date | Journey / route | Device | OS | Browser | Screen reader | Result (pass/fail) | Defect severity | Evidence | Fix status | Retest |
|------|-----------------|--------|----|---------|--------------|--------------------|-----------------|----------|-----------|--------|
| _2026-07-21_ | _(example) Home → Signup, keyboard only_ | _MacBook_ | _macOS 15_ | _Safari 18_ | _VoiceOver_ | _PENDING — not yet run_ | — | — | — | — |

> **Current status:** The full manual SR matrix has **not yet been executed** in
> this pass. It is the largest residual gap to a defensible AA claim and should be
> completed by a qualified tester before any public conformance statement.

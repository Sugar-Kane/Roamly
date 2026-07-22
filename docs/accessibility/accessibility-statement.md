# Accessibility Statement (source copy)

This is the source copy for the public statement published at `/accessibility`
(`public/accessibility.html`). Keep the two in sync; update the date on both when
either changes.

---

## Accessibility at Roamly Flow

**Last updated:** 21 July 2026. Accessibility work at Roamly Flow is ongoing.

### Our commitment
We want Roamly Flow to be usable by everyone, including people who rely on
assistive technologies such as screen readers, screen magnifiers, keyboard-only
navigation, and voice control.

### The standard we aim for
We are working toward conformance with **WCAG 2.2, Level AA**, using automated
tooling (axe-core in our test suite) and manual review. We **do not yet claim
full conformance**: some areas are still undergoing manual assistive-technology
testing, and some depend on third-party services we integrate but don't control.

### What we've done
- Keyboard-accessible navigation, timer, tasks, and dialogs; a "Skip to content" link; visible keyboard focus across all themes.
- Dialogs that trap focus, restore it on close, and close with Escape.
- A reduce-motion setting plus support for the system "reduce motion" preference.
- A color-blind-friendly mode (blue/orange timer and status colors).
- Labeled form fields and error messages; accessible names on icon-only controls.
- Automated accessibility checks on every code change.

### Known limitations
- Full screen-reader passes (VoiceOver, NVDA) across every workflow are in progress.
- Embedded Spotify/Apple Music, Stripe checkout, and Supabase auth screens are third-party; their internals are outside our direct control.
- Content inside uploaded documents (e.g. scanned image-only PDFs) may lack an accessible text alternative if the original does.

### Report a barrier
Use **Help & Legal → Contact support / send feedback** in the app, or email
**support@roamlyflow.com**. Please include: the page/feature, your device and OS,
your browser and version, any assistive technology, and what you expected vs. what
happened. We aim to **acknowledge reports within 5 business days** and prioritize
anything that blocks an essential task.

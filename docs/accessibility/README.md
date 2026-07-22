# Roamly Flow Accessibility Documentation

This folder is the home for Roamly Flow's accessibility program: the audit, test
evidence, third-party risk, remediation history, and the internal process. The
public-facing statement lives at `/accessibility` (`public/accessibility.html`).

| Document | Purpose |
|----------|---------|
| [`audit.md`](./audit.md) | WCAG 2.2 AA audit, findings by severity (Critical/High/Medium/Low). |
| [`theme-contrast.md`](./theme-contrast.md) | Color-contrast results per theme + recommended (approval-gated) fixes. |
| [`third-party-risk-register.md`](./third-party-risk-register.md) | Stripe, Supabase, Spotify, Apple Music, Rive, etc. — control boundaries & limitations. |
| [`response-process.md`](./response-process.md) | Internal process to log, triage, fix, and respond to barrier reports. |
| [`manual-qa-plan.md`](./manual-qa-plan.md) | Keyboard + screen-reader test matrix and results log. |
| [`remediation-log.md`](./remediation-log.md) | Chronological record of fixes, SC addressed, verification. |
| `accessibility-statement.md` | Source copy for the public statement at `/accessibility`. |

## Automated testing

- `tests/a11y.spec.ts` — axe-core scans of core routes, overlays, and all themes. Runs in CI via `npm run test`.
- All serious/critical violations **hard-fail** the build, **including `color-contrast`** (`CONTRAST_GATE = true`). All 46 tests pass across both projects and all six themes.

## Status at a glance (2026-07-21)

- ✅ Strong baseline: skip link, focus-trapped dialogs, per-route titles, reduce-motion, color-blind mode, labeled controls.
- ✅ Added: global focus-visible floor, axe CI scanning (contrast enforced), tab keyboard model, keyboard-focusable scrollable tables, public statement + reporting path, docs.
- ✅ **Theme color contrast: fixed and enforced** across all six themes (see `theme-contrast.md`).
- ✅ **Analytics charts: accessible alternatives** — screen-reader data table for the weekly chart, text legend for the donut, labeled admin charts.
- ⚠️ **Not done:** full manual VoiceOver/NVDA passes, aesthetic review of deepened palettes, full data tables for admin BI charts.
- ❌ **Do not** claim full WCAG 2.2 AA conformance until the manual AT passes are complete and reviewed by a qualified specialist + legal counsel.

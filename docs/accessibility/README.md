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
- Non-contrast serious/critical violations **hard-fail** the build.
- Color-contrast findings are **reported** to `test-results/a11y-contrast-report.jsonl` and tracked in `theme-contrast.md` (fixes gated on design approval; flip `CONTRAST_GATE` in the spec once palette is fixed).

## Status at a glance (2026-07-21)

- ✅ Strong baseline: skip link, focus-trapped dialogs, per-route titles, reduce-motion, color-blind mode, labeled controls.
- ✅ Added: global focus-visible floor, axe CI scanning, tab keyboard model, public statement + reporting path, docs.
- ⚠️ **Not done:** theme color-contrast fixes (design approval needed), full manual VoiceOver/NVDA passes, chart text alternatives.
- ❌ **Do not** claim full WCAG 2.2 AA conformance until the above are resolved and reviewed by a qualified specialist + legal counsel.

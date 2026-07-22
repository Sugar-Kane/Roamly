# Accessibility Remediation Log

**Last updated:** 2026-07-21

Chronological record of accessibility changes, the WCAG SC addressed, and how
each was verified. Append new entries; do not rewrite history.

## 2026-07-21 — Audit + baseline hardening pass

| Change | Files | WCAG SC | Rationale | Verification |
|--------|-------|---------|-----------|--------------|
| Global theme-aware `:focus-visible` floor so every keyboard-focused interactive element has a visible indicator using the active theme's `--ring`. | `src/index.css` | 2.4.7, 1.4.11 | Some icon-only controls/links lacked their own focus style; guarantees a visible, theme-contrasting ring on keyboard focus only (not mouse). Additive — component styles still win. | Build passes; visual check across themes; existing skip-link/focus tests still green. Keyboard-only spot check recommended. |
| Added axe-core automated scanning across core routes, overlays, and all 6 themes; wired into existing CI (`npm run test`). | `tests/a11y.spec.ts`, `package.json` (`@axe-core/playwright`, `axe-core`) | 1.1.1, 1.3.1, 1.4.3, 4.1.2 (detection) | No automated a11y scan existed; prevents regressions in names, ARIA, labels, ids. | Suite runs in CI; non-contrast serious/critical gate is enforced and passing. |
| ARIA tabs keyboard model (Arrow/Home/End + roving tabindex) and `tabpanel` wiring on the Help & Legal tablist. | `src/HelpLegal.tsx` | 2.1.1, 4.1.2 | Tabs had `role="tab"`/`aria-selected` but no keyboard model. | New assertions in `tests/a11y.spec.ts` (help & legal drawer test). |
| Public accessibility statement + reporting path; footer link; in-app Help drawer link; sitemap entry. | `public/accessibility.html`, `src/App.tsx`, `src/HelpLegal.tsx`, `public/sitemap.xml` | 3.2.3 (discoverability), program requirement | No statement/reporting path existed. Includes commitment, WCAG 2.2 AA target, known limitations, report channel + fields, 5-business-day acknowledgement. | Static page passes axe (after inline-link underline fix); linked from footer + Help drawer. |
| Inline links on the accessibility page underlined so they're distinguishable without color. | `public/accessibility.html` | 1.4.1 | axe `link-in-text-block` (link vs text contrast 1.96:1). | Static-page axe scan passes. |
| Documentation set: audit, theme-contrast results, third-party risk register, response process, manual QA plan, this log. | `docs/accessibility/*` | Program requirements (Phases 18–21) | Establishes evidence trail and backlog. | N/A (docs). |

## 2026-07-21 — Theme color-contrast remediation (follow-up)

| Change | Files | WCAG SC | Rationale | Verification |
|--------|-------|---------|-----------|--------------|
| Darkened `--muted-foreground` in all light themes; darkened `--primary`/`--ring` (+ ring hex) for Coffee/Sage/Sunset/Ocean; left `--roamly-*` gradient tokens and the Library dark-theme ring untouched to preserve identity. | `src/data.ts`, `src/index.css` | 1.4.3, 1.4.11 | Bulk of contrast failures were muted body text and white-on-primary; fixing tokens (not the hero gradient) preserves hue/vibrancy. | axe `color-contrast` = 0 across all 6 themes, both projects. |
| Hardcoded `text-white` on solid `bg-primary` → `text-primary-foreground`; ring-backed hero buttons use new `readableTextOn(ring)`. | `src/App.tsx`, `src/StudyInsights.tsx`, `src/data.ts` | 1.4.3 | Per-theme accessible label color (dark on Library's bright ring, white on darkened light-theme rings, correct on the color-blind override). | axe pass; smoke suite green. |
| Static Pomodoro page purple button/CTA darkened (`#7c6cff` → `#6a54f0`). | `public/pomodoro-timer.html` | 1.4.3 | White label on the toggle was 3.85:1. | Static-page axe pass. |
| Enabled the contrast gate. | `tests/a11y.spec.ts` | — | Contrast now hard-fails CI alongside other serious/critical issues; regressions can't ship. | `CONTRAST_GATE = true`; 46/46 pass. |

## 2026-07-22 — Analytics chart accessible alternatives

| Change | Files | WCAG SC | Rationale | Verification |
|--------|-------|---------|-----------|--------------|
| `WeekChart` ("Focus minutes by day") now renders a visually-hidden data table (captioned, day → minutes) beside the SVG, and hides the SVG from AT. | `src/Charts.tsx` | 1.1.1, 1.3.1 | The bar chart + pointer-only tooltip was the only way to read per-day minutes. | New smoke test asserts the captioned table + Minutes column + a minutes cell; analytics axe scan green. |
| `SubjectDonut` SVG hidden from AT; its existing visible name + percentage legend is the text alternative. | `src/Charts.tsx` | 1.1.1 | Donut conveyed no text; the adjacent list already carries the values. | axe green. |
| Admin trend/stacked/activity charts wrapped in `role="img"` with descriptive labels. | `src/Charts.tsx` | 1.1.1 | They were unlabeled SVGs; full data tables are a future enhancement for the admin BI views. | Build/lint green. |

### Tracked, NOT yet fixed (require human specialist)

- **Full VoiceOver + NVDA manual passes** — see `manual-qa-plan.md`. Not yet executed. **The top remaining gap to a defensible AA claim.**
- Full data tables for the admin BI charts (currently `role="img"` labels only) — lower priority (admin-gated).
- Aesthetic/perceptual review of the deepened Sage/Sunset/Ocean palettes (automated 4.5:1 met; human sign-off advisable).

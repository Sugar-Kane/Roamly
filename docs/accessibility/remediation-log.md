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

### Tracked, NOT yet fixed (require design/human approval)

- **Color contrast across themes** (WCAG 1.4.3) — see `theme-contrast.md`. Reported by the axe suite on every run and written to `test-results/a11y-contrast-report.jsonl`, but not hard-gated because fixes are palette changes needing design sign-off. **Top gap to full AA.**
- **Full VoiceOver + NVDA manual passes** — see `manual-qa-plan.md`. Not yet executed.
- **Chart text/table alternatives** (Analytics) — recommended, not yet built.

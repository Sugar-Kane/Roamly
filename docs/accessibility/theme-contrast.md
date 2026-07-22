# Theme Color-Contrast Results (WCAG 1.4.3 / 1.4.11)

**Last updated:** 2026-07-21
**Method:** axe-core 4.x (`color-contrast` rule) via `tests/a11y.spec.ts`, run against the production build across all core routes, overlays, and all six themes, on both mobile and desktop projects. Ratios below are axe-reported.

> **Status: RESOLVED.** The palette was remediated (see "Remediation" below) and
> the automated suite now **enforces** contrast: `CONTRAST_GATE = true` in
> `tests/a11y.spec.ts`. All 46 axe tests (both projects, all six themes) pass with
> zero `color-contrast` violations. Any future regression fails the build.
> This section is retained as the record of what was found and how it was fixed.

## Final result (after remediation)

| Theme | id | axe contrast result |
|-------|-----|---------------------|
| Coffee Shop (default) | `coffee` | ✅ Pass |
| White Coat | `whitecoat` | ✅ Pass |
| Library Night (dark) | `library` | ✅ Pass |
| Sage Calm | `sage` | ✅ Pass |
| Sunset Study | `sunset` | ✅ Pass |
| Ocean Desk | `ocean` | ✅ Pass |

## Remediation applied

Guiding principle: preserve each theme's **hue** and the hero `gradient-primary`
CTAs; adjust only what AA requires.

- **`--muted-foreground`** darkened in every light theme (e.g. Coffee `27 18% 48%` → `27 20% 40%`) so small body text clears 4.5:1 on cards. Fixed the ~150-node bulk.
- **`--primary` / `--ring`** (and the `ring` hex) darkened for the light themes (Coffee `24 30% 51%` → `24 33% 40%`; Sage → `152 38% 34%`; Sunset → `13 62% 42%`; Ocean → `197 63% 35%`) so white-on-primary buttons/badges **and** `text-primary` labels both clear 4.5:1. The `--roamly-purple/coral/blue` gradient tokens were left untouched, so the signature hero gradient keeps its vibrancy.
- **Library (dark theme)** primary/ring left bright (it contrasts on the dark surface); its buttons use the theme's dark `--primary-foreground`.
- **Hardcoded `text-white` on solid `bg-primary`** switched to the theme-aware `text-primary-foreground` token (`App.tsx`, `StudyInsights.tsx`).
- **Ring-backed hero buttons** (timer Start/Pause, count-up) now compute their label color with `readableTextOn(ring)` in `src/data.ts` — white or near-black, whichever meets contrast — which also covers the color-blind override ring.
- **Static Pomodoro page** button/CTA purple darkened (`#7c6cff` → `#6a54f0`).

## Original root-cause failing pairs (pre-fix, for the record)

## Root-cause failing pairs

Most of the ~150 flagged nodes trace to a small number of tokens:

| # | Foreground | Background | Ratio | Needs | Token / cause | Themes | Recommended fix (needs design approval) |
|---|-----------|-----------|-------|-------|---------------|--------|------------------------------------------|
| C1 | `#907864` | `#fbf8f4` (and near-white cards) | 3.92:1 | 4.5:1 | `--muted-foreground` small body text | Coffee | Darken `--muted-foreground` from `27 18% 48%` → ~`27 20% 40%` (keeps hue, reaches ≥4.5:1). Highest-impact single fix. |
| C2 | `#ffffff` | `#a87c5a` | 3.68:1 | 4.5:1 | White text on `--primary` (small text on primary buttons/badges) | Coffee | Either darken `--primary` (`24 30% 51%`→~`24 32% 42%`) or reserve white-on-primary for ≥18.66px bold text (which needs only 3:1). |
| C3 | `#ffffff` | `#d96c4e` | ~3.4:1 | 4.5:1 | White on coral (`--roamly-coral`) small text | Coffee/Sunset | Darken coral for text use, or use it only for large/bold text and non-text UI (3:1). |
| C4 | `#ffffff` | `#a78bfa` | ~3.0:1 | 4.5:1 | White on Library `--primary` purple, small text | Library | Reserve for large/bold text; use `--foreground` on light chips instead. |
| C5 | `#ffffff` | `#7c6cff` | ~3.9:1 | 4.5:1 | White on purple accent, small text | Library/Sage | As C4. |
| C6 | `#ffffff` | `#4f9d78` | ~3.0:1 | 4.5:1 | White on green (`--roamly-green`/accent) small text | Sage/Library | Darken green for text, or large/bold only. |

Note: near-identical hex pairs in the raw report (e.g. `#a87c5a`/`#a87b5d`, `#4f9d78`/`#4f9c78`) are sub-pixel anti-aliasing variants of the same token.

## Interpretation

- **C1 (muted text)** is the biggest win and the safest change: a small lightness reduction on one token, no hue change, fixes the majority of nodes across every surface. Strongly recommended.
- **C2–C6 (white on brand colors)** are the classic "small white text on a saturated brand color" AA gap. Two acceptable resolutions per WCAG:
  1. Darken the brand color used *behind text* (may shift identity slightly), or
  2. Only place white text on those colors at **large** size (≥24px, or ≥18.66px bold), where the requirement drops to 3:1 — most already pass at large sizes.
- Non-text UI (borders, icons, focus rings) must meet **3:1** (WCAG 1.4.11). The new global focus ring uses `--ring`, which should be spot-checked per theme.

## Outcome

The remediation above was applied and approved, `CONTRAST_GATE` is now enforced,
and axe reports **zero color-contrast violations across all six themes** on both
mobile and desktop. Color contrast is no longer a gap to AA under automated
testing.

Remaining caveat: axe measures programmatic color pairs only. A human should still
spot-check the deepened Sage/Sunset/Ocean palettes for aesthetic acceptability and
confirm perceptual legibility with real users; automated 4.5:1 conformance is
necessary but not a substitute for design review.

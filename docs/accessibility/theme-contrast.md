# Theme Color-Contrast Results (WCAG 1.4.3 / 1.4.11)

**Last updated:** 2026-07-21
**Method:** axe-core 4.x (`color-contrast` rule) via `tests/a11y.spec.ts`, run against the production build on the Focus route for each of the six themes, plus core routes and overlays on the default (Coffee) and Library themes. Ratios below are axe-reported.

> **Status:** These are **unresolved** findings. Fixing them requires editing
> theme palette tokens in `src/data.ts` / `src/index.css`, which is a
> visual-identity change **gated on design + human approval** (project rule 9).
> The automated suite therefore *reports and tracks* these (see
> `test-results/a11y-contrast-report.jsonl`) but does not yet hard-fail on them.
> Flip `CONTRAST_GATE = true` in `tests/a11y.spec.ts` once the palette is fixed.

## Themes tested

| Theme | id | Focus route contrast result |
|-------|-----|------------------------------|
| Coffee Shop (default) | `coffee` | ❌ Fails — muted text + white-on-primary |
| White Coat | `whitecoat` | ✅ Passed the automated Focus-route scan |
| Library Night (dark) | `library` | ❌ Fails — white-on-primary/accent |
| Sage Calm | `sage` | ❌ Fails |
| Sunset | `sunset` | ❌ Fails |
| Ocean | `ocean` | ✅ Passed the automated Focus-route scan |

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

## Recommendation

Bring a designer in to approve: (a) the `--muted-foreground` darkening across all themes, and (b) a rule that white-on-brand-color text is only used at large/bold sizes. Then re-run `npx playwright test tests/a11y.spec.ts` and enable `CONTRAST_GATE`.

Until then, **Roamly Flow cannot claim WCAG 2.2 AA for color contrast.** This is the single largest gap to full AA and is flagged in the executive summary as a top legal-risk item.

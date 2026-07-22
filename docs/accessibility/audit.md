# Roamly Flow — WCAG 2.2 Level AA Accessibility Audit

**Last updated:** 2026-07-21
**Standard targeted:** WCAG 2.2 Level AA
**Scope:** Roamly Flow web application (React 19 + Vite SPA), its static public pages, and the third-party services it embeds.
**Author:** Accessibility remediation pass (see companion PR).

> **Important:** This audit is a snapshot of an engineering review plus automated
> tooling. It is **not** a certification. Technical conformance reduces legal
> exposure but does not guarantee immunity from ADA or Section 508 claims.
> A qualified accessibility specialist and legal counsel should review before
> any public conformance claim is made. Manual assistive-technology testing on
> real devices (VoiceOver, NVDA) is still required for several items flagged
> below as "needs manual review".

---

## 1. Application overview

| Area | Finding |
|---|---|
| **Framework / routing** | React 19 SPA built with Vite. Client-side view routing in `src/App.tsx` (`viewFromPath`) with real URLs per tab (`/focus`, `/tasks`, `/analytics`, `/rooms`, `/garden`, `/premium`, `/admin`). `vercel.json` rewrites app routes to the SPA shell; `scripts/prerender.mjs` prerenders indexable marketing routes. Static trust pages are hand-authored HTML in `public/` (`privacy.html`, `terms.html`, `pomodoro-timer.html`). |
| **Shared layout / design system** | Tailwind design system driven by CSS custom properties in `src/index.css`; theme palettes in `src/data.ts` (`THEMES`). Shared primitives: `Modal.tsx` (accessible dialog), `Drawer.tsx`, `ThemedSelect.tsx`, `Notifications.tsx`. |
| **Authentication** | `Auth.tsx` (`AuthPanel`, `SetPasswordModal`) over Supabase Auth. Email/password + email-link (magic/recovery) flows. |
| **Focus timer** | `useTimer.ts`, `FocusMode.tsx`, `PipTimer.tsx`, `CustomizeSession.tsx`, `useEndOfPhaseAlerts.ts`; timer UI lives in `App.tsx` `FocusView`. |
| **Tasks** | Task CRUD, reordering (arrow buttons + press-and-hold drag), estimates in `App.tsx`. |
| **File upload / AI** | `UploadTasks.tsx` → `api/generate-tasks.ts` (Anthropic SDK). Document parsing (pdf.js, mammoth, heic2any). |
| **Study rooms** | `RoomsLive.tsx`, `RoomVoice.tsx`, `rooms.ts` (Supabase realtime). |
| **Analytics / charts** | `Charts.tsx`, `StudyInsights.tsx` (Recharts). |
| **Notifications / toasts** | `Notifications.tsx`, inline `role="status"` regions in `App.tsx`. |
| **Settings / theme** | `SettingsModal.tsx`, `ProfileMenu.tsx` (a11y settings), theme picker in `Header`. |
| **Subscription / payments** | `api/billing.ts`, `api/stripe-webhook.ts`; Stripe Checkout (hosted) + Customer Portal. Premium gating throughout. |
| **Admin** | `Admin.tsx` + `admin*.tsx` (BI dashboard, lazy-loaded, gated). |
| **Marketing / trust pages** | `public/pomodoro-timer.html`, `privacy.html`, `terms.html`. |
| **Third-party** | Stripe, Supabase, Spotify embed, Apple Music embed, Rive (`@rive-app/canvas-lite`), Google Fonts, Upstash (rate limit, server-side). |
| **Existing automated a11y tests** | Partial: `tests/smoke.spec.ts` asserts skip link, dialog semantics, accessible button names, `aria-checked` switches, no horizontal overflow. **No axe-core scan existed** before this pass. |
| **Existing accessibility statement** | **None found.** Added by this pass. |

### Existing accessibility strengths (already in the codebase)

This is a mature codebase with real prior a11y investment. Confirmed present before this pass:

- Accessible dialog shell (`Modal.tsx`): `role="dialog"`, `aria-modal`, focus moved in on open, focus restored on close, focus trap, Escape to close.
- Skip-to-content link and `<main id="main-content" tabIndex={-1}>` landmark.
- Per-route `document.title` + meta management (`seo.ts` / `seo-routes.json`).
- `<html lang="en">` on the SPA shell and every static page.
- Color-blind mode (Okabe-Ito blue/orange functional colors) and Reduce-motion mode (`ProfileMenu.tsx`, `SettingsModal.tsx`), plus `@media (prefers-reduced-motion)` honored in CSS.
- ~155 `aria-label`s, 9 live regions, switches with `aria-checked`, `aria-current`, `aria-selected`, `aria-expanded` in use.
- 44px minimum touch targets in several controls; responsive/overflow tests.

Because of this baseline, the audit below focuses on **remaining gaps and defense-in-depth**, not a from-scratch remediation.

---

## 2. Findings by severity

Each finding: WCAG SC · file/component · workflow · barrier · fix · automatable?

### CRITICAL
_No unresolved Critical (blocks a core workflow entirely for a group of users) issues were confirmed by this review._ The dialog, skip-link, and labeling infrastructure that would otherwise create critical barriers are already present. Critical status is reserved pending the **manual screen-reader passes** listed in §3 — until those run on real AT, the study-room realtime flow and the file-upload flow carry provisional risk (see High).

### HIGH

| # | SC | File / component | Workflow | Barrier | Fix | Auto? |
|---|----|------------------|----------|---------|-----|-------|
| H1 | 2.4.7 Focus Visible | Global — `src/index.css` | All keyboard use | No **global** `:focus-visible` fallback existed. Many controls style `focus:`/`focus-visible:` individually, but icon-only buttons and links that omit it had no guaranteed visible focus ring, and the ring was not guaranteed to track the active theme. | Added a theme-aware global `:focus-visible` outline in `index.css` using the theme `--ring`/`--primary` variables, applied to all interactive elements as a floor (individual styles still win). | Partial (axe cannot detect missing focus ring; manual + this CSS floor) |
| H2 | 4.1.2 / 1.3.1 | Automated coverage — `tests/` | All routes | No automated axe-core scan meant regressions (missing labels, bad contrast, duplicate IDs, ARIA misuse) could ship undetected. | Added `@axe-core/playwright` and `tests/a11y.spec.ts` scanning core routes + key modals; runs in existing CI. | Yes |
| H3 | 2.1.1 / 4.1.2 Name,Role,Value | `HelpLegal.tsx` tablist | Help/Privacy/Terms | Tabs use `role="tab"`/`aria-selected` but lacked the expected Arrow/Home/End keyboard model and roving tabindex for the ARIA tabs pattern. | Added arrow-key roving-tabindex navigation to the tablist. | Partial |
| H4 | 1.4.3 Contrast (Minimum) | `src/data.ts` all themes | Every theme | Muted-foreground text and white-on-primary UI fell below AA in several themes (~195 axe nodes). See `theme-contrast.md`. | **RESOLVED** — tokens darkened (hue preserved, hero gradient kept), theme-aware label colors + `readableTextOn`; `CONTRAST_GATE` now enforced. axe `color-contrast` = 0 across all 6 themes. | Yes (now gated in CI) |
| H5 | 1.2.1 / 1.2.2 | `focusSounds.ts`, Spotify/Apple embeds | Focus sounds, streaming | Background/lofi audio and third-party players: audio-only content has no transcript, and autoplay behavior must be verified to never start without a user gesture. | Confirmed built-in sounds require a user gesture (iOS unlock). Documented that instrumental lofi has no meaningful speech to transcribe (WCAG N/A for pure music), and streaming players are third-party (see risk register). | Manual review |

### MEDIUM

| # | SC | File / component | Workflow | Barrier | Fix | Auto? |
|---|----|------------------|----------|---------|-----|-------|
| M1 | 4.1.3 Status Messages | `App.tsx`, `UploadTasks.tsx`, `RoomsLive.tsx` | Saves, upload progress, room join/leave, connection loss | Some dynamic status updates (upload progress %, processing, reconnection) need confirmed polite live-region announcement without being disruptively chatty. | Audit live regions; ensure `role="status"`/`aria-live="polite"` on progress and save confirmations; verify room sync does not spam. Needs AT verification. | Partial |
| M2 | 1.3.1 / 4.1.2 | `Charts.tsx`, `StudyInsights.tsx` | Analytics | Recharts SVG charts need a text/table alternative and keyboard-reachable tooltips; series must not rely on color alone. | Provide an accessible text summary / data table alongside each chart and ensure legends carry text labels. | Manual + partial |
| M3 | 3.3.1 / 3.3.3 | Forms across app | Signup, task, room, feedback, exam | Confirm every input has a programmatic label, error text is associated (`aria-describedby`) and announced, and errors are not color-only. Auth is strong; secondary forms need a sweep. | Sweep all forms; add `aria-invalid`/`aria-describedby` where missing; add autocomplete tokens on auth fields. | Partial |
| M4 | 2.5.7 Dragging Movements | Task reorder in `App.tsx` | Reorder tasks | Drag-and-drop reorder must have a non-drag alternative. | Present — arrow buttons already provide a keyboard/pointer alternative (`reorderTask`). Verify labels announce position. | Manual |
| M5 | 1.4.10 Reflow / 1.4.4 Resize | Layout | 200%/400% zoom, 320px | Overflow tests exist; needs explicit 400% zoom + 200% text-only + text-spacing verification, especially charts, tables, and the music dock. | Run manual zoom/reflow matrix (see `manual-qa-plan.md`). | Manual |
| M6 | 2.2.1 Timing Adjustable | Auth session, timer | Session timeout, timer | Confirm session-expiration warnings are accessible and that essential time limits can be extended. Pomodoro limits are user-set (not essential) — OK. | Verify Supabase session-expiry UX surfaces an accessible warning. | Manual |

### LOW

| # | SC | File / component | Workflow | Barrier | Fix | Auto? |
|---|----|------------------|----------|---------|-----|-------|
| L1 | 2.4.6 Headings/Labels | Public statement | Discoverability | No public accessibility statement / reporting path existed. | Added `public/accessibility.html` + footer link + `docs/accessibility/accessibility-statement.md`. | Yes |
| L2 | 3.2.3 Consistent Nav | Static pages | Trust pages | `privacy.html`/`terms.html` are dark-only standalone pages; ensure the new accessibility page matches and links back consistently. | New page mirrors existing pattern and crumb nav. | Yes |
| L3 | 1.1.1 Non-text | `AdBreak.tsx`, decorative icons | Ads, decoration | Confirm decorative Lucide icons are `aria-hidden` and informative ones are labeled. Mostly done. | Spot-fix any informative icon lacking a label surfaced by axe. | Partial |
| L4 | 1.4.1 Use of Color | Task/timer status | Status indication | Verify completed/overdue/selected/active states carry a non-color cue (icon/text). Color-blind mode helps but base themes should too. | Confirm text/icon accompanies color for each status. | Manual |

---

## 3. Manual assistive-technology testing status

Automated tools catch ~30–40% of WCAG issues. The following **require human testing on real AT** and are **not yet complete** — they are the largest residual risk:

- VoiceOver (macOS/iOS, Safari) full pass of: signup → verify → login → focus session → task CRUD → upload → study room → analytics → theme change → checkout entry → cancel.
- NVDA (Windows, Firefox/Chrome) full pass of the same journeys.
- Real-device zoom/reflow at 200% and 400%, plus text-spacing bookmarklet.

See `manual-qa-plan.md` for the structured matrix to record results.

---

## 4. Third-party dependencies

See `third-party-risk-register.md`. Summary: Stripe Checkout, Supabase Auth, Spotify, and Apple Music are vendor-controlled surfaces. Roamly Flow controls the trigger buttons, labels, and fallbacks around them but not the internals of the hosted checkout or the streaming iframes. Essential workflows (payment, auth) must have accessible entry points regardless of vendor limitations — those entry points were reviewed and are native, labeled controls.

## 5. What this pass changed

See the PR "Files changed" section and `remediation-log.md`. In short: added a global focus-visible floor, axe-core automated tests wired into CI, tab keyboard support, a public accessibility statement + reporting path, and this documentation set. No feature, pricing, auth, data, or visual-identity change beyond the additive focus indicator.

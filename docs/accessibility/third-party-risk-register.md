# Third-Party Accessibility Risk Register

**Last updated:** 2026-07-21

For each integration: what Roamly Flow controls, what the vendor controls, known
limitations, available configuration, and whether an accessible alternative is
needed. Third-party ownership is **not** an excuse to ignore a barrier in an
essential workflow — where a vendor surface is unavoidable, the entry point and a
fallback must be accessible.

| Service | Roamly Flow controls | Vendor controls | Known a11y limitations | Config / mitigation | Accessible alternative needed? |
|---------|----------------------|-----------------|------------------------|---------------------|-------------------------------|
| **Stripe Checkout / Customer Portal** | The trigger buttons ("Go Premium", "Manage subscription"), their labels, loading/error states, and return-to-app handling (`api/billing.ts`, `App.tsx`). | The entire hosted checkout & billing-portal UI. | We can't audit or patch Stripe's internal DOM. Stripe's hosted checkout is generally reasonably accessible but is outside our test coverage. | Use Stripe's hosted checkout (maintained, keyboardable) rather than custom card fields — already the case. Card details never enter our DOM. Ensure our entry buttons are native, labeled, keyboard-reachable. | No custom payment UI. Monitor Stripe's accessibility; escalate to Stripe support if a barrier is found. **Cancellation is via the same portal as signup — not made harder.** |
| **Supabase Auth** | Our own auth forms (`Auth.tsx`) for email/password; email-link handling. Labels, errors, autocomplete, paste support are ours. | Server-side auth; any Supabase-hosted email templates/links. | Auth UI is ours (good — we control accessibility). Email-verification / magic-link emails are plain and should stay so. | Keep native inputs with labels + autocomplete; allow paste; support password managers. Verify session-expiry surfaces an accessible warning. | No — auth UI is first-party and remediable in our code. |
| **Spotify embed** (`SpotifyEmbed.tsx`, `spotify.ts`) | Whether/when the iframe mounts, its `title`, the surrounding dock controls and labels, and that it never autoplays without a user gesture. | The player UI inside the iframe. | Iframe internals are not keyboard/AT-auditable by us; controls inside are Spotify's. | Iframe has an accessible `title="Music player"`. Music is **optional** and gated behind a user action. Built-in first-party focus sounds are the accessible alternative. | Alternative exists (built-in sounds). Streaming is non-essential enhancement. |
| **Apple Music embed** (`appleMusic.ts`) | Same as Spotify — mount timing, iframe `title`, dock controls. | Player UI inside the iframe (no play-detection API). | Same as Spotify; also no JS play-detection, so cross-pausing is best-effort. | Titled iframe; optional; user-initiated. | Alternative exists (built-in sounds). Non-essential. |
| **Rive animations** (`@rive-app/canvas-lite`, `PetCanvas.tsx`) | Whether companions render (off by default, opt-in), and reduced-motion handling. | The canvas rendering. | Canvas content is not exposed to AT; purely decorative pets/plants. | Off by default; respects reduce-motion (`a11y.reduceMotion` passed to `PetStage`). Decorative — no essential info conveyed. | No — decorative only; ensure it stays non-essential and `aria-hidden`/off the a11y tree. |
| **Google Fonts** (`index.css` `@import`) | Font choice and fallbacks. | Font file hosting. | Network dependency; no direct a11y barrier. Text remains real, selectable, resizable. | Ensure system-font fallbacks in the stack. | No. |
| **Anthropic API** (`api/generate-tasks.ts`, `api/motivation.ts`) | How generated content is rendered (headings/lists), server-side only. | Model output. | Generated study content must render with semantic headings/lists, not flat text. | Render AI output into semantic HTML; validate structure. | No vendor UI; our rendering is remediable. |
| **Upstash (rate limiting)** | Server-side only. | — | None (no UI). | — | No. |
| **CAPTCHA / anti-bot** | — | — | **None currently integrated.** If added later, must use an accessible CAPTCHA (e.g. audio + visual, or invisible/risk-based) — never image-only. | If introduced, require an accessible alternative before shipping. | N/A today; flagged for the future. |
| **Advertising** (`AdBreak.tsx`) | This appears to be a first-party "ad break" prompt/submission, not a third-party ad network. | — | If real third-party ad tags are ever added, they carry their own a11y risk (auto-playing, focus-stealing). | Keep first-party; if a network is added, audit separately. | N/A today. |

## Summary

The only **essential** workflows that touch a vendor surface are **payment (Stripe)** and **auth (Supabase)**. Auth UI is first-party and fully remediable. Payment uses Stripe's hosted, maintained checkout with first-party, accessible entry/exit points and no custom card UI. All streaming/animation integrations are **optional enhancements with accessible first-party alternatives**, so a vendor limitation there does not block any core task.

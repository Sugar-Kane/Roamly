# SEO and measurement

This is the operator reference for Roamly Flow's SEO setup. It records what is
implemented in the repo, the steps that must be done by hand in external
dashboards, and what to monitor over time.

## What is implemented in the codebase

- Canonical host is `https://www.roamlyflow.com` across `index.html`,
  `robots.txt`, `sitemap.xml`, and the runtime head manager (`src/seo.ts`).
- Per-view metadata (title, description, canonical, Open Graph, Twitter,
  robots) via `src/seo.ts`; private/app views are `noindex`.
- Public routes are prerendered to static HTML (`scripts/prerender.mjs`) using
  the shared source of truth `src/seo-routes.json`.
- Real 404s for unknown paths (`public/404.html` + explicit `vercel.json`
  rewrites).
- Structured data (JSON-LD): `Organization`, `WebSite`, `WebApplication` on the
  app shell; `WebApplication` + `BreadcrumbList` on the Pomodoro landing page.
- Public content pages: `/pomodoro-timer`, `/privacy`, `/terms` (static, in the
  sitemap, linked from the footer).
- A 1200x630 Open Graph image (`public/og-image.png`) with
  `summary_large_image` cards. Regenerate with `node scripts/make-og.mjs`.

## Site verification (set these to activate)

Verification tags are injected at build time only when the env var is set, so
no token lives in the repo (see `vite.config.ts`). In the Vercel project
environment variables, set either or both:

- `VITE_GSC_VERIFICATION` = the content value from the Google Search Console
  "HTML tag" verification method.
- `VITE_BING_VERIFICATION` = the content value from Bing Webmaster Tools.

Redeploy after setting them. With neither set, nothing is injected.

## Manual dashboard steps (require your accounts)

1. Confirm the production redirect: the non-canonical host (`roamlyflow.com`)
   should 301 to `https://www.roamlyflow.com`. Set this in the Vercel domain
   settings if it is not already.
2. Google Search Console: add the `https://www.roamlyflow.com` property, verify
   (via the env var above), and submit `https://www.roamlyflow.com/sitemap.xml`.
3. Bing Webmaster Tools: add and verify the site, or import from Search Console,
   then submit the same sitemap.
4. Re-scrape the key URLs in the social debuggers (Facebook Sharing Debugger,
   LinkedIn Post Inspector) so the new share image caches.
5. Validate structured data with the Rich Results Test and the Schema Markup
   Validator for `/` and `/pomodoro-timer`.
6. Optional: enable Core Web Vitals reporting (the Search Console "Core Web
   Vitals" report populates from field data once traffic arrives).

## Conversion measurement

Meaningful conversions are already captured, so no duplicate events were added:

| Conversion | Where it is recorded |
| --- | --- |
| Start a focus session | `app_events` name `timer_start` (and `count_up_complete`) |
| Complete a focus block | `app_events` name `focus_block_done` |
| Create a task | `app_events` name `task_add` |
| Join a study room | `app_events` name `room_join` (`room_host` for hosting) |
| Create an account | `profiles.created_at` (authoritative) |
| Start a Premium trial | `premium_entitlements` where `source = 'trial'` |
| Purchase Premium | `premium_entitlements` where `source = 'subscription'`; credit packs in `credit_ledger` |

These feed the admin dashboard directly: the Overview conversion funnel
(`signed up -> focused -> created a task -> started trial -> converted to
paid`), the Features table, and the Engagement page. `app_events` is
signed-in only and stores no study content, only short event names.

To attribute conversions to organic search specifically, use Search Console
landing-page and query reports alongside these product metrics; the app does
not attach traffic source to events.

## Metrics to monitor

- Search Console: total clicks and impressions, average position, and the
  query and landing-page breakdowns (watch `/`, `/pomodoro-timer`, `/premium`).
- Index coverage: indexed vs excluded pages; confirm app/admin routes stay out.
- Core Web Vitals: LCP, INP, CLS on mobile for the public routes.
- 404s and crawl anomalies in Search Console.
- Product funnel (from the admin dashboard): activation and trial-to-paid rate.

## Suggested 30-day content plan

Small and intent-led; expand only if the first pages gain traction. Keep the
free timer unwalled and avoid duplicating intent across pages.

- Week 1: measure the baseline (Search Console + a Lighthouse run on `/` and
  `/pomodoro-timer`). Ship no new pages; confirm indexing.
- Week 2: a "Pomodoro technique for studying" explainer that links to
  `/pomodoro-timer`, targeting how-to intent rather than the tool query.
- Week 3: a "study timer for students" or "focus timer" page only if Search
  Console shows those queries are distinct from the Pomodoro page; otherwise
  strengthen the existing page instead of adding a near-duplicate.
- Week 4: an exam-study-schedule or study-planner page that ties to the app's
  planner feature, with an internal link to Premium where relevant.

Review query data before creating each page so pages target real, distinct
demand rather than keyword variations.

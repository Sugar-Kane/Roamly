# Roamly Focus

A Pomodoro study platform for Physician Assistant students — solo focus timer, live shared-timer study rooms with voice and break-only chat, AI task generation from lecture notes, streaks and analytics, and a Stripe-powered Premium tier.

Live at the Vercel production URL configured for this repo (`main` auto-deploys).

## Architecture

```
Browser (React 19 + Vite SPA, src/)
  ├── Supabase JS (anon key) → Postgres + RLS, Auth, Realtime, Storage
  └── fetch /api/* (Bearer JWT) → Vercel serverless functions (api/)
        ├── Stripe   (checkout, billing portal, webhook)
        └── Anthropic (generate-tasks: notes → task list)
```

- **Authorization lives in Postgres Row-Level Security** (`supabase/schema.sql`). The browser talks to the database directly with the public anon key; RLS is the entire permission layer. Server functions use the service-role key (bypasses RLS) and re-check ownership themselves.
- **Room timers are wall-clock math** — a room's phase is derived from time since `started_at` (`room_phase()` in SQL, `roomPhaseAt` in `src/rooms.ts`), so no server ticks and every participant computes the identical countdown. Four always-on community rooms; Premium users can host up to 3 rooms (RLS-enforced), auto-reaped ~1 min after emptying (pg_cron sweep + heartbeats).
- **Premium** is a Stripe subscription. `profiles.is_premium` is flipped **only** by the webhook; column-level grants stop clients from self-upgrading.
- **AI uploads** (PDF/images/Word/PowerPoint/text) go to Supabase Storage (`study-uploads`, per-user folders), then `api/generate-tasks` has Claude extract a task list. Quotas: free 3/month, premium 10/month, plus a global monthly circuit-breaker bounding total spend.

## Repo layout

```
src/            React app (App.tsx is the shell + most views)
  db.ts         Supabase data layer      rooms.ts   rooms/friends/notifications
  focusSounds.ts WebAudio music engine   track.ts   usage telemetry
api/            Vercel functions: create-checkout-session, create-portal-session,
                stripe-webhook, invite, generate-tasks, health
supabase/       schema.sql (CANONICAL — full schema incl. RLS + RPCs)
                dated *.sql migration files (already folded into schema.sql)
                rooms_schema.sql (historical; superseded by schema.sql)
public/         static assets, bundled music (fetched by .github/workflows/fetch-music.yml)
```

## Environment variables

Copy `.env.example`. `VITE_*` values are public (client bundle); everything else is server-only — set them in Vercel without the `VITE_` prefix. `GET /api/health` reports which are present (booleans only).

## Local development

Node 18+.

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # tsc + vite build → dist/
npm run lint      # oxlint
npx playwright test   # smoke tests (requires a build; see playwright.config.ts)
```

Without Supabase env vars the app runs in local demo mode (no accounts/sync).

## Supabase setup

Run `supabase/schema.sql` in the SQL editor of a fresh project — it is idempotent and contains tables, RLS policies, RPCs, triggers, pg_cron room sweep, and realtime publication. Also required (dashboard): a **private** Storage bucket `study-uploads` with per-user-folder RLS, the pg_cron extension, and Auth providers (email + Google).

## Stripe setup

Create a subscription price (`STRIPE_PRICE_ID`), point a webhook at `/api/stripe-webhook` with events `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed` (`STRIPE_WEBHOOK_SECRET`), and activate the Customer Portal (Settings → Billing) for self-serve cancel.

## Anthropic setup

Set `ANTHROPIC_API_KEY` and add a monthly spend limit in the Anthropic console (Settings → Limits) as the hard cost backstop behind the in-app quotas.

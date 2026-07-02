# Roamly Focus

A premium Pomodoro study platform for Physician Assistant students. Built with React + TypeScript + Tailwind CSS + Vite.

This is the **frontend** (Phase 1). It runs fully on its own with mock data so you can click through the entire product. Backend services (auth, database, payments, real-time rooms) get wired in later — see "Roadmap" below.

## What's included

- **Focus timer** — 10 Pomodoro methods (Classic 25/5, Deep Work, Clinical 90/20, PANCE Drill, Marathon, Custom, and more), with focus/break cycling, cycle dots, and a gentle audio cue at the end of each phase.
- **Tasks** — add, tag (Pharm / Cardio / Clinical / PANCE / Anatomy), complete, and pick an active task to focus on.
- **Analytics** — weekly focus chart and stats, with a premium-gated subject breakdown.
- **Study rooms** — browse and join/leave live sessions (UI + mock data; real-time comes with the backend).
- **Premium** — subscription screen, ambient study themes, Spotify music embed, and feature gating throughout.

> Note: data resets on refresh — there's no backend yet, and the app keeps state in memory only. Persistence arrives in Phase 2.

## Run locally

Requires Node.js 18+.

```bash
npm install
npm run dev      # start dev server at http://localhost:5173
npm run build    # production build into /dist
npm run preview  # preview the production build
```

## Deploy to Vercel

You'll do these steps yourself (they involve your own accounts and credentials):

1. Push this folder to a new GitHub repository.
2. Go to vercel.com, sign in, and click **Add New → Project**.
3. Import your GitHub repo.
4. Vercel auto-detects Vite. Confirm these settings if asked:
   - **Framework Preset:** Vite
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. Click **Deploy**. That's it — you'll get a live URL.

No environment variables are needed for this frontend-only phase.

## Roadmap (Phase 2 — backend)

The PRD's full stack (Node/Express, PostgreSQL, Redis, Socket.IO, Stripe, JWT/OAuth) gets added incrementally. Each needs an account and secrets that you create and hold:

- **Database:** Neon or Supabase (PostgreSQL)
- **Cache / real-time presence:** Upstash (Redis)
- **Payments:** Stripe (the Premium screen is already structured for it)
- **Auth:** Google OAuth, or email + JWT
- **Real-time rooms:** Socket.IO server

When you're ready, set those up and I'll write the integration code and tell you exactly which environment variables go where.

## Live study rooms (Supabase)

Rooms are real-time when Supabase is connected (`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`):

- **Shared timers with zero server ticking** — a room's phase is derived from wall-clock
  time since its `started_at`, so every participant computes the identical countdown.
- **Four always-on community rooms** that cycle continuously, staggered so their breaks
  don't all land at once.
- **Friends & notifications** — pick a username, add classmates, get notified when a
  friend creates/joins a room or invites you to one.
- **Break-only chat** — the chat input unlocks during short/long breaks, and the database
  trigger `room_messages_break_only` enforces it server-side too.

Setup: run `supabase/schema.sql` first, then `supabase/rooms_schema.sql`, in
Supabase Dashboard → SQL Editor. The second file also seeds the 4 always-on rooms and
adds `rooms`, `room_messages`, and `notifications` to the realtime publication.

## Project structure

```
src/
  App.tsx           # views: Focus, Tasks, Analytics, Premium + app shell
  RoomsLive.tsx     # live rooms: lobby, synced room timer, presence, break-only chat
  Friends.tsx       # username setup, friend search/requests
  Notifications.tsx # header bell (friend requests, room invites/activity)
  rooms.ts          # room/friend/notification data layer + shared phase math
  useTimer.ts       # personal timer logic (phases, cycles, audio cue)
  data.ts           # methods, seed tasks, mock analytics, themes, demo rooms
  spotify.ts        # Spotify presets + link parsing for the Music panel
  index.css         # fonts + base styles
supabase/
  schema.sql        # profiles, focus_sessions, tasks (run first)
  rooms_schema.sql  # rooms, friendships, notifications, break-only chat (run second)
tailwind.config.js  # custom palette (ink / lamp / sage / clay) and fonts
```

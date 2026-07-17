-- Admin BI dashboard — Phase 3 read-only user-explorer detail RPCs.
--
-- Same security model as Phases 1-2 and every other admin_* RPC: SECURITY
-- DEFINER, gated by public.is_admin() inside the query, EXECUTE revoked from
-- public/anon. A non-admin (or the anon/service role with no auth.uid()) gets
-- zero rows. No schema, RLS, or PII changes — these only read existing tables.
--
-- These back the Users → user-detail drawer. The roster itself already has a
-- server-side paginated RPC (admin_list_users); this adds the single-user
-- profile + lifetime/30-day aggregates, a recent-event timeline keyed by
-- user_id (not the fuzzy text search the old admin_user_activity used), and a
-- daily focus/activity series for a small in-drawer sparkline.
--
-- Definitions reuse the Phase 1 conventions:
--   * Active = fired an app_event OR logged focus minutes.
--   * Activated = completed a focus block AND created a task, both within 7
--     days of signup (the approved activation definition).
--   * Premium "now" comes from the active entitlement with the furthest
--     expiry that currently spans now(), so source/expiry are authoritative
--     even when profiles.is_premium lags.
--   * focus_sessions.date is a bare per-user study day (documented caveat).

-- ---------------------------------------------------------------------------
-- 1) Single-user profile + lifetime and trailing-30-day aggregates.
-- ---------------------------------------------------------------------------
create or replace function public.admin_user_detail(p_user uuid)
returns table (
  id uuid, email text, username text, display_name text,
  is_premium boolean, is_admin_user boolean,
  created_at timestamptz, last_active timestamptz, first_active timestamptz,
  ai_credits int, ai_uploads_count int, ai_uploads_period text,
  premium_source text, premium_status text,
  premium_starts_at timestamptz, premium_expires_at timestamptz,
  cancel_at_period_end boolean,
  focus_minutes bigint, focus_days bigint, focus_blocks_done bigint,
  focus_minutes_30d bigint, active_days_30d bigint, events_30d bigint,
  tasks_created bigint, tasks_completed bigint,
  rooms_created bigint, room_joins bigint, note_uploads bigint,
  credit_purchases bigint, feedback_count bigint, error_count bigint,
  total_events bigint, activated boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with pe_now as (
    select source, status, starts_at, expires_at, cancel_at_period_end
    from premium_entitlements
    where user_id = p_user and status = 'active'
      and starts_at <= now() and expires_at > now()
    order by expires_at desc
    limit 1
  )
  select
    p.id, p.email, p.username, p.display_name,
    p.is_premium,
    exists (select 1 from admins a where a.user_id = p.id),
    p.created_at,
    (select max(e.created_at) from app_events e where e.user_id = p.id),
    (select min(e.created_at) from app_events e where e.user_id = p.id),
    coalesce(p.ai_credits, 0), coalesce(p.ai_uploads_count, 0), p.ai_uploads_period,
    (select source from pe_now), (select status from pe_now),
    (select starts_at from pe_now), (select expires_at from pe_now),
    (select cancel_at_period_end from pe_now),
    coalesce((select sum(f.minutes) from focus_sessions f where f.user_id = p.id and f.minutes > 0), 0),
    (select count(distinct f.date) from focus_sessions f where f.user_id = p.id and f.minutes > 0),
    (select count(*) from app_events e where e.user_id = p.id and e.name = 'focus_block_done'),
    coalesce((select sum(f.minutes) from focus_sessions f
       where f.user_id = p.id and f.minutes > 0
         and f.date >= ((now() - interval '30 days') at time zone 'UTC')::date), 0),
    (select count(distinct (e.created_at at time zone 'UTC')::date) from app_events e
       where e.user_id = p.id and e.created_at >= now() - interval '30 days'),
    (select count(*) from app_events e where e.user_id = p.id and e.created_at >= now() - interval '30 days'),
    (select count(*) from tasks t where t.user_id = p.id),
    (select count(*) from tasks t where t.user_id = p.id and t.done),
    (select count(*) from rooms r where r.host_id = p.id and not r.is_system),
    (select count(*) from app_events e where e.user_id = p.id and e.name = 'room_join'),
    (select count(*) from app_events e where e.user_id = p.id and e.name = 'task_ai_upload'),
    (select count(*) from credit_ledger c where c.user_id = p.id and c.reason = 'purchase'),
    (select count(*) from feedback fb where fb.user_id = p.id),
    (select count(*) from client_errors ce where ce.user_id = p.id),
    (select count(*) from app_events e where e.user_id = p.id),
    (exists (select 1 from app_events e where e.user_id = p.id and e.name = 'focus_block_done'
              and e.created_at < p.created_at + interval '7 days')
     and exists (select 1 from tasks t where t.user_id = p.id
              and t.created_at < p.created_at + interval '7 days'))
  from profiles p
  where p.id = p_user and public.is_admin();
$$;

revoke execute on function public.admin_user_detail(uuid) from public, anon;
grant execute on function public.admin_user_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Recent raw event timeline for one user (newest-first), keyed by user_id.
--    Names stay raw here; the UI maps them to human-readable labels.
-- ---------------------------------------------------------------------------
create or replace function public.admin_user_events(p_user uuid, p_limit int default 50)
returns table (name text, meta text, device text, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select e.name, e.meta, e.device, e.created_at
  from app_events e
  where e.user_id = p_user and public.is_admin()
  order by e.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke execute on function public.admin_user_events(uuid, int) from public, anon;
grant execute on function public.admin_user_events(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Per-day focus minutes + event count over the trailing window, for the
--    in-drawer activity sparkline. Zero-filled so the series is contiguous.
-- ---------------------------------------------------------------------------
create or replace function public.admin_user_daily(p_user uuid, p_days int default 30)
returns table (day date, focus_minutes bigint, events bigint)
language sql
security definer
set search_path = public
stable
as $$
  with days as (
    select generate_series(
      ((now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 120)) - 1)) at time zone 'UTC')::date,
      (now() at time zone 'UTC')::date,
      interval '1 day')::date as day
  )
  select
    days.day,
    coalesce((select sum(f.minutes) from focus_sessions f
       where f.user_id = p_user and f.date = days.day and f.minutes > 0), 0),
    (select count(*) from app_events e
       where e.user_id = p_user and (e.created_at at time zone 'UTC')::date = days.day)
  from days
  where public.is_admin()
  order by days.day;
$$;

revoke execute on function public.admin_user_daily(uuid, int) from public, anon;
grant execute on function public.admin_user_daily(uuid, int) to authenticated;

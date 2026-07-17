-- Admin BI dashboard — Phase 1 read-only aggregation RPCs.
--
-- All functions are SECURITY DEFINER and gated by public.is_admin(), exactly
-- like the existing admin_* analytics RPCs: a non-admin (or the anon/service
-- role with no auth.uid()) gets zero rows and the aggregate subqueries never
-- run. No schema, RLS, or PII changes — these only read existing tables.
--
-- Definitions (approved):
--   * Active user (in a window) = fired >=1 app_events OR logged focus minutes.
--   * All timestamp bucketing is UTC. focus_sessions.date is a bare per-user
--     study day; it is compared against UTC date bounds (documented caveat).
--   * Snapshot metrics (total/premium/trial users) are "as of p_end".
--   * Premium/trial "as of T" come from active premium_entitlements spanning T,
--     so they are historically comparable (profiles.is_premium is only current).
--
-- Params: p_plan in ('all','free','premium'); p_device in ('all','phone',
-- 'tablet','pc'). Plan/device scope the activity/event/focus metrics; pure
-- registration snapshots respond to plan only (device is meaningless there).

-- ---------------------------------------------------------------------------
-- 1) Window KPI summary. Call twice (current + previous window) to compare.
-- ---------------------------------------------------------------------------
create or replace function public.admin_kpi_summary(
  p_start timestamptz,
  p_end timestamptz,
  p_plan text default 'all',
  p_device text default 'all'
)
returns table (
  total_users bigint, premium_users bigint, trial_users bigint,
  new_users bigint, active_users bigint, returning_users bigint,
  dau bigint, wau bigint, mau bigint,
  focus_minutes bigint, focus_sessions_started bigint, focus_blocks_done bigint,
  tasks_created bigint, tasks_completed bigint,
  rooms_created bigint, room_joins bigint, note_uploads bigint,
  credit_purchases bigint, feedback_count bigint, error_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with
  plan_users as (
    select id from profiles
    where p_plan = 'all'
       or (p_plan = 'premium' and is_premium)
       or (p_plan = 'free' and not is_premium)
  ),
  ev as (
    select e.user_id, e.name
    from app_events e
    where e.created_at >= p_start and e.created_at < p_end
      and (p_device = 'all' or e.device = p_device)
      and e.user_id in (select id from plan_users)
  ),
  fs as (
    select f.user_id, f.minutes
    from focus_sessions f
    where f.date >= (p_start at time zone 'UTC')::date
      and f.date <  (p_end   at time zone 'UTC')::date
      and f.minutes > 0
      and f.user_id in (select id from plan_users)
  ),
  active as (
    select user_id from ev
    union
    select user_id from fs where p_device = 'all'
  )
  select
    (select count(*) from profiles
       where created_at < p_end and id in (select id from plan_users)),
    (select count(distinct user_id) from premium_entitlements
       where status='active' and starts_at <= p_end and expires_at > p_end),
    (select count(distinct user_id) from premium_entitlements
       where source='trial' and status='active' and starts_at <= p_end and expires_at > p_end),
    (select count(*) from profiles
       where created_at >= p_start and created_at < p_end and id in (select id from plan_users)),
    (select count(distinct user_id) from active),
    (select count(distinct a.user_id) from active a
       join profiles pr on pr.id = a.user_id where pr.created_at < p_start),
    (select count(distinct user_id) from (
        select user_id from app_events where created_at >= p_end - interval '1 day' and created_at < p_end
        union select user_id from focus_sessions
          where date >= ((p_end - interval '1 day') at time zone 'UTC')::date
            and date < (p_end at time zone 'UTC')::date and minutes > 0
      ) d),
    (select count(distinct user_id) from (
        select user_id from app_events where created_at >= p_end - interval '7 days' and created_at < p_end
        union select user_id from focus_sessions
          where date >= ((p_end - interval '7 days') at time zone 'UTC')::date
            and date < (p_end at time zone 'UTC')::date and minutes > 0
      ) w),
    (select count(distinct user_id) from (
        select user_id from app_events where created_at >= p_end - interval '30 days' and created_at < p_end
        union select user_id from focus_sessions
          where date >= ((p_end - interval '30 days') at time zone 'UTC')::date
            and date < (p_end at time zone 'UTC')::date and minutes > 0
      ) m),
    (select coalesce(sum(minutes),0) from fs),
    (select count(*) from ev where name in ('timer_start','count_up_complete')),
    (select count(*) from ev where name = 'focus_block_done'),
    (select count(*) from tasks
       where created_at >= p_start and created_at < p_end and user_id in (select id from plan_users)),
    (select count(*) from tasks
       where done and updated_at >= p_start and updated_at < p_end and user_id in (select id from plan_users)),
    (select count(*) from rooms
       where not is_system and created_at >= p_start and created_at < p_end and host_id in (select id from plan_users)),
    (select count(*) from ev where name = 'room_join'),
    (select count(*) from ev where name = 'task_ai_upload'),
    (select count(*) from credit_ledger
       where reason = 'purchase' and created_at >= p_start and created_at < p_end and user_id in (select id from plan_users)),
    (select count(*) from feedback
       where created_at >= p_start and created_at < p_end and user_id in (select id from plan_users)),
    (select count(*) from client_errors
       where created_at >= p_start and created_at < p_end and user_id in (select id from plan_users))
  where public.is_admin();
$$;

revoke execute on function public.admin_kpi_summary(timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.admin_kpi_summary(timestamptz, timestamptz, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Per-day activity series across the window (for trend + composition charts).
-- ---------------------------------------------------------------------------
create or replace function public.admin_active_series(
  p_start timestamptz,
  p_end timestamptz,
  p_plan text default 'all',
  p_device text default 'all'
)
returns table (
  day date, dau bigint, new_users bigint, returning_users bigint,
  focus_minutes bigint, sessions_started bigint, sessions_completed bigint,
  phone_events bigint, tablet_events bigint, pc_events bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with
  plan_users as (
    select id from profiles
    where p_plan = 'all'
       or (p_plan = 'premium' and is_premium)
       or (p_plan = 'free' and not is_premium)
  ),
  days as (
    select generate_series((p_start at time zone 'UTC')::date,
                           (p_end   at time zone 'UTC')::date - 1,
                           interval '1 day')::date as day
  )
  select
    days.day,
    (select count(distinct user_id) from (
        select user_id from app_events
          where (created_at at time zone 'UTC')::date = days.day
            and (p_device='all' or device=p_device) and user_id in (select id from plan_users)
        union
        select user_id from focus_sessions
          where date = days.day and minutes>0 and p_device='all' and user_id in (select id from plan_users)
      ) a),
    (select count(*) from profiles
       where (created_at at time zone 'UTC')::date = days.day and id in (select id from plan_users)),
    (select count(distinct e.user_id) from app_events e join profiles pr on pr.id=e.user_id
       where (e.created_at at time zone 'UTC')::date = days.day
         and pr.created_at < days.day
         and (p_device='all' or e.device=p_device) and e.user_id in (select id from plan_users)),
    (select coalesce(sum(minutes),0) from focus_sessions
       where date = days.day and user_id in (select id from plan_users)),
    (select count(*) from app_events
       where (created_at at time zone 'UTC')::date = days.day and name in ('timer_start','count_up_complete')
         and (p_device='all' or device=p_device) and user_id in (select id from plan_users)),
    (select count(*) from app_events
       where (created_at at time zone 'UTC')::date = days.day and name='focus_block_done'
         and (p_device='all' or device=p_device) and user_id in (select id from plan_users)),
    (select count(*) from app_events
       where (created_at at time zone 'UTC')::date = days.day and device='phone' and user_id in (select id from plan_users)),
    (select count(*) from app_events
       where (created_at at time zone 'UTC')::date = days.day and device='tablet' and user_id in (select id from plan_users)),
    (select count(*) from app_events
       where (created_at at time zone 'UTC')::date = days.day and device='pc' and user_id in (select id from plan_users))
  from days
  where public.is_admin()
  order by days.day;
$$;

revoke execute on function public.admin_active_series(timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.admin_active_series(timestamptz, timestamptz, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Conversion funnel for the cohort of users who registered in the window.
--    Each step is a strict subset count of that cohort.
-- ---------------------------------------------------------------------------
create or replace function public.admin_conversion_funnel(
  p_start timestamptz,
  p_end timestamptz
)
returns table (
  signed_up bigint, focused bigint, created_task bigint,
  started_trial bigint, converted_paid bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with cohort as (
    select id from profiles where created_at >= p_start and created_at < p_end
  )
  select
    (select count(*) from cohort),
    (select count(distinct e.user_id) from app_events e
       where e.user_id in (select id from cohort) and e.name = 'focus_block_done'),
    (select count(distinct t.user_id) from tasks t where t.user_id in (select id from cohort)),
    (select count(distinct pe.user_id) from premium_entitlements pe
       where pe.user_id in (select id from cohort) and pe.source = 'trial'),
    (select count(distinct pe.user_id) from premium_entitlements pe
       where pe.user_id in (select id from cohort) and pe.source = 'subscription')
  where public.is_admin();
$$;

revoke execute on function public.admin_conversion_funnel(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_conversion_funnel(timestamptz, timestamptz) to authenticated;

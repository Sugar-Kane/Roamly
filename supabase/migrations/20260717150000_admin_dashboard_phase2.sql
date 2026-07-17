-- Admin BI dashboard — Phase 2 read-only aggregation RPCs (Features + Engagement).
--
-- Same contract as Phase 1: SECURITY DEFINER, gated by public.is_admin(), UTC
-- bucketing, no schema/RLS/PII change. These only read existing tables
-- (app_events, profiles, focus_sessions). Plan/device params scope the same way
-- as the Phase 1 RPCs.

-- 1) Per-feature analytics for the Features table (with previous-period delta).
create or replace function public.admin_feature_stats_v2(
  p_start timestamptz, p_end timestamptz, p_prev_start timestamptz, p_prev_end timestamptz,
  p_plan text default 'all', p_device text default 'all'
)
returns table (
  name text, total bigint, unique_users bigint, free_uses bigint, premium_uses bigint,
  phone bigint, tablet bigint, pc bigint, last_at timestamptz, prev_total bigint
)
language sql security definer set search_path = public stable
as $$
  with plan_users as (
    select id, is_premium from profiles
    where p_plan='all' or (p_plan='premium' and is_premium) or (p_plan='free' and not is_premium)
  ),
  cur as (
    select e.name,
      count(*) total, count(distinct e.user_id) unique_users,
      count(*) filter (where not pu.is_premium) free_uses,
      count(*) filter (where pu.is_premium) premium_uses,
      count(*) filter (where e.device='phone') phone,
      count(*) filter (where e.device='tablet') tablet,
      count(*) filter (where e.device='pc') pc,
      max(e.created_at) last_at
    from app_events e join plan_users pu on pu.id = e.user_id
    where e.created_at >= p_start and e.created_at < p_end and (p_device='all' or e.device=p_device)
    group by e.name
  ),
  prev as (
    select e.name, count(*) prev_total
    from app_events e join plan_users pu on pu.id = e.user_id
    where e.created_at >= p_prev_start and e.created_at < p_prev_end and (p_device='all' or e.device=p_device)
    group by e.name
  )
  select c.name, c.total, c.unique_users, c.free_uses, c.premium_uses, c.phone, c.tablet, c.pc, c.last_at, coalesce(p.prev_total, 0)
  from cur c left join prev p on p.name = c.name
  where public.is_admin()
  order by c.total desc;
$$;
revoke execute on function public.admin_feature_stats_v2(timestamptz, timestamptz, timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.admin_feature_stats_v2(timestamptz, timestamptz, timestamptz, timestamptz, text, text) to authenticated;

-- 2) Per-feature daily trend (sparkline + detail drawer).
create or replace function public.admin_feature_trend(p_name text, p_start timestamptz, p_end timestamptz)
returns table (day date, uses bigint)
language sql security definer set search_path = public stable
as $$
  with days as (
    select generate_series((p_start at time zone 'UTC')::date, (p_end at time zone 'UTC')::date - 1, interval '1 day')::date as day
  )
  select days.day, (select count(*) from app_events where name = p_name and (created_at at time zone 'UTC')::date = days.day)
  from days where public.is_admin() order by days.day;
$$;
revoke execute on function public.admin_feature_trend(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_feature_trend(text, timestamptz, timestamptz) to authenticated;

-- 3) Activity heatmap: events by UTC weekday (0=Sun) × hour.
create or replace function public.admin_activity_heatmap(
  p_start timestamptz, p_end timestamptz, p_plan text default 'all', p_device text default 'all'
)
returns table (dow int, hour int, events bigint)
language sql security definer set search_path = public stable
as $$
  with plan_users as (
    select id from profiles
    where p_plan='all' or (p_plan='premium' and is_premium) or (p_plan='free' and not is_premium)
  )
  select extract(dow from (created_at at time zone 'UTC'))::int,
         extract(hour from (created_at at time zone 'UTC'))::int,
         count(*)
  from app_events
  where created_at >= p_start and created_at < p_end
    and (p_device='all' or device=p_device)
    and user_id in (select id from plan_users)
    and public.is_admin()
  group by 1, 2;
$$;
revoke execute on function public.admin_activity_heatmap(timestamptz, timestamptz, text, text) from public, anon;
grant execute on function public.admin_activity_heatmap(timestamptz, timestamptz, text, text) to authenticated;

-- 4) Weekly retention cohorts. cohort_week = UTC signup week (Monday); each row
-- is that cohort's retained-user count at week_offset weeks after signup.
create or replace function public.admin_retention_cohorts(p_weeks int default 8)
returns table (cohort_week date, cohort_size bigint, week_offset int, retained bigint)
language sql security definer set search_path = public stable
as $$
  with cohorts as (
    select id, date_trunc('week', (created_at at time zone 'UTC'))::date cw
    from profiles where created_at >= now() - (greatest(1, least(p_weeks, 26)) || ' weeks')::interval
  ),
  sizes as (select cw, count(*) n from cohorts group by cw),
  act as (
    select distinct user_id, date_trunc('week', (created_at at time zone 'UTC'))::date wk from app_events
    union
    select distinct user_id, date_trunc('week', date::timestamp)::date from focus_sessions where minutes > 0
  )
  select c.cw, s.n, ((a.wk - c.cw) / 7)::int, count(distinct c.id)
  from cohorts c join sizes s on s.cw = c.cw join act a on a.user_id = c.id and a.wk >= c.cw
  where public.is_admin()
  group by c.cw, s.n, ((a.wk - c.cw) / 7)::int
  order by c.cw, ((a.wk - c.cw) / 7)::int;
$$;
revoke execute on function public.admin_retention_cohorts(int) from public, anon;
grant execute on function public.admin_retention_cohorts(int) to authenticated;

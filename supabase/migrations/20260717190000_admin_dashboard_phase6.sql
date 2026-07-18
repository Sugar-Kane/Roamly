-- Admin BI dashboard — Phase 6 read-only Data Explorer RPC.
--
-- Same security model as Phases 1-5: SECURITY DEFINER, gated by
-- public.is_admin() inside the query, EXECUTE revoked from public/anon. A
-- non-admin gets zero rows. No schema, RLS, auth, or billing changes.
--
-- One flexible aggregation: pick a metric, bucket by day/week/month (UTC), and
-- optionally scope by plan and device. To keep roll-ups mathematically correct
-- across grains, the metric whitelist is limited to ADDITIVE measures (counts
-- and sums that aggregate by summation). Distinct-user measures like DAU/WAU
-- are deliberately excluded — they can't be summed from daily buckets — and
-- stay on the Overview/Engagement pages that compute them at a fixed grain.
--
-- p_metric whitelist:
--   new_users, active_events, focus_minutes, focus_blocks, tasks_created,
--   tasks_completed, room_joins, note_uploads, errors, new_subscriptions,
--   new_trials, credit_purchases, feedback
-- p_grain: 'day' | 'week' | 'month'. p_plan: 'all'|'free'|'premium'.
-- p_device: 'all'|'phone'|'tablet'|'pc' (only affects app_events metrics).

create or replace function public.admin_explore_metric(
  p_metric text,
  p_start  timestamptz,
  p_end    timestamptz,
  p_grain  text default 'day',
  p_plan   text default 'all',
  p_device text default 'all'
)
returns table (bucket date, value bigint)
language sql
security definer
set search_path = public
stable
as $$
  with
  grain as (select case when p_grain in ('day','week','month') then p_grain else 'day' end as g),
  plan_users as (
    select id from profiles
    where p_plan = 'all'
       or (p_plan = 'premium' and is_premium)
       or (p_plan = 'free' and not is_premium)
  ),
  buckets as (
    select generate_series(
      date_trunc((select g from grain), (p_start at time zone 'UTC'))::date,
      date_trunc((select g from grain), (p_end   at time zone 'UTC') - interval '1 second')::date,
      (case (select g from grain) when 'day' then interval '1 day'
                                  when 'week' then interval '1 week'
                                  else interval '1 month' end)
    )::date as bucket
  ),
  raw as (
    -- app_events-based metrics (respect device + plan)
    select date_trunc((select g from grain), (e.created_at at time zone 'UTC'))::date as bucket, count(*)::bigint as value
      from app_events e
     where p_metric in ('active_events','focus_blocks','room_joins','note_uploads')
       and e.created_at >= p_start and e.created_at < p_end
       and (p_device = 'all' or e.device = p_device)
       and e.user_id in (select id from plan_users)
       and (p_metric <> 'focus_blocks'  or e.name = 'focus_block_done')
       and (p_metric <> 'room_joins'    or e.name = 'room_join')
       and (p_metric <> 'note_uploads'  or e.name = 'task_ai_upload')
     group by 1
    union all
    -- focus minutes (focus_sessions.date, plan-scoped)
    select date_trunc((select g from grain), f.date)::date, coalesce(sum(f.minutes),0)::bigint
      from focus_sessions f
     where p_metric = 'focus_minutes'
       and f.date >= (p_start at time zone 'UTC')::date and f.date < (p_end at time zone 'UTC')::date
       and f.minutes > 0 and f.user_id in (select id from plan_users)
     group by 1
    union all
    -- new users (profiles.created_at, plan-scoped)
    select date_trunc((select g from grain), (p.created_at at time zone 'UTC'))::date, count(*)::bigint
      from profiles p
     where p_metric = 'new_users'
       and p.created_at >= p_start and p.created_at < p_end and p.id in (select id from plan_users)
     group by 1
    union all
    -- tasks created / completed (plan-scoped)
    select date_trunc((select g from grain), (t.created_at at time zone 'UTC'))::date, count(*)::bigint
      from tasks t
     where p_metric = 'tasks_created'
       and t.created_at >= p_start and t.created_at < p_end and t.user_id in (select id from plan_users)
     group by 1
    union all
    select date_trunc((select g from grain), (t.updated_at at time zone 'UTC'))::date, count(*)::bigint
      from tasks t
     where p_metric = 'tasks_completed'
       and t.done and t.updated_at >= p_start and t.updated_at < p_end and t.user_id in (select id from plan_users)
     group by 1
    union all
    -- client errors (plan-scoped)
    select date_trunc((select g from grain), (c.created_at at time zone 'UTC'))::date, count(*)::bigint
      from client_errors c
     where p_metric = 'errors'
       and c.created_at >= p_start and c.created_at < p_end and c.user_id in (select id from plan_users)
     group by 1
    union all
    -- entitlements: new subscriptions / trials
    select date_trunc((select g from grain), (pe.created_at at time zone 'UTC'))::date, count(*)::bigint
      from premium_entitlements pe
     where p_metric = 'new_subscriptions' and pe.source = 'subscription'
       and pe.created_at >= p_start and pe.created_at < p_end and pe.user_id in (select id from plan_users)
     group by 1
    union all
    select date_trunc((select g from grain), (pe.created_at at time zone 'UTC'))::date, count(*)::bigint
      from premium_entitlements pe
     where p_metric = 'new_trials' and pe.source = 'trial'
       and pe.created_at >= p_start and pe.created_at < p_end and pe.user_id in (select id from plan_users)
     group by 1
    union all
    -- credit purchases (plan-scoped)
    select date_trunc((select g from grain), (cl.created_at at time zone 'UTC'))::date, count(*)::bigint
      from credit_ledger cl
     where p_metric = 'credit_purchases' and cl.reason = 'purchase'
       and cl.created_at >= p_start and cl.created_at < p_end and cl.user_id in (select id from plan_users)
     group by 1
    union all
    -- feedback (plan-scoped)
    select date_trunc((select g from grain), (fb.created_at at time zone 'UTC'))::date, count(*)::bigint
      from feedback fb
     where p_metric = 'feedback'
       and fb.created_at >= p_start and fb.created_at < p_end and fb.user_id in (select id from plan_users)
     group by 1
  )
  select b.bucket, coalesce(sum(r.value), 0)::bigint as value
    from buckets b
    left join raw r on r.bucket = b.bucket
   where public.is_admin()
   group by b.bucket
   order by b.bucket;
$$;

revoke execute on function public.admin_explore_metric(text, timestamptz, timestamptz, text, text, text) from public, anon;
grant execute on function public.admin_explore_metric(text, timestamptz, timestamptz, text, text, text) to authenticated;

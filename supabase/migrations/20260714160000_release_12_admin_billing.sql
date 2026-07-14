-- Release 12: in-app subscription cancel + admin usage dashboard.
--
-- Billing: persist Stripe's cancel_at_period_end on the entitlement so the app
-- can show "Premium ends on <date>" (status stays 'active' until period end,
-- which has always kept access alive; this only adds visibility).
--
-- Admin: per-user usage rollups for the interactive dashboard, "today" stats,
-- and per-user credit balances in the user search.

-- ============ entitlement: pending-cancel visibility ============
alter table public.premium_entitlements
  add column if not exists cancel_at_period_end boolean not null default false;

-- New parameter changes the signature; drop the old one so PostgREST named-arg
-- resolution never sees two overloads (that would 300 every webhook call).
drop function if exists public.process_stripe_subscription_event(text, text, uuid, text, text, timestamptz, text, timestamptz);
create or replace function public.process_stripe_subscription_event(
  p_event_id text,
  p_event_type text,
  p_user uuid,
  p_subscription text,
  p_status text,
  p_period_end timestamptz,
  p_price_id text,
  p_event_created timestamptz default null,
  p_cancel_at_period_end boolean default false
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted int;
  v_active boolean := p_status in ('active', 'trialing');
begin
  insert into public.stripe_events(id, type)
  values (p_event_id, p_event_type)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return 'duplicate'; end if;

  insert into public.premium_entitlements(user_id, source, status, starts_at, expires_at, external_ref, note, last_event_at, cancel_at_period_end)
  values (
    p_user,
    'subscription',
    case when v_active then 'active' else 'revoked' end,
    now(),
    greatest(coalesce(p_period_end, now()), now() + interval '1 second'),
    p_subscription,
    case when p_price_id is null then null else 'price:' || p_price_id end,
    p_event_created,
    coalesce(p_cancel_at_period_end, false)
  )
  on conflict (source, external_ref) where external_ref is not null
  do update set
    status = case
      when public.premium_entitlements.last_event_at is null
        or excluded.last_event_at is null
        or excluded.last_event_at >= public.premium_entitlements.last_event_at
      then excluded.status
      else public.premium_entitlements.status
    end,
    note = case
      when public.premium_entitlements.last_event_at is null
        or excluded.last_event_at is null
        or excluded.last_event_at >= public.premium_entitlements.last_event_at
      then excluded.note
      else public.premium_entitlements.note
    end,
    cancel_at_period_end = case
      when public.premium_entitlements.last_event_at is null
        or excluded.last_event_at is null
        or excluded.last_event_at >= public.premium_entitlements.last_event_at
      then excluded.cancel_at_period_end
      else public.premium_entitlements.cancel_at_period_end
    end,
    expires_at = greatest(public.premium_entitlements.expires_at, excluded.expires_at),
    last_event_at = greatest(
      coalesce(public.premium_entitlements.last_event_at, excluded.last_event_at),
      coalesce(excluded.last_event_at, public.premium_entitlements.last_event_at)
    ),
    updated_at = now();

  update public.profiles
     set stripe_subscription_id = p_subscription,
         is_premium = public.has_active_premium(p_user),
         updated_at = now()
   where id = p_user;
  if not found then raise exception 'profile_not_found'; end if;
  return 'processed';
end;
$$;

revoke execute on function public.process_stripe_subscription_event(text, text, uuid, text, text, timestamptz, text, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.process_stripe_subscription_event(text, text, uuid, text, text, timestamptz, text, timestamptz, boolean) to service_role;

-- Surface the pending-cancel state to the signed-in user. Return type changes,
-- so drop first. Old clients ignore the extra column.
drop function if exists public.get_my_premium_entitlement();
create or replace function public.get_my_premium_entitlement()
returns table (is_premium boolean, source text, expires_at timestamptz, cancel_at_period_end boolean)
language sql
security definer
stable
set search_path = ''
as $$
  with best as (
    select e.source, e.expires_at, e.cancel_at_period_end
      from public.premium_entitlements e
     where e.user_id = (select auth.uid())
       and e.status = 'active'
       and e.starts_at <= now()
       and e.expires_at > now()
     order by e.expires_at desc
     limit 1
  )
  select exists(select 1 from best), best.source, best.expires_at, coalesce(best.cancel_at_period_end, false)
    from (select 1) seed
    left join best on true;
$$;

revoke execute on function public.get_my_premium_entitlement() from public, anon;
grant execute on function public.get_my_premium_entitlement() to authenticated;

-- ============ admin: user search now includes credit balances ============
drop function if exists public.admin_search_users(text);
create or replace function public.admin_search_users(p_query text)
returns table (
  id uuid, email text, username text, display_name text, is_premium boolean,
  ai_credits int, ai_uploads_count int, ai_uploads_period text, premium_expires_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.email, p.username, p.display_name, p.is_premium,
         coalesce(p.ai_credits, 0), coalesce(p.ai_uploads_count, 0), p.ai_uploads_period,
         (select max(e.expires_at) from public.premium_entitlements e
           where e.user_id = p.id and e.status = 'active' and e.expires_at > now())
    from public.profiles p
   where public.is_admin()
     and (length(trim(coalesce(p_query, ''))) = 0
       or p.email ilike '%' || trim(p_query) || '%'
       or p.username ilike '%' || trim(p_query) || '%'
       or p.display_name ilike '%' || trim(p_query) || '%')
   order by p.email
   limit 200;
$$;

revoke execute on function public.admin_search_users(text) from public, anon;
grant execute on function public.admin_search_users(text) to authenticated;

-- ============ admin: usage dashboard rollups ============
-- Per-user event rollup over a window: totals, last activity, and a
-- name -> count JSON map for the expandable per-feature breakdown.
create or replace function public.admin_usage_users(p_days int default 30)
returns table (
  id uuid, email text, username text, display_name text, is_premium boolean,
  ai_credits int, total_events bigint, last_active timestamptz, feature_counts jsonb
)
language sql
security definer
set search_path = public
stable
as $$
  select p.id, p.email, p.username, p.display_name, p.is_premium,
         coalesce(p.ai_credits, 0),
         coalesce(e.total, 0),
         e.last_active,
         coalesce(e.features, '{}'::jsonb)
    from public.profiles p
    left join lateral (
      select sum(s.cnt)::bigint as total,
             max(s.last) as last_active,
             jsonb_object_agg(s.name, s.cnt) as features
        from (
          select a.name, count(*)::bigint as cnt, max(a.created_at) as last
            from public.app_events a
           where a.user_id = p.id
             and a.created_at > now() - make_interval(days => greatest(1, least(p_days, 90)))
           group by a.name
        ) s
    ) e on true
   where public.is_admin()
   order by coalesce(e.total, 0) desc, p.email
   limit 500;
$$;

revoke execute on function public.admin_usage_users(int) from public, anon;
grant execute on function public.admin_usage_users(int) to authenticated;

-- Headline numbers for today (server date).
create or replace function public.admin_overview_today()
returns table (events_today bigint, active_users_today bigint, focus_minutes_today bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*) from public.app_events where created_at::date = current_date),
    (select count(distinct user_id) from public.app_events where created_at::date = current_date),
    (select coalesce(sum(minutes), 0)::bigint from public.focus_sessions where date = current_date)
  where public.is_admin();
$$;

revoke execute on function public.admin_overview_today() from public, anon;
grant execute on function public.admin_overview_today() to authenticated;

-- Per-feature stats for today; same shape as admin_event_stats so the UI can
-- reuse one renderer for both.
create or replace function public.admin_event_stats_today()
returns table (name text, total bigint, users bigint, phone bigint, pc bigint)
language sql
security definer
set search_path = public
stable
as $$
  select e.name,
         count(*) as total,
         count(distinct e.user_id) as users,
         count(*) filter (where e.device in ('phone', 'tablet')) as phone,
         count(*) filter (where e.device = 'pc') as pc
    from public.app_events e
   where public.is_admin()
     and e.created_at::date = current_date
   group by e.name
   order by total desc;
$$;

revoke execute on function public.admin_event_stats_today() from public, anon;
grant execute on function public.admin_event_stats_today() to authenticated;

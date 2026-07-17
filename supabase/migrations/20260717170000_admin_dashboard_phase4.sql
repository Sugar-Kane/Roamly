-- Admin BI dashboard — Phase 4 read-only revenue & conversion RPCs.
--
-- Same security model as Phases 1-3: SECURITY DEFINER, gated by
-- public.is_admin() inside the query, EXECUTE revoked from public/anon. A
-- non-admin gets zero rows. No schema, RLS, auth, or billing changes.
--
-- IMPORTANT — these read ONLY existing tables (premium_entitlements,
-- credit_ledger). They do NOT call Stripe. Money figures are ESTIMATES at
-- published list prices, surfaced as such in the UI:
--   * Subscription list price: $3.00/mo, or $30.00/yr ($2.50/mo equivalent).
--     A subscription entitlement is classified monthly vs annual by its span
--     (expires_at - starts_at); >300 days ⇒ annual.
--   * Credit packs (from api/billing.ts): 2 credits = $1.00, 5 credits = $2.00.
--     Other amounts fall back to ~$0.40/credit.
-- Actual net revenue (discounts, proration, refunds, fees, failed charges,
-- tax) requires the Stripe integration and is intentionally out of scope here.
--
-- Snapshot metrics (active_*, mrr, canceling, paying_users) are "as of p_end";
-- flow metrics (new_*, converted, credit_*) cover [p_start, p_end). Call twice
-- (current + previous window) for period-over-period deltas, exactly like
-- admin_kpi_summary.

-- ---------------------------------------------------------------------------
-- 1) Revenue & subscription summary for a window.
-- ---------------------------------------------------------------------------
create or replace function public.admin_revenue_summary(
  p_start timestamptz,
  p_end   timestamptz
)
returns table (
  active_subscriptions bigint, paying_users bigint, active_trials bigint,
  mrr_cents bigint, canceling bigint,
  new_subscriptions bigint, new_trials bigint, trials_converted bigint,
  credit_purchases bigint, credits_sold bigint, credit_revenue_cents bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with active_subs as (
    select user_id, starts_at, expires_at, cancel_at_period_end
    from premium_entitlements
    where source = 'subscription' and status = 'active'
      and starts_at <= p_end and expires_at > p_end
  )
  select
    (select count(*) from active_subs),
    (select count(distinct user_id) from active_subs),
    (select count(distinct user_id) from premium_entitlements
       where source = 'trial' and status = 'active'
         and starts_at <= p_end and expires_at > p_end),
    -- Estimated monthly-recurring cents at list price, classified by span.
    coalesce((select sum(case when (expires_at - starts_at) > interval '300 days' then 250 else 300 end)
                from active_subs), 0),
    (select count(*) from active_subs where cancel_at_period_end),
    (select count(*) from premium_entitlements
       where source = 'subscription' and created_at >= p_start and created_at < p_end),
    (select count(*) from premium_entitlements
       where source = 'trial' and created_at >= p_start and created_at < p_end),
    -- Trial→paid: users who got a subscription in-window and had an earlier trial.
    (select count(distinct s.user_id) from premium_entitlements s
       where s.source = 'subscription' and s.created_at >= p_start and s.created_at < p_end
         and exists (select 1 from premium_entitlements t
                       where t.user_id = s.user_id and t.source = 'trial'
                         and t.created_at <= s.created_at)),
    (select count(*) from credit_ledger
       where reason = 'purchase' and created_at >= p_start and created_at < p_end),
    coalesce((select sum(amount) from credit_ledger
       where reason = 'purchase' and created_at >= p_start and created_at < p_end), 0),
    coalesce((select sum(case amount when 2 then 100 when 5 then 200 else amount * 40 end)
                from credit_ledger
               where reason = 'purchase' and created_at >= p_start and created_at < p_end), 0)
  where public.is_admin();
$$;

revoke execute on function public.admin_revenue_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_revenue_summary(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Per-day revenue flow across the window (new subs, new trials, credit $).
-- ---------------------------------------------------------------------------
create or replace function public.admin_revenue_series(
  p_start timestamptz,
  p_end   timestamptz
)
returns table (
  day date, new_subscriptions bigint, new_trials bigint, credit_revenue_cents bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with days as (
    select generate_series((p_start at time zone 'UTC')::date,
                           (p_end   at time zone 'UTC')::date - 1,
                           interval '1 day')::date as day
  )
  select
    days.day,
    (select count(*) from premium_entitlements
       where source = 'subscription' and (created_at at time zone 'UTC')::date = days.day),
    (select count(*) from premium_entitlements
       where source = 'trial' and (created_at at time zone 'UTC')::date = days.day),
    coalesce((select sum(case amount when 2 then 100 when 5 then 200 else amount * 40 end)
                from credit_ledger
               where reason = 'purchase' and (created_at at time zone 'UTC')::date = days.day), 0)
  from days
  where public.is_admin()
  order by days.day;
$$;

revoke execute on function public.admin_revenue_series(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_revenue_series(timestamptz, timestamptz) to authenticated;

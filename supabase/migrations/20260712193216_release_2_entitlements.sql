-- Release 2: centralized Premium entitlements and immutable credit ledger.
-- New tables are intentionally service-only. Browser clients read effective
-- entitlement state through get_my_premium_entitlement(), never by selecting
-- protected billing rows directly.

create table public.premium_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('subscription', 'trial', 'credit_purchase', 'admin')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz not null,
  external_ref text,
  created_by uuid references auth.users(id) on delete set null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at > starts_at)
);

create unique index premium_entitlements_source_ref_uidx
  on public.premium_entitlements(source, external_ref)
  where external_ref is not null;
create unique index premium_entitlements_one_trial_uidx
  on public.premium_entitlements(user_id)
  where source = 'trial';
create index premium_entitlements_user_active_idx
  on public.premium_entitlements(user_id, expires_at desc)
  where status = 'active';
create index premium_entitlements_created_by_idx
  on public.premium_entitlements(created_by)
  where created_by is not null;

alter table public.premium_entitlements enable row level security;
revoke all on table public.premium_entitlements from public, anon, authenticated;
grant select, insert, update on table public.premium_entitlements to service_role;

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount int not null check (amount <> 0),
  reason text not null check (reason in ('purchase', 'consume', 'refund', 'admin_adjustment')),
  external_ref text,
  stripe_event_id text,
  created_by uuid references auth.users(id) on delete set null,
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create unique index credit_ledger_external_ref_uidx
  on public.credit_ledger(external_ref)
  where external_ref is not null;
create unique index credit_ledger_stripe_event_uidx
  on public.credit_ledger(stripe_event_id)
  where stripe_event_id is not null;
create index credit_ledger_user_created_idx
  on public.credit_ledger(user_id, created_at desc);
create index credit_ledger_created_by_idx
  on public.credit_ledger(created_by)
  where created_by is not null;

alter table public.credit_ledger enable row level security;
revoke all on table public.credit_ledger from public, anon, authenticated;
grant select, insert on table public.credit_ledger to service_role;

create or replace function public.has_active_premium(p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
      from public.premium_entitlements e
     where e.user_id = p_user
       and e.status = 'active'
       and e.starts_at <= now()
       and e.expires_at > now()
  );
$$;

revoke execute on function public.has_active_premium(uuid) from public, anon, authenticated;
grant execute on function public.has_active_premium(uuid) to service_role;

create or replace function public.has_my_active_premium()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select public.has_active_premium((select auth.uid()));
$$;

revoke execute on function public.has_my_active_premium() from public, anon;
grant execute on function public.has_my_active_premium() to authenticated;

create or replace function public.get_my_premium_entitlement()
returns table (is_premium boolean, source text, expires_at timestamptz)
language sql
security definer
stable
set search_path = ''
as $$
  with best as (
    select e.source, e.expires_at
      from public.premium_entitlements e
     where e.user_id = (select auth.uid())
       and e.status = 'active'
       and e.starts_at <= now()
       and e.expires_at > now()
     order by e.expires_at desc
     limit 1
  )
  select exists(select 1 from best), best.source, best.expires_at
    from (select 1) seed
    left join best on true;
$$;

revoke execute on function public.get_my_premium_entitlement() from public, anon;
grant execute on function public.get_my_premium_entitlement() to authenticated;

create or replace function public.start_trial_if_eligible(p_user uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz;
begin
  insert into public.premium_entitlements(user_id, source, expires_at, external_ref)
  values (p_user, 'trial', now() + interval '30 days', 'trial:' || p_user::text)
  on conflict do nothing
  returning expires_at into v_expires;

  if v_expires is null then
    select e.expires_at into v_expires
      from public.premium_entitlements e
     where e.user_id = p_user and e.source = 'trial';
  end if;

  update public.profiles
     set is_premium = public.has_active_premium(p_user), updated_at = now()
   where id = p_user;
  return v_expires;
end;
$$;

revoke execute on function public.start_trial_if_eligible(uuid) from public, anon, authenticated;
grant execute on function public.start_trial_if_eligible(uuid) to service_role;

create or replace function public.process_stripe_credit_event(
  p_event_id text,
  p_event_type text,
  p_user uuid,
  p_credits int,
  p_premium_days int,
  p_external_ref text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted int;
  v_promo_expires timestamptz;
begin
  if p_credits <= 0 or p_premium_days <= 0 then
    raise exception 'invalid_credit_event';
  end if;

  insert into public.stripe_events(id, type)
  values (p_event_id, p_event_type)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return 'duplicate'; end if;

  insert into public.credit_ledger(user_id, amount, reason, external_ref, stripe_event_id)
  values (p_user, p_credits, 'purchase', p_external_ref, p_event_id);

  update public.profiles
     set ai_credits = ai_credits + p_credits,
         updated_at = now()
   where id = p_user;
  if not found then raise exception 'profile_not_found'; end if;

  select greatest(coalesce(max(e.expires_at), now()), now()) + make_interval(days => p_premium_days)
    into v_promo_expires
    from public.premium_entitlements e
   where e.user_id = p_user
     and e.source = 'credit_purchase'
     and e.status = 'active'
     and e.expires_at > now();

  insert into public.premium_entitlements(user_id, source, starts_at, expires_at, external_ref)
  values (p_user, 'credit_purchase', now(), v_promo_expires, p_external_ref)
  on conflict (source, external_ref) where external_ref is not null
  do update set
    expires_at = greatest(public.premium_entitlements.expires_at, excluded.expires_at),
    status = 'active',
    updated_at = now();

  update public.profiles
     set is_premium = public.has_active_premium(p_user), updated_at = now()
   where id = p_user;
  return 'processed';
end;
$$;

revoke execute on function public.process_stripe_credit_event(text, text, uuid, int, int, text) from public, anon, authenticated;
grant execute on function public.process_stripe_credit_event(text, text, uuid, int, int, text) to service_role;

create or replace function public.process_stripe_subscription_event(
  p_event_id text,
  p_event_type text,
  p_user uuid,
  p_subscription text,
  p_status text,
  p_period_end timestamptz,
  p_price_id text
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

  insert into public.premium_entitlements(user_id, source, status, starts_at, expires_at, external_ref, note)
  values (
    p_user,
    'subscription',
    case when v_active then 'active' else 'revoked' end,
    now(),
    greatest(coalesce(p_period_end, now()), now() + interval '1 second'),
    p_subscription,
    case when p_price_id is null then null else 'price:' || p_price_id end
  )
  on conflict (source, external_ref) where external_ref is not null
  do update set
    status = excluded.status,
    expires_at = greatest(public.premium_entitlements.expires_at, excluded.expires_at),
    note = excluded.note,
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

revoke execute on function public.process_stripe_subscription_event(text, text, uuid, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.process_stripe_subscription_event(text, text, uuid, text, text, timestamptz, text) to service_role;

create or replace function public.admin_grant_premium(p_user uuid, p_months int, p_reason text default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_expires timestamptz;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_months not in (1, 12) then raise exception 'invalid_grant_duration'; end if;

  select greatest(coalesce(max(e.expires_at), now()), now()) + make_interval(months => p_months)
    into v_expires
    from public.premium_entitlements e
   where e.user_id = p_user and e.source = 'admin' and e.status = 'active' and e.expires_at > now();

  insert into public.premium_entitlements(user_id, source, expires_at, created_by, note)
  values (p_user, 'admin', v_expires, v_admin, nullif(left(trim(p_reason), 500), ''));

  update public.profiles set is_premium = true, updated_at = now() where id = p_user;
  insert into public.admin_audit(admin_id, action, target, detail)
  values (v_admin, 'premium_grant', p_user, p_months::text || ' months; expires ' || v_expires::text);
  return v_expires;
end;
$$;

revoke execute on function public.admin_grant_premium(uuid, int, text) from public, anon;
grant execute on function public.admin_grant_premium(uuid, int, text) to authenticated;

-- Retire the legacy boolean toggle. Dated grants above are auditable and do
-- not interfere with paid subscriptions, trials, or credit promotions.
revoke execute on function public.admin_set_premium(uuid, boolean) from authenticated;

-- Record every purchased-credit spend/refund in the immutable ledger while
-- maintaining profiles.ai_credits as the fast cached balance used by the UI.
create or replace function public.consume_ai_credit(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_left int;
begin
  update public.profiles
     set ai_credits = ai_credits - 1, updated_at = now()
   where id = p_user and ai_credits > 0
  returning ai_credits into v_left;
  if v_left is null then return 'no_credits'; end if;
  insert into public.credit_ledger(user_id, amount, reason)
  values (p_user, -1, 'consume');
  return 'ok';
end;
$$;

revoke execute on function public.consume_ai_credit(uuid) from public, anon, authenticated;
grant execute on function public.consume_ai_credit(uuid) to service_role;

create or replace function public.add_ai_credits(p_user uuid, p_credits int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_credits <= 0 then raise exception 'invalid_credit_refund'; end if;
  update public.profiles
     set ai_credits = ai_credits + p_credits, updated_at = now()
   where id = p_user;
  if not found then raise exception 'profile_not_found'; end if;
  insert into public.credit_ledger(user_id, amount, reason, note)
  values (p_user, p_credits, 'refund', 'Automated upload-processing refund');
end;
$$;

revoke execute on function public.add_ai_credits(uuid, int) from public, anon, authenticated;
grant execute on function public.add_ai_credits(uuid, int) to service_role;

drop policy if exists rooms_insert_own on public.rooms;
create policy rooms_insert_own on public.rooms
for insert to authenticated
with check (
  (select auth.uid()) = host_id
  and is_system = false
  and (select public.has_my_active_premium())
  and (select count(*) from public.rooms r where r.host_id = (select auth.uid()) and r.is_system = false) < 3
);

-- Preserve current manually comped accounts as non-expiring-in-practice
-- legacy grants. These rows can later be replaced with explicit dated grants.
insert into public.premium_entitlements(user_id, source, expires_at, external_ref, note)
select p.id, 'admin', now() + interval '10 years', 'legacy-profile:' || p.id::text, 'Migrated from profiles.is_premium'
  from public.profiles p
 where p.is_premium = true
on conflict do nothing;

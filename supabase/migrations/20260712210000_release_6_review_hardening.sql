-- Release 6: review hardening.
--   1. Reconcile profiles.is_premium after time-based trials/promos lapse.
--   2. Authorize the private room-voice realtime channel.
--   3. Guard the subscription state machine against out-of-order Stripe events.
--   4. Restrict host room updates to the `music` column only.
-- Safe to run more than once.

-- ============ 1. Premium flag reconciler ============
-- Subscriptions get an is_premium flip from the Stripe webhook when they lapse,
-- but trials (30d) and credit promos (3/7d) expire purely by wall-clock with no
-- event — so the cached profiles.is_premium column drifts true forever. A small
-- periodic job recomputes the cached flag from live entitlement state.
create or replace function public.reconcile_premium_flags()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with fixed as (
    update public.profiles p
       set is_premium = public.has_active_premium(p.id), updated_at = now()
     where p.is_premium is distinct from public.has_active_premium(p.id)
    returning 1
  )
  select count(*) into v_count from fixed;
  return v_count;
end;
$$;

revoke execute on function public.reconcile_premium_flags() from public, anon, authenticated;
grant execute on function public.reconcile_premium_flags() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('reconcile-premium-flags', '*/15 * * * *', 'select public.reconcile_premium_flags()');
    raise notice 'pg_cron: reconcile-premium-flags scheduled every 15 minutes.';
  else
    raise notice 'pg_cron not enabled — enable it, then re-run this file so lapsed trials/promos reset is_premium.';
  end if;
end;
$$;

-- ============ 2. room-voice realtime authorization ============
-- The voice channel `room-voice:<uuid>` is opened with { private: true } and
-- uses both presence and broadcast, but release 5 only added realtime.messages
-- policies for the `room:<uuid>` presence topic. Without a matching policy this
-- private topic is either unusable or (if broadcast auth is not enforced)
-- subscribable by users who cannot access the room. Gate it with the same
-- can_access_room() check used everywhere else. Written as plain top-level DDL
-- to match the release-5 room-presence policies (same realtime.messages table).
drop policy if exists "room_voice_read" on realtime.messages;
create policy "room_voice_read" on realtime.messages for select to authenticated using (
  extension in ('presence', 'broadcast')
  and (select realtime.topic()) ~ '^room-voice:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (select public.can_access_room(split_part((select realtime.topic()), ':', 2)::uuid))
);
drop policy if exists "room_voice_write" on realtime.messages;
create policy "room_voice_write" on realtime.messages for insert to authenticated with check (
  extension in ('presence', 'broadcast')
  and (select realtime.topic()) ~ '^room-voice:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (select public.can_access_room(split_part((select realtime.topic()), ':', 2)::uuid))
);

-- ============ 3. Out-of-order Stripe subscription events ============
-- Idempotency was per-event-id only, and the upsert overwrote `status`
-- unconditionally — so a delayed `customer.subscription.updated` (active) landing
-- after `customer.subscription.deleted` (revoked) would re-grant premium. Track
-- the source event's timestamp and only apply status/note from an event at least
-- as new as the last one applied.
alter table public.premium_entitlements add column if not exists last_event_at timestamptz;

drop function if exists public.process_stripe_subscription_event(text, text, uuid, text, text, timestamptz, text);

create or replace function public.process_stripe_subscription_event(
  p_event_id text,
  p_event_type text,
  p_user uuid,
  p_subscription text,
  p_status text,
  p_period_end timestamptz,
  p_price_id text,
  p_event_created timestamptz default null
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

  insert into public.premium_entitlements(user_id, source, status, starts_at, expires_at, external_ref, note, last_event_at)
  values (
    p_user,
    'subscription',
    case when v_active then 'active' else 'revoked' end,
    now(),
    greatest(coalesce(p_period_end, now()), now() + interval '1 second'),
    p_subscription,
    case when p_price_id is null then null else 'price:' || p_price_id end,
    p_event_created
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

revoke execute on function public.process_stripe_subscription_event(text, text, uuid, text, text, timestamptz, text, timestamptz) from public, anon, authenticated;
grant execute on function public.process_stripe_subscription_event(text, text, uuid, text, text, timestamptz, text, timestamptz) to service_role;

-- ============ 4. Restrict host room updates to `music` ============
-- rooms_update_host lets a host update their own room, but the default
-- table-wide UPDATE grant let them rewrite started_at (reshuffling everyone's
-- shared timer), visibility, invite_code, or cap. The client only ever sends
-- `music`, so scope the column privilege to match.
revoke update on public.rooms from authenticated;
grant update (music) on public.rooms to authenticated;

-- QA hardening pass. Run once in Supabase Dashboard → SQL Editor.
-- Safe to run more than once.
--
-- 1) Missing indexes: tasks and friendships are always filtered by user
--    columns (RLS + queries) but had no index — sequential scans at scale.
-- 2) Atomic AI-upload quota: the old read-then-write reservation in
--    api/generate-tasks let parallel requests race past the per-user cap and
--    the app-wide spend ceiling. reserve_ai_upload() does the check and
--    increment in ONE row-locked UPDATE, so concurrency can't evade it.
-- 3) Private room chat: room_messages was readable by ANY signed-in user.
--    Now: your own messages, messages in always-on (system) rooms, rooms you
--    host, and rooms you're actually inside (fresh heartbeat) only.

-- ============ 1) indexes ============
create index if not exists tasks_user on public.tasks (user_id);
create index if not exists friendships_requester on public.friendships (requester);
create index if not exists friendships_addressee on public.friendships (addressee);

-- ============ 2) atomic AI quota ============
create or replace function public.reserve_ai_upload(p_user uuid, p_period text, p_quota int, p_global_cap int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_global bigint;
begin
  -- Check + increment in one statement: the row lock serializes concurrent
  -- requests for the same user, so the cap holds under parallelism.
  update public.profiles
     set ai_uploads_count = case when ai_uploads_period = p_period then ai_uploads_count + 1 else 1 end,
         ai_uploads_period = p_period
   where id = p_user
     and (case when ai_uploads_period = p_period then ai_uploads_count else 0 end) < p_quota
  returning ai_uploads_count into v_count;

  if v_count is null then
    return 'quota_exceeded';
  end if;

  -- App-wide ceiling (circuit breaker for the Anthropic bill). Checked after
  -- our own increment so racers can only overshoot by in-flight requests.
  select coalesce(sum(ai_uploads_count), 0) into v_global
    from public.profiles
   where ai_uploads_period = p_period;
  if v_global > p_global_cap then
    update public.profiles
       set ai_uploads_count = greatest(ai_uploads_count - 1, 0)
     where id = p_user;
    return 'ai_at_capacity';
  end if;

  return 'ok';
end;
$$;

create or replace function public.refund_ai_upload(p_user uuid, p_period text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set ai_uploads_count = greatest(ai_uploads_count - 1, 0)
   where id = p_user
     and ai_uploads_period = p_period;
$$;

-- Server-only: the API calls these with the service role; clients never do.
revoke execute on function public.reserve_ai_upload(uuid, text, int, int) from public, anon, authenticated;
revoke execute on function public.refund_ai_upload(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_ai_upload(uuid, text, int, int) to service_role;
grant execute on function public.refund_ai_upload(uuid, text) to service_role;

-- ============ 3) participant-scoped room chat ============
drop policy if exists "room_messages_select_all" on public.room_messages;
drop policy if exists "room_messages_select_participants" on public.room_messages;
create policy "room_messages_select_participants"
  on public.room_messages for select
  to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.rooms r
       where r.id = room_messages.room_id
         and (r.is_system or r.host_id = auth.uid())
    )
    or exists (
      select 1 from public.room_heartbeats h
       where h.room_id = room_messages.room_id
         and h.user_id = auth.uid()
    )
  );

-- ============ 4) Stripe webhook dedupe / audit ============
-- Stripe retries webhooks; recording each event id makes processing exactly-
-- once and leaves an audit trail. Service-role only (no policies).
create table if not exists public.stripe_events (
  id text primary key,
  type text not null,
  created_at timestamptz not null default now()
);
alter table public.stripe_events enable row level security;

-- ============ 5) admin audit trail ============
-- Every premium grant/revoke records who did it, to whom, and when.
-- Service-role / SECURITY DEFINER writes only (no policies).
create table if not exists public.admin_audit (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth.users (id) on delete cascade,
  action text not null,
  target uuid,
  detail text,
  created_at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;

create or replace function public.admin_set_premium(p_user uuid, p_premium boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin';
  end if;
  update public.profiles
     set is_premium = p_premium,
         updated_at = now()
   where id = p_user;
  insert into public.admin_audit (admin_id, action, target, detail)
  values (auth.uid(), 'set_premium', p_user, case when p_premium then 'granted' else 'revoked' end);
end;
$$;

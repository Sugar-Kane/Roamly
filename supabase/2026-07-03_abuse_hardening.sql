-- Abuse hardening. Run once in Supabase Dashboard → SQL Editor → New query.
--
-- 1) room_heartbeats: participants ping while in a room, giving the server a
--    real emptiness signal — reap_room() then refuses to delete a room anyone
--    is actively in (closes a griefing hole where any signed-in user could
--    delete an active room >2 min old).
-- 2) rooms insert policy: hosting requires Premium (was client-only) and at
--    most 3 active hosted rooms per host.
-- 3) Chat rate limit: max 8 messages per user per room per 60s.
-- 4) Task cap: max 500 tasks per user.

-- ============ 1) heartbeats + safer reap ============
create table if not exists public.room_heartbeats (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.room_heartbeats enable row level security;

drop policy if exists "heartbeats_select_own" on public.room_heartbeats;
create policy "heartbeats_select_own"
  on public.room_heartbeats for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "heartbeats_insert_own" on public.room_heartbeats;
create policy "heartbeats_insert_own"
  on public.room_heartbeats for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "heartbeats_update_own" on public.room_heartbeats;
create policy "heartbeats_update_own"
  on public.room_heartbeats for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "heartbeats_delete_own" on public.room_heartbeats;
create policy "heartbeats_delete_own"
  on public.room_heartbeats for delete
  to authenticated
  using (auth.uid() = user_id);

create or replace function public.reap_room(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  delete from public.rooms r
   where r.id = p_room
     and r.is_system = false
     and r.created_at < now() - interval '2 minutes'
     and not exists (
       select 1 from public.room_heartbeats h
        where h.room_id = p_room
          and h.seen_at > now() - interval '2 minutes'
     );
end;
$$;

-- ============ 2) hosting: premium-only, max 3 active rooms ============
drop policy if exists "rooms_insert_own" on public.rooms;
create policy "rooms_insert_own"
  on public.rooms for insert
  to authenticated
  with check (
    auth.uid() = host_id
    and is_system = false
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_premium)
    and (select count(*) from public.rooms r where r.host_id = auth.uid() and r.is_system = false) < 3
  );

-- ============ 3) chat rate limit (extends the break-only trigger) ============
create or replace function public.enforce_break_chat()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  r public.rooms;
begin
  select * into r from public.rooms where id = new.room_id;
  if r.id is null then raise exception 'room_not_found'; end if;
  if public.room_phase(r, now()) = 'focus'
     and public.room_phase(r, now() - interval '10 seconds') = 'focus'
     and public.room_phase(r, now() + interval '10 seconds') = 'focus' then
    raise exception 'chat_closed_during_focus';
  end if;
  if (select count(*) from public.room_messages m
       where m.room_id = new.room_id
         and m.user_id = new.user_id
         and m.created_at > now() - interval '60 seconds') >= 8 then
    raise exception 'chat_rate_limited';
  end if;
  return new;
end;
$$;

-- ============ 4) task cap ============
create or replace function public.enforce_task_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.tasks t where t.user_id = new.user_id) >= 500 then
    raise exception 'task_limit_reached';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_limit on public.tasks;
create trigger tasks_limit
  before insert on public.tasks
  for each row execute function public.enforce_task_limit();

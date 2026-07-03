-- Roamly Focus — Supabase schema (Phase 3: live rooms, friends, notifications, chat)
-- Run this once in Supabase Dashboard → SQL Editor, AFTER schema.sql.

-- ============ profiles: public identity ============
-- Friends and rooms need a way to render *other* users. Email must stay
-- private (profiles RLS is own-row-only), so users pick a public username.
alter table public.profiles add column if not exists username text unique;
alter table public.profiles add column if not exists display_name text;

-- Usernames are set through this RPC — the client's UPDATE grant on profiles
-- is deliberately column-limited (see schema.sql) and doesn't include username.
create or replace function public.set_username(p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'invalid_username';
  end if;
  update public.profiles
     set username = p_username,
         display_name = coalesce(display_name, p_username),
         updated_at = now()
   where id = auth.uid();
end;
$$;
grant execute on function public.set_username(text) to authenticated;

-- Minimal public identity for rendering friends, room members, and chat.
-- security definer so it can read past the own-row-only RLS on profiles,
-- but it exposes nothing beyond id/username/display_name.
create or replace function public.get_public_profiles(p_ids uuid[])
returns table (id uuid, username text, display_name text)
language sql
security definer
set search_path = public
as $$
  select id, username, display_name
    from public.profiles
   where id = any (p_ids) and auth.uid() is not null;
$$;
grant execute on function public.get_public_profiles(uuid[]) to authenticated;

create or replace function public.search_users(p_query text)
returns table (id uuid, username text, display_name text)
language sql
security definer
set search_path = public
as $$
  select id, username, display_name
    from public.profiles
   where auth.uid() is not null
     and id <> auth.uid()
     and username is not null
     and length(trim(p_query)) >= 2
     and (username ilike trim(p_query) || '%' or display_name ilike '%' || trim(p_query) || '%')
   limit 10;
$$;
grant execute on function public.search_users(text) to authenticated;


-- ============ rooms ============
-- A room's timer never ticks anywhere: its phase is derived from wall-clock
-- time since started_at (see room_phase below and roomPhaseAt in src/rooms.ts),
-- so every participant computes the identical countdown and system rooms run
-- continuously forever with no cron or server process.
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 3 and 60),
  topic text not null default 'Open study' check (length(topic) <= 80),
  host_id uuid references auth.users (id) on delete cascade,
  is_system boolean not null default false,
  focus_min int not null default 25 check (focus_min between 5 and 180),
  short_min int not null default 5 check (short_min between 1 and 60),
  long_min int not null default 15 check (long_min between 5 and 90),
  cycles int not null default 4 check (cycles between 1 and 10),
  cap int not null default 12 check (cap between 2 and 50),
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

create policy "rooms_select_all"
  on public.rooms for select
  to authenticated
  using (true);

create policy "rooms_insert_own"
  on public.rooms for insert
  to authenticated
  with check (auth.uid() = host_id and is_system = false);

create policy "rooms_delete_host"
  on public.rooms for delete
  to authenticated
  using (auth.uid() = host_id);

-- No update policy: a room's schedule is immutable once created, which is
-- what keeps every participant's derived timer in agreement.

-- Where is the room's timer right now? Walks the cycle pattern
-- (focus, short) × (cycles-1), focus, long — anchored at started_at.
create or replace function public.room_phase(p_room public.rooms, p_at timestamptz)
returns text
language plpgsql
stable
as $$
declare
  f int := p_room.focus_min * 60;
  s int := p_room.short_min * 60;
  l int := p_room.long_min * 60;
  c int := p_room.cycles;
  total int := c * f + (c - 1) * s + l;
  e bigint;
  i int;
begin
  e := floor(extract(epoch from (p_at - p_room.started_at)))::bigint % total;
  if e < 0 then e := e + total; end if;
  for i in 1..c loop
    if e < f then return 'focus'; end if;
    e := e - f;
    if i < c then
      if e < s then return 'short'; end if;
      e := e - s;
    end if;
  end loop;
  return 'long';
end;
$$;

-- The four always-on community rooms. Fixed ids so re-running this file is a
-- no-op; staggered started_at so their breaks don't all land at once.
insert into public.rooms (id, name, topic, is_system, focus_min, short_min, long_min, cycles, cap, started_at)
values
  ('00000000-0000-4000-a000-000000000001', 'The Grind Hall',    'Classic 25/5 Pomodoro',             true, 25,  5, 15, 4, 50, now()),
  ('00000000-0000-4000-a000-000000000002', 'Deep Work Hall',    'Long 50/10 blocks for dense material', true, 50, 10, 20, 3, 50, now() - interval '18 minutes'),
  ('00000000-0000-4000-a000-000000000003', 'Sprint Studio',     'Quick 15/3 bursts for flashcards',  true, 15,  3, 10, 5, 50, now() - interval '7 minutes'),
  ('00000000-0000-4000-a000-000000000004', 'Marathon Library',  'Endurance 90/20 — library rules',   true, 90, 20, 30, 2, 50, now() - interval '45 minutes')
on conflict (id) do nothing;


-- ============ friendships ============
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  unique (requester, addressee),
  check (requester <> addressee)
);

alter table public.friendships enable row level security;

create policy "friendships_select_own"
  on public.friendships for select
  to authenticated
  using (auth.uid() = requester or auth.uid() = addressee);

create policy "friendships_delete_own"
  on public.friendships for delete
  to authenticated
  using (auth.uid() = requester or auth.uid() = addressee);

-- Insert/update happen only through the RPCs below (security definer), so a
-- notification is always written alongside and reverse-duplicates are checked.
revoke insert, update on public.friendships from authenticated;


-- ============ notifications ============
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade, -- recipient
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('friend_request', 'friend_accepted', 'room_invite', 'room_created', 'room_joined')),
  room_id uuid references public.rooms (id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_user_created on public.notifications (user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "notifications_select_own"
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id);

create policy "notifications_update_own"
  on public.notifications for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "notifications_delete_own"
  on public.notifications for delete
  to authenticated
  using (auth.uid() = user_id);

-- Clients may only flip the read flag; rows are created by the RPCs below.
revoke insert, update on public.notifications from authenticated;
grant update (read) on public.notifications to authenticated;


-- ============ friend RPCs ============
create or replace function public.send_friend_request(p_target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_target = auth.uid() then raise exception 'cannot_friend_self'; end if;
  if exists (select 1 from public.friendships
              where (requester = auth.uid() and addressee = p_target)
                 or (requester = p_target and addressee = auth.uid())) then
    raise exception 'already_exists';
  end if;
  insert into public.friendships (requester, addressee) values (auth.uid(), p_target);
  insert into public.notifications (user_id, actor_id, kind)
  values (p_target, auth.uid(), 'friend_request');
end;
$$;
grant execute on function public.send_friend_request(uuid) to authenticated;

create or replace function public.respond_friend_request(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  fr public.friendships;
begin
  select * into fr from public.friendships
   where id = p_id and addressee = auth.uid() and status = 'pending';
  if fr.id is null then raise exception 'request_not_found'; end if;
  if p_accept then
    update public.friendships set status = 'accepted' where id = p_id;
    insert into public.notifications (user_id, actor_id, kind)
    values (fr.requester, auth.uid(), 'friend_accepted');
  else
    delete from public.friendships where id = p_id;
  end if;
end;
$$;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;


-- ============ room notification RPCs ============
-- "Tell my friends I created/joined this room." Deduped so re-joining the
-- same room doesn't spam anyone more than once an hour.
create or replace function public.notify_friends_of_room(p_room uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if p_kind not in ('room_created', 'room_joined') then raise exception 'bad_kind'; end if;
  if not exists (select 1 from public.rooms where id = p_room) then
    raise exception 'room_not_found';
  end if;
  insert into public.notifications (user_id, actor_id, kind, room_id)
  select f.other, auth.uid(), p_kind, p_room
    from (select case when requester = auth.uid() then addressee else requester end as other
            from public.friendships
           where status = 'accepted'
             and (requester = auth.uid() or addressee = auth.uid())) f
   where not exists (
           select 1 from public.notifications n
            where n.user_id = f.other
              and n.actor_id = auth.uid()
              and n.room_id = p_room
              and n.kind = p_kind
              and n.created_at > now() - interval '1 hour');
end;
$$;
grant execute on function public.notify_friends_of_room(uuid, text) to authenticated;

create or replace function public.invite_to_room(p_room uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  if not exists (select 1 from public.friendships
                  where status = 'accepted'
                    and ((requester = auth.uid() and addressee = p_user)
                      or (requester = p_user and addressee = auth.uid()))) then
    raise exception 'not_friends';
  end if;
  if not exists (select 1 from public.rooms where id = p_room) then
    raise exception 'room_not_found';
  end if;
  insert into public.notifications (user_id, actor_id, kind, room_id)
  values (p_user, auth.uid(), 'room_invite', p_room);
end;
$$;
grant execute on function public.invite_to_room(uuid, uuid) to authenticated;


-- ============ room_messages (break-only chat) ============
create table public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index room_messages_room_created on public.room_messages (room_id, created_at desc);

alter table public.room_messages enable row level security;

-- Every room is joinable by any signed-in user, so chat history is readable
-- by any signed-in user too.
create policy "room_messages_select_all"
  on public.room_messages for select
  to authenticated
  using (true);

create policy "room_messages_insert_own"
  on public.room_messages for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Chat is usable only during breaks — enforced here, not just in the UI.
-- The ±10s window absorbs clock skew between a client's countdown and the
-- database clock right at a phase boundary.
create or replace function public.enforce_break_chat()
returns trigger
language plpgsql
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
  return new;
end;
$$;

create trigger room_messages_break_only
  before insert on public.room_messages
  for each row execute function public.enforce_break_chat();


-- ============ realtime ============
-- Live chat, live notification toasts, and lobby updates when rooms appear.
-- (Equivalent to toggling these tables on under Database → Replication.)
alter publication supabase_realtime add table public.room_messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.rooms;

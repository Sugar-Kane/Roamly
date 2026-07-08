-- Roamly Focus — Supabase schema
--
-- Snapshot of the live database (Supabase project "Roamly"), captured
-- 2026-07-02. Includes the original Phase 1 tables plus the social layer
-- (usernames, friends, study rooms, room chat, notifications) and the
-- security hardening applied via the advisor recommendations.
--
-- Running this file once on a fresh Supabase project recreates the schema:
-- Dashboard → SQL Editor → New query.

-- ============ profiles ============
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  is_premium boolean not null default false,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  daily_goal_minutes int not null default 120,
  exam_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ai_uploads_count int not null default 0,
  ai_uploads_period text,
  username text unique,
  display_name text
);

alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- SECURITY-CRITICAL: the policy above allows an authenticated user to UPDATE
-- their own row, but RLS is row-level, not column-level — without the grants
-- below, a signed-in user could run
--   supabase.from('profiles').update({ is_premium: true })
-- from their own browser console and give themselves Premium for free.
-- Column-level GRANTs close that gap. service_role (used only by our server
-- functions) is unaffected by these revokes and keeps full access.
-- ai_uploads_count/ai_uploads_period are deliberately left out of the grant
-- below too — they're only ever written by api/generate-tasks.ts (service
-- role), never the client. username/display_name are also excluded: they're
-- only set through the set_username() RPC, which validates the format.
revoke update on public.profiles from authenticated;
grant update (daily_goal_minutes, exam_date) on public.profiles to authenticated;

-- No insert policy for authenticated/anon: profile rows are created only by
-- the trigger below (running as security definer), never directly by the client.

-- Auto-create a profile row whenever a new auth.users row appears.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ============ focus_sessions ============
create table public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  minutes int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, date)
);

alter table public.focus_sessions enable row level security;

create policy "focus_sessions_select_own"
  on public.focus_sessions for select
  to authenticated
  using (auth.uid() = user_id);

create policy "focus_sessions_insert_own"
  on public.focus_sessions for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "focus_sessions_update_own"
  on public.focus_sessions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Atomic "add minutes to today's row, creating it if needed" RPC. Runs as
-- security invoker (the default), so it's still subject to the RLS policies
-- above — auth.uid() here is always the caller's own id, never a
-- client-supplied value, so a user can never log time against someone else's
-- account.
create or replace function public.log_focus_minutes(p_date date, p_minutes int)
returns void
language sql
set search_path = public
as $$
  insert into public.focus_sessions (user_id, date, minutes)
  values (auth.uid(), p_date, p_minutes)
  on conflict (user_id, date)
  do update set minutes = public.focus_sessions.minutes + excluded.minutes,
                updated_at = now();
$$;

grant execute on function public.log_focus_minutes(date, int) to authenticated;


-- ============ tasks ============
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  tag text not null default 'General',
  done boolean not null default false,
  poms int not null default 0,
  est int not null default 2,
  sort_order int, -- user-controlled ordering (Tasks page reorder arrows); null sorts last
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks enable row level security;

create policy "tasks_select_own"
  on public.tasks for select
  to authenticated
  using (auth.uid() = user_id);

create policy "tasks_insert_own"
  on public.tasks for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "tasks_update_own"
  on public.tasks for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "tasks_delete_own"
  on public.tasks for delete
  to authenticated
  using (auth.uid() = user_id);

-- Bloat guard: at most 500 tasks per user.
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

create trigger tasks_limit
  before insert on public.tasks
  for each row execute function public.enforce_task_limit();


-- ============ invitations ============
-- Audit + rate-limit for the "invite by email" flow. Written only by the
-- api/invite serverless function (service role); no client RLS policies.
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  invited_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index invitations_inviter_created
  on public.invitations (inviter_id, created_at desc);

alter table public.invitations enable row level security;


-- ============ admins ============
-- Allowlist of admin user ids. No RLS policies are added, so clients can't
-- read or write this table directly — only the SECURITY DEFINER functions
-- below and service_role touch it. Seed your own id once, e.g.:
--   insert into public.admins (user_id)
--   select id from auth.users where email = 'you@example.com';
create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Admin-only user lookup (returns emails + premium status). The is_admin()
-- guard is in the WHERE clause, so a non-admin caller simply gets no rows.
create or replace function public.admin_search_users(p_query text)
returns table (id uuid, email text, username text, display_name text, is_premium boolean)
language sql
security definer
set search_path = public
as $$
  select p.id, p.email, p.username, p.display_name, p.is_premium
    from public.profiles p
   where public.is_admin()
     and length(trim(p_query)) >= 1
     and (p.email ilike '%' || trim(p_query) || '%'
       or p.username ilike '%' || trim(p_query) || '%'
       or p.display_name ilike '%' || trim(p_query) || '%')
   order by p.email
   limit 25;
$$;

revoke execute on function public.admin_search_users(text) from public, anon;
grant execute on function public.admin_search_users(text) to authenticated;

-- Admin-only Premium grant/revoke. Raises if the caller isn't an admin, so it
-- can't be used to self-upgrade even though it's callable by authenticated.
create or replace function public.admin_set_premium(p_user uuid, p_premium boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  update public.profiles set is_premium = p_premium, updated_at = now() where id = p_user;
end;
$$;

revoke execute on function public.admin_set_premium(uuid, boolean) from public, anon;
grant execute on function public.admin_set_premium(uuid, boolean) to authenticated;


-- ============ rooms ============
-- Shared Pomodoro study rooms. The timer phase is derived from started_at and
-- the cycle settings (see room_phase below), so rooms have no mutable "state"
-- column and there is deliberately NO update policy — rooms are immutable
-- after creation (host can only delete).
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) >= 3 and length(trim(name)) <= 60),
  topic text not null default 'Open study' check (length(topic) <= 80),
  host_id uuid references auth.users (id) on delete cascade,
  is_system boolean not null default false,
  focus_min int not null default 25 check (focus_min >= 5 and focus_min <= 180),
  short_min int not null default 5 check (short_min >= 1 and short_min <= 60),
  long_min int not null default 15 check (long_min >= 5 and long_min <= 90),
  cycles int not null default 4 check (cycles >= 1 and cycles <= 10),
  cap int not null default 12 check (cap >= 2 and cap <= 50),
  music text not null default 'lofi',
  started_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.rooms enable row level security;

create policy "rooms_select_all"
  on public.rooms for select
  to authenticated
  using (true);

-- Hosting is Premium-only and capped at 3 active hosted rooms per host —
-- enforced here, not just in the UI, so the API can't be scripted around.
create policy "rooms_insert_own"
  on public.rooms for insert
  to authenticated
  with check (
    auth.uid() = host_id
    and is_system = false
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_premium)
    and (select count(*) from public.rooms r where r.host_id = auth.uid() and r.is_system = false) < 3
  );

create policy "rooms_delete_host"
  on public.rooms for delete
  to authenticated
  using (auth.uid() = host_id);

-- A host may change their own hosted room's music (client only sends `music`);
-- the check blocks flipping it into a system room or reassigning the host.
create policy "rooms_update_host"
  on public.rooms for update
  to authenticated
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id and is_system = false);

-- Participants ping a heartbeat while in a room (RoomView upserts every 60s,
-- deletes on leave), giving the server a real emptiness signal for reaping.
create table public.room_heartbeats (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (room_id, user_id)
);

alter table public.room_heartbeats enable row level security;

create policy "heartbeats_select_own"
  on public.room_heartbeats for select
  to authenticated
  using (auth.uid() = user_id);

create policy "heartbeats_insert_own"
  on public.room_heartbeats for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "heartbeats_update_own"
  on public.room_heartbeats for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "heartbeats_delete_own"
  on public.room_heartbeats for delete
  to authenticated
  using (auth.uid() = user_id);

-- Auto-cleanup for hosted rooms left empty. The room delete policy above is
-- host-only, but any lobby viewer can observe that a room has sat empty and
-- should be reaped — so this SECURITY DEFINER function lets them delete it,
-- guarded three ways: non-system rooms only, older than 90 seconds, and no
-- participant heartbeat in the last 60 seconds (so an active room can never be
-- deleted out from under its members).
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
     and r.created_at < now() - interval '90 seconds'
     and not exists (
       select 1 from public.room_heartbeats h
        where h.room_id = p_room
          and h.seen_at > now() - interval '60 seconds'
     );
end;
$$;

revoke execute on function public.reap_room(uuid) from public, anon;
grant execute on function public.reap_room(uuid) to authenticated;

-- Global sweep, independent of any browser: hosted rooms empty for ~1 minute
-- are deleted, and NO hosted room outlives 12 hours (the hard cap that stops
-- a scripted client keeping a room alive forever). Runs via pg_cron every
-- minute when the extension is enabled, plus best-effort from the client on
-- every lobby load as a fallback.
create or replace function public.reap_stale_rooms()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.rooms r
   where r.is_system = false
     and r.created_at < now() - interval '90 seconds'
     and not exists (
       select 1 from public.room_heartbeats h
        where h.room_id = r.id
          and h.seen_at > now() - interval '60 seconds'
     );

  delete from public.rooms r
   where r.is_system = false
     and r.created_at < now() - interval '12 hours';

  delete from public.room_heartbeats h
   where h.seen_at < now() - interval '1 hour';
end;
$$;

revoke execute on function public.reap_stale_rooms() from public, anon;
grant execute on function public.reap_stale_rooms() to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('reap-stale-rooms', '* * * * *', 'select public.reap_stale_rooms()');
  else
    raise notice 'pg_cron not enabled — enable it under Database -> Extensions for scheduled room cleanup.';
  end if;
end;
$$;

-- Pure function: which phase ('focus' | 'short' | 'long') a room is in at a
-- given instant, derived from its start time and cycle settings.
create or replace function public.room_phase(p_room public.rooms, p_at timestamptz)
returns text
language plpgsql
stable
set search_path = public
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


-- ============ friendships ============
-- Row direction matters: requester sent the request, addressee received it.
-- Writes go exclusively through the send_friend_request / respond_friend_request
-- RPCs below (see the revokes after the policies), so the state machine
-- (pending → accepted, or pending → deleted) can't be bypassed by direct
-- table writes. Clients keep select (see own edges) and delete (unfriend /
-- cancel / decline).
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

revoke insert, update on public.friendships from authenticated;


-- ============ notifications ============
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('friend_request', 'friend_accepted', 'room_invite', 'room_created', 'room_joined')),
  room_id uuid references public.rooms (id) on delete cascade,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_user_created
  on public.notifications (user_id, created_at desc);

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

-- Notifications are created only by the SECURITY DEFINER RPCs below, and the
-- only field a client may change on its own notifications is `read`
-- (column-level grant, same pattern as profiles above).
revoke insert, update on public.notifications from authenticated;
grant update (read) on public.notifications to authenticated;


-- ============ room_messages ============
create table public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (length(trim(body)) >= 1 and length(trim(body)) <= 500),
  created_at timestamptz not null default now()
);

create index room_messages_room_created
  on public.room_messages (room_id, created_at desc);

alter table public.room_messages enable row level security;

create policy "room_messages_select_all"
  on public.room_messages for select
  to authenticated
  using (true);

create policy "room_messages_insert_own"
  on public.room_messages for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Chat is break-only: reject messages while the room is in a focus phase.
-- The ±10s checks add tolerance at phase boundaries so a message sent right
-- as a break starts/ends isn't unfairly rejected by clock skew.
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
  -- Flood guard: at most 8 messages per user per room per minute.
  if (select count(*) from public.room_messages m
       where m.room_id = new.room_id
         and m.user_id = new.user_id
         and m.created_at > now() - interval '60 seconds') >= 8 then
    raise exception 'chat_rate_limited';
  end if;
  return new;
end;
$$;

create trigger room_messages_break_only
  before insert on public.room_messages
  for each row execute function public.enforce_break_chat();


-- ============ social RPCs ============
-- All SECURITY DEFINER (they need to write friendships/notifications rows the
-- caller couldn't insert directly, and read profiles the caller can't select),
-- so each one validates auth.uid() itself. Execution is restricted to
-- signed-in users by the revoke/grant block at the end of this section.

-- Set (or change) the caller's unique username; also initializes display_name
-- on first set.
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

-- Look up other users' public fields (id/username/display_name only — never
-- email or premium status). profiles RLS only lets users select their own
-- row, so this definer function is the sanctioned window into other profiles.
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

-- Exact-email friend lookup for the "add friend by email" flow. Signed-in
-- callers only; case-insensitive match on a fully typed address (no partial
-- search, so emails can't be enumerated); never returns the email itself.
create or replace function public.find_user_by_email(p_email text)
returns table (id uuid, username text, display_name text)
language sql
security definer
set search_path = public
as $$
  select id, username, display_name
    from public.profiles
   where auth.uid() is not null
     and id <> auth.uid()
     and lower(email) = lower(trim(p_email));
$$;

-- Username/display-name search for the "add friend" flow. Requires a query of
-- at least 2 chars, excludes the caller, and only surfaces users who have
-- claimed a username.
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

-- Accept (status → accepted, notify requester) or decline (delete the row) a
-- pending request addressed to the caller.
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

-- Invite an accepted friend to a room (creates a room_invite notification).
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

-- Fan out a room_created/room_joined notification to all accepted friends,
-- de-duplicated per (friend, room, kind) within an hour so re-joins don't spam.
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

-- SECURITY DEFINER functions get EXECUTE granted to PUBLIC by default, which
-- would let anonymous visitors call them through PostgREST. Restrict all of
-- them to signed-in users (Supabase advisor lint 0028). service_role bypasses
-- grants and is unaffected.
revoke execute on function public.find_user_by_email(text) from public, anon;
revoke execute on function public.get_public_profiles(uuid[]) from public, anon;
revoke execute on function public.invite_to_room(uuid, uuid) from public, anon;
revoke execute on function public.notify_friends_of_room(uuid, text) from public, anon;
revoke execute on function public.respond_friend_request(uuid, boolean) from public, anon;
revoke execute on function public.search_users(text) from public, anon;
revoke execute on function public.send_friend_request(uuid) from public, anon;
revoke execute on function public.set_username(text) from public, anon;

grant execute on function public.find_user_by_email(text) to authenticated;
grant execute on function public.get_public_profiles(uuid[]) to authenticated;
grant execute on function public.invite_to_room(uuid, uuid) to authenticated;
grant execute on function public.notify_friends_of_room(uuid, text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.search_users(text) to authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.set_username(text) to authenticated;


-- ============ realtime ============
-- Tables the app subscribes to for live updates: profiles (is_premium flips
-- from the Stripe webhook), rooms and room_messages (live study rooms), and
-- notifications (badge count). Equivalent to Dashboard → Database →
-- Replication toggles.
alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.room_messages;
alter publication supabase_realtime add table public.notifications;


-- ============ usage metrics + feedback (2026-07-08) ============
-- 1) app_events: lightweight per-user feature-usage pings from the client
--    (insert-own only; clients can never read anyone's events).
-- 2) feedback: user-submitted feedback with diagnostic fields.
-- 3) Admin-only SECURITY DEFINER readers, gated on is_admin() like
--    admin_search_users.

-- ============ 1) events ============
create table if not exists public.app_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  device text not null default 'unknown' check (device in ('phone', 'tablet', 'pc', 'unknown')),
  meta text check (meta is null or char_length(meta) <= 80),
  created_at timestamptz not null default now()
);

create index if not exists app_events_created on public.app_events (created_at desc);
create index if not exists app_events_user_created on public.app_events (user_id, created_at desc);

alter table public.app_events enable row level security;

drop policy if exists "events_insert_own" on public.app_events;
create policy "events_insert_own"
  on public.app_events for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Abuse guard: silently drop (not error) anything past 2,000 events per user
-- per day, so a runaway client can't bloat the table or break the app.
create or replace function public.enforce_event_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.app_events e
       where e.user_id = new.user_id
         and e.created_at > now() - interval '1 day') >= 2000 then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists app_events_limit on public.app_events;
create trigger app_events_limit
  before insert on public.app_events
  for each row execute function public.enforce_event_limit();

-- ============ 2) feedback ============
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  category text not null check (category in ('bug', 'confusing', 'idea', 'other')),
  message text not null check (char_length(message) between 3 and 2000),
  repro text check (repro is null or char_length(repro) <= 40),
  page text check (page is null or char_length(page) <= 40),
  device text check (device is null or char_length(device) <= 20),
  platform text check (platform is null or char_length(platform) <= 160),
  created_at timestamptz not null default now()
);

create index if not exists feedback_created on public.feedback (created_at desc);

alter table public.feedback enable row level security;

drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own"
  on public.feedback for insert
  to authenticated
  with check (auth.uid() = user_id);

-- ============ 3) admin readers ============
create or replace function public.admin_overview()
returns table (total_users bigint, premium_users bigint, active_7d bigint, feedback_total bigint)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*) from public.profiles),
    (select count(*) from public.profiles where is_premium),
    (select count(distinct user_id) from public.app_events where created_at > now() - interval '7 days'),
    (select count(*) from public.feedback)
  where public.is_admin();
$$;

create or replace function public.admin_event_stats(p_days int default 14)
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
     and e.created_at > now() - make_interval(days => greatest(1, least(p_days, 90)))
   group by e.name
   order by total desc;
$$;

create or replace function public.admin_daily_activity(p_days int default 14)
returns table (day date, events bigint, active_users bigint)
language sql
security definer
set search_path = public
stable
as $$
  select e.created_at::date as day,
         count(*) as events,
         count(distinct e.user_id) as active_users
    from public.app_events e
   where public.is_admin()
     and e.created_at > now() - make_interval(days => greatest(1, least(p_days, 90)))
   group by 1
   order by 1 desc;
$$;

create or replace function public.admin_list_feedback(p_limit int default 50)
returns table (id uuid, email text, username text, category text, message text, repro text, page text, device text, platform text, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select f.id, p.email, p.username, f.category, f.message, f.repro, f.page, f.device, f.platform, f.created_at
    from public.feedback f
    left join public.profiles p on p.id = f.user_id
   where public.is_admin()
   order by f.created_at desc
   limit greatest(1, least(p_limit, 200));
$$;

revoke execute on function public.admin_overview() from public, anon;
revoke execute on function public.admin_event_stats(int) from public, anon;
revoke execute on function public.admin_daily_activity(int) from public, anon;
revoke execute on function public.admin_list_feedback(int) from public, anon;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_event_stats(int) to authenticated;
grant execute on function public.admin_daily_activity(int) to authenticated;
grant execute on function public.admin_list_feedback(int) to authenticated;

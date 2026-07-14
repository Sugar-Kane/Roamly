-- Roamly Focus — Supabase schema
--
-- Snapshot of the live database (Supabase project "Roamly"). The first section
-- is the 2026-07-02 capture: the original Phase 1 tables plus the social layer
-- (usernames, friends, study rooms, room chat, notifications) and the security
-- hardening applied via the advisor recommendations. The section at the end
-- folds in releases 2–6 from supabase/migrations/ (entitlements + credit ledger,
-- study insights, private rooms + stat-sharing + private voice, and the review
-- hardening), so this file alone recreates the current schema.
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
  exam_name text check (exam_name is null or char_length(exam_name) <= 60),
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
grant update (daily_goal_minutes, exam_date, exam_name) on public.profiles to authenticated;

-- ============ exam schedules ============
create table public.exam_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  exam_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_schedules_unique_user_exam unique (user_id, name, exam_date)
);

create index exam_schedules_user_date_idx on public.exam_schedules (user_id, exam_date, created_at);
alter table public.exam_schedules enable row level security;
grant select, insert, delete on table public.exam_schedules to authenticated;
grant update (name, exam_date, updated_at) on table public.exam_schedules to authenticated;
create policy "exam_schedules_select_own" on public.exam_schedules for select to authenticated using ((select auth.uid()) = user_id);
create policy "exam_schedules_insert_own" on public.exam_schedules for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "exam_schedules_update_own" on public.exam_schedules for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "exam_schedules_delete_own" on public.exam_schedules for delete to authenticated using ((select auth.uid()) = user_id);

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
     and (length(trim(coalesce(p_query, ''))) = 0
       or p.email ilike '%' || trim(p_query) || '%'
       or p.username ilike '%' || trim(p_query) || '%'
       or p.display_name ilike '%' || trim(p_query) || '%')
   order by p.email
   limit 200;
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
  -- SET NULL, not CASCADE: hosted rooms are reaped ~60s after emptying, and a
  -- cascade silently deleted room invites before invitees ever saw them.
  room_id uuid references public.rooms (id) on delete set null,
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
  created_at timestamptz not null default now(),
  -- Ticket lifecycle (2026-07-09): admins triage feedback and each row mirrors
  -- to a GitHub issue so fixes can be tracked there.
  status text not null default 'open' check (status in ('open', 'in_progress', 'done')),
  admin_reply text,
  github_issue_number int,
  github_issue_url text,
  updated_at timestamptz not null default now()
);

create index if not exists feedback_created on public.feedback (created_at desc);

alter table public.feedback enable row level security;

drop policy if exists "feedback_insert_own" on public.feedback;
create policy "feedback_insert_own"
  on public.feedback for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Read-own so insert().select() can return the new row's id (used to mirror
-- the feedback to a GitHub issue). Admins read everyone's via the RPC.
drop policy if exists "feedback_select_own" on public.feedback;
create policy "feedback_select_own"
  on public.feedback for select
  to authenticated
  using (auth.uid() = user_id);

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
returns table (
  id uuid, email text, username text, category text, message text,
  repro text, page text, device text, platform text, created_at timestamptz,
  status text, admin_reply text, github_issue_number int, github_issue_url text, updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select f.id, p.email, p.username, f.category, f.message, f.repro, f.page,
         f.device, f.platform, f.created_at,
         f.status, f.admin_reply, f.github_issue_number, f.github_issue_url, f.updated_at
    from public.feedback f
    left join public.profiles p on p.id = f.user_id
   where public.is_admin()
   order by (case f.status when 'open' then 0 when 'in_progress' then 1 else 2 end),
            f.created_at desc
   limit greatest(1, least(p_limit, 200));
$$;

-- Search one user's activity timeline (2026-07-09) — admin-only, matches on
-- email / username / display name, newest events first.
create or replace function public.admin_user_activity(p_query text, p_limit int default 200)
returns table (email text, username text, name text, event text, meta text, device text, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select p.email, p.username, p.display_name as name,
         e.name as event, e.meta, e.device, e.created_at
    from public.app_events e
    join public.profiles p on p.id = e.user_id
   where public.is_admin()
     and coalesce(nullif(trim(p_query), ''), '') <> ''
     and (p.email ilike '%' || p_query || '%'
          or p.username ilike '%' || p_query || '%'
          or p.display_name ilike '%' || p_query || '%')
   order by e.created_at desc
   limit greatest(1, least(p_limit, 500));
$$;

revoke execute on function public.admin_overview() from public, anon;
revoke execute on function public.admin_event_stats(int) from public, anon;
revoke execute on function public.admin_daily_activity(int) from public, anon;
revoke execute on function public.admin_list_feedback(int) from public, anon;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_event_stats(int) to authenticated;
grant execute on function public.admin_daily_activity(int) to authenticated;
grant execute on function public.admin_list_feedback(int) to authenticated;
revoke execute on function public.admin_user_activity(text, int) from public, anon;
grant execute on function public.admin_user_activity(text, int) to authenticated;


-- ============ QA hardening (2026-07-08): indexes, atomic AI quota, private chat, stripe dedupe, admin audit ============
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

-- ============ AI upload credits (2026-07-10): one-time purchasable packs ============
-- Credits are extra AI uploads bought as one-time Stripe packs. They never
-- expire and are consumed only after the monthly allowance runs out. Only the
-- server changes balances (existing column grants block client writes).
alter table public.profiles
  add column if not exists ai_credits int not null default 0;

-- Grant credits after a verified Stripe payment (called by the webhook).
create or replace function public.add_ai_credits(p_user uuid, p_credits int)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set ai_credits = ai_credits + greatest(p_credits, 0)
   where id = p_user;
$$;

-- Atomically spend one credit: 'ok' when consumed, 'no_credits' when empty.
create or replace function public.consume_ai_credit(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left int;
begin
  update public.profiles
     set ai_credits = ai_credits - 1
   where id = p_user
     and ai_credits > 0
  returning ai_credits into v_left;
  if v_left is null then
    return 'no_credits';
  end if;
  return 'ok';
end;
$$;

revoke execute on function public.add_ai_credits(uuid, int) from public, anon, authenticated;
revoke execute on function public.consume_ai_credit(uuid) from public, anon, authenticated;
grant execute on function public.add_ai_credits(uuid, int) to service_role;
grant execute on function public.consume_ai_credit(uuid) to service_role;

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


-- ============================================================
-- Releases 2–6, folded in from supabase/migrations/ (timestamp
-- order). This section is a reconstruction from the migration
-- files, not a fresh pg_dump — verify against `supabase db dump`
-- if the live DB has had changes applied outside these files.
-- ============================================================


-- ======== folded from 20260712193216_release_2_entitlements.sql ========

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


-- ======== folded from 20260712195255_admin_revoke_premium.sql ========

-- Restore the admin portal's ability to revoke Premium access. This only
-- changes Roamly entitlements; it does not cancel an external Stripe plan.
create or replace function public.admin_revoke_premium(p_user uuid, p_reason text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_revoked int;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_user is null then raise exception 'invalid_user'; end if;

  update public.premium_entitlements
     set status = 'revoked',
         note = coalesce(nullif(left(trim(p_reason), 500), ''), note),
         updated_at = now()
   where user_id = p_user
     and status = 'active'
     and starts_at <= now()
     and expires_at > now();
  get diagnostics v_revoked = row_count;

  update public.profiles
     set is_premium = public.has_active_premium(p_user),
         updated_at = now()
   where id = p_user;
  if not found then raise exception 'profile_not_found'; end if;

  insert into public.admin_audit(admin_id, action, target, detail)
  values (
    v_admin,
    'premium_revoke',
    p_user,
    v_revoked::text || ' active entitlement(s) revoked' ||
      case when nullif(trim(p_reason), '') is null then '' else '; ' || left(trim(p_reason), 500) end
  );

  return v_revoked;
end;
$$;

revoke execute on function public.admin_revoke_premium(uuid, text) from public, anon;
grant execute on function public.admin_revoke_premium(uuid, text) to authenticated;


-- ======== folded from 20260712195902_release_3_study_insights.sql ========

-- Release 3: detailed study events and explicit planned sessions.
-- The existing focus_sessions daily totals remain the source for streaks and
-- historical totals. New events add task/category dimensions going forward.

create table public.study_session_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  task_title text check (task_title is null or char_length(task_title) <= 500),
  category text not null default 'Uncategorized' check (char_length(category) between 1 and 80),
  minutes int not null check (minutes between 1 and 1440),
  session_kind text not null check (session_kind in ('countdown', 'count_up', 'room')),
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index study_session_events_user_completed_idx
  on public.study_session_events(user_id, completed_at desc);
create index study_session_events_task_idx
  on public.study_session_events(task_id) where task_id is not null;

alter table public.study_session_events enable row level security;
grant select, insert on table public.study_session_events to authenticated;
create policy "study_events_select_own" on public.study_session_events
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "study_events_insert_own" on public.study_session_events
  for insert to authenticated with check ((select auth.uid()) = user_id);
-- The application writes through record_focus_session() so the daily aggregate
-- and detailed event are committed together.

create table public.planned_study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  task_title text check (task_title is null or char_length(task_title) <= 500),
  category text not null default 'Uncategorized' check (char_length(category) between 1 and 80),
  scheduled_for timestamptz not null,
  expected_minutes int not null default 25 check (expected_minutes between 5 and 480),
  status text not null default 'planned' check (status in ('planned', 'completed', 'missed')),
  missed_reason text check (missed_reason is null or missed_reason in ('Traveling', 'Sick', 'Too vague', 'Bad timing', 'Too tired', 'Schedule conflict', 'Forgot', 'Lost motivation', 'Too difficult', 'Other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'missed' or missed_reason is null)
);

create index planned_study_sessions_user_schedule_idx
  on public.planned_study_sessions(user_id, scheduled_for desc);
create index planned_study_sessions_task_idx
  on public.planned_study_sessions(task_id) where task_id is not null;

alter table public.planned_study_sessions enable row level security;
grant select, insert, update, delete on table public.planned_study_sessions to authenticated;
create policy "planned_sessions_select_own" on public.planned_study_sessions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "planned_sessions_insert_own" on public.planned_study_sessions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "planned_sessions_update_own" on public.planned_study_sessions
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "planned_sessions_delete_own" on public.planned_study_sessions
  for delete to authenticated using ((select auth.uid()) = user_id);

create or replace function public.record_focus_session(
  p_date date,
  p_minutes int,
  p_task uuid default null,
  p_task_title text default null,
  p_category text default 'Uncategorized',
  p_kind text default 'countdown'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_event uuid;
  v_category text := coalesce(nullif(left(trim(p_category), 80), ''), 'Uncategorized');
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_minutes not between 1 and 1440 then raise exception 'invalid_minutes'; end if;
  if p_kind not in ('countdown', 'count_up', 'room') then raise exception 'invalid_session_kind'; end if;
  if p_task is not null and not exists (
    select 1 from public.tasks t where t.id = p_task and t.user_id = v_user
  ) then raise exception 'invalid_task'; end if;

  insert into public.focus_sessions(user_id, date, minutes)
  values (v_user, p_date, p_minutes)
  on conflict (user_id, date) do update
    set minutes = public.focus_sessions.minutes + excluded.minutes, updated_at = now();

  insert into public.study_session_events(user_id, task_id, task_title, category, minutes, session_kind)
  values (v_user, p_task, nullif(left(trim(p_task_title), 500), ''), v_category, p_minutes, p_kind)
  returning id into v_event;
  return v_event;
end;
$$;

revoke execute on function public.record_focus_session(date, int, uuid, text, text, text) from public, anon;
grant execute on function public.record_focus_session(date, int, uuid, text, text, text) to authenticated;


-- ======== folded from 20260712203515_release_5_social_privacy.sql ========

-- Release 5: database-enforced room privacy and analytics-sharing consent.

alter table public.rooms add column visibility text not null default 'public'
  check (visibility in ('public', 'private'));
alter table public.rooms add column invite_code text;
create unique index rooms_invite_code_uidx on public.rooms(invite_code) where invite_code is not null;

create table public.room_access (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('host', 'invited', 'public')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index room_access_user_idx on public.room_access(user_id, created_at desc);
alter table public.room_access enable row level security;
grant select on public.room_access to authenticated;
create policy "room_access_select_own" on public.room_access for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.can_access_room(p_room uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room and (
      r.is_system or r.visibility = 'public' or r.host_id = (select auth.uid()) or
      exists (select 1 from public.room_access a where a.room_id = r.id and a.user_id = (select auth.uid()))
    )
  );
$$;
revoke execute on function public.can_access_room(uuid) from public, anon;
grant execute on function public.can_access_room(uuid) to authenticated;

create or replace function public.prepare_room_access()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.visibility = 'private' and new.invite_code is null then
    new.invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  elsif new.visibility = 'public' then
    new.invite_code := null;
  end if;
  return new;
end;
$$;
create trigger rooms_prepare_access before insert on public.rooms
  for each row execute function public.prepare_room_access();

create or replace function public.add_room_host_access()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.host_id is not null then
    insert into public.room_access(room_id, user_id, role, invited_by)
    values (new.id, new.host_id, 'host', new.host_id) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger rooms_add_host_access after insert on public.rooms
  for each row execute function public.add_room_host_access();

insert into public.room_access(room_id, user_id, role, invited_by)
select id, host_id, 'host', host_id from public.rooms where host_id is not null
on conflict do nothing;

drop policy if exists "rooms_select_all" on public.rooms;
create policy "rooms_select_accessible" on public.rooms for select to authenticated
  using ((select public.can_access_room(id)));

drop policy if exists "heartbeats_insert_own" on public.room_heartbeats;
create policy "heartbeats_insert_accessible" on public.room_heartbeats for insert to authenticated
  with check ((select auth.uid()) = user_id and (select public.can_access_room(room_id)));
drop policy if exists "heartbeats_update_own" on public.room_heartbeats;
create policy "heartbeats_update_accessible" on public.room_heartbeats for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (select public.can_access_room(room_id)));

drop policy if exists "room_messages_insert_own" on public.room_messages;
create policy "room_messages_insert_accessible" on public.room_messages for insert to authenticated
  with check ((select auth.uid()) = user_id and (select public.can_access_room(room_id)));
drop policy if exists "room_messages_select_participants" on public.room_messages;
create policy "room_messages_select_accessible" on public.room_messages for select to authenticated
  using ((select public.can_access_room(room_id)) and (
    user_id = (select auth.uid()) or
    exists (select 1 from public.rooms r where r.id = room_id and (r.is_system or r.host_id = (select auth.uid()))) or
    exists (select 1 from public.room_heartbeats h where h.room_id = room_id and h.user_id = (select auth.uid()))
  ));

create or replace function public.join_room(p_room uuid, p_code text default null)
returns setof public.rooms language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  if (select auth.uid()) is null then raise exception 'not_signed_in'; end if;
  select * into v_room from public.rooms where id = p_room;
  if not found then raise exception 'room_not_found'; end if;
  if not (v_room.is_system or v_room.visibility = 'public' or v_room.host_id = (select auth.uid()) or
    exists(select 1 from public.room_access a where a.room_id=p_room and a.user_id=(select auth.uid())) or
    (p_code is not null and upper(trim(p_code)) = v_room.invite_code)) then
    raise exception 'room_access_denied';
  end if;
  insert into public.room_access(room_id,user_id,role)
  values (p_room,(select auth.uid()),case when v_room.visibility='public' or v_room.is_system then 'public' else 'invited' end)
  on conflict (room_id,user_id) do nothing;
  return next v_room;
end;
$$;
revoke execute on function public.join_room(uuid, text) from public, anon;
grant execute on function public.join_room(uuid, text) to authenticated;

create or replace function public.join_room_by_code(p_code text)
returns setof public.rooms language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.rooms where invite_code = upper(trim(p_code)) and visibility='private';
  if v_id is null then raise exception 'invalid_invite_code'; end if;
  return query select * from public.join_room(v_id, p_code);
end;
$$;
revoke execute on function public.join_room_by_code(text) from public, anon;
grant execute on function public.join_room_by_code(text) to authenticated;

-- Room presence channels are private and use the same database authorization.
create policy "room_presence_read" on realtime.messages for select to authenticated using (
  extension = 'presence' and (select realtime.topic()) ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and
  (select public.can_access_room(split_part((select realtime.topic()), ':', 2)::uuid))
);
create policy "room_presence_write" on realtime.messages for insert to authenticated with check (
  extension = 'presence' and (select realtime.topic()) ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and
  (select public.can_access_room(split_part((select realtime.topic()), ':', 2)::uuid))
);

create or replace function public.invite_to_room(p_room uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not_signed_in'; end if;
  if not exists(select 1 from public.rooms where id=p_room and host_id=(select auth.uid()) and is_system=false) then raise exception 'not_room_host'; end if;
  if not exists(select 1 from public.friendships where status='accepted' and
    ((requester=(select auth.uid()) and addressee=p_user) or (requester=p_user and addressee=(select auth.uid())))) then raise exception 'not_friends'; end if;
  insert into public.room_access(room_id,user_id,role,invited_by)
  values(p_room,p_user,'invited',(select auth.uid()))
  on conflict(room_id,user_id) do update set role='invited', invited_by=excluded.invited_by;
  insert into public.notifications(user_id,actor_id,kind,room_id)
  values(p_user,(select auth.uid()),'room_invite',p_room);
end;
$$;

-- Statistics sharing is separate from friendship and starts with no rows.
create table public.stat_comparison_permissions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved')),
  requested_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(owner_id,viewer_id),
  check(owner_id <> viewer_id)
);
create index stat_permissions_viewer_idx on public.stat_comparison_permissions(viewer_id,updated_at desc);
alter table public.stat_comparison_permissions enable row level security;
grant select on public.stat_comparison_permissions to authenticated;
create policy "stat_permissions_parties_read" on public.stat_comparison_permissions for select to authenticated
  using ((select auth.uid()) in (owner_id,viewer_id));

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check
  (kind in ('friend_request','friend_accepted','room_invite','room_created','room_joined','stats_request','stats_approved'));

create or replace function public.request_stat_comparison(p_friend uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.friendships where status='accepted' and
    ((requester=(select auth.uid()) and addressee=p_friend) or (requester=p_friend and addressee=(select auth.uid())))) then raise exception 'not_friends'; end if;
  insert into public.stat_comparison_permissions(owner_id,viewer_id,status,requested_by)
  values(p_friend,(select auth.uid()),'pending',(select auth.uid()))
  on conflict(owner_id,viewer_id) do update set status='pending',requested_by=excluded.requested_by,updated_at=now();
  insert into public.notifications(user_id,actor_id,kind) values(p_friend,(select auth.uid()),'stats_request');
end;
$$;

create or replace function public.respond_stat_comparison(p_viewer uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_approve then
    update public.stat_comparison_permissions set status='approved',updated_at=now()
    where owner_id=(select auth.uid()) and viewer_id=p_viewer and status='pending';
    if not found then raise exception 'request_not_found'; end if;
    insert into public.notifications(user_id,actor_id,kind) values(p_viewer,(select auth.uid()),'stats_approved');
  else
    delete from public.stat_comparison_permissions where owner_id=(select auth.uid()) and viewer_id=p_viewer and status='pending';
    if not found then raise exception 'request_not_found'; end if;
  end if;
end;
$$;

create or replace function public.revoke_stat_comparison(p_friend uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.stat_comparison_permissions
  where (owner_id=(select auth.uid()) and viewer_id=p_friend) or (owner_id=p_friend and viewer_id=(select auth.uid()));
end;
$$;

create or replace function public.get_friend_comparison(p_friend uuid)
returns table(focus_minutes bigint,session_count bigint,weekly_consistency bigint,achievements int,level int,category_minutes jsonb)
language sql security definer stable set search_path = '' as $$
  with allowed as (
    select 1 where exists(select 1 from public.stat_comparison_permissions p
      where p.owner_id=p_friend and p.viewer_id=(select auth.uid()) and p.status='approved')
    and exists(select 1 from public.friendships f where f.status='accepted' and
      ((f.requester=(select auth.uid()) and f.addressee=p_friend) or (f.requester=p_friend and f.addressee=(select auth.uid()))))
  ), totals as (
    select coalesce(sum(minutes),0)::bigint focus_minutes,
      count(*) filter(where minutes>0)::bigint active_days,
      count(*) filter(where date>=current_date-6 and minutes>0)::bigint weekly_consistency
    from public.focus_sessions,allowed where user_id=p_friend
  ), events as (
    select count(*)::bigint session_count from public.study_session_events,allowed where user_id=p_friend
  ), cats as (
    select coalesce(jsonb_object_agg(category,total),'{}'::jsonb) category_minutes from (
      select category,sum(minutes)::bigint total from public.study_session_events,allowed where user_id=p_friend group by category
    ) q
  )
  select t.focus_minutes,e.session_count,t.weekly_consistency,
    ((t.focus_minutes>0)::int+(t.focus_minutes>=600)::int+(t.focus_minutes>=1500)::int+(t.active_days>=7)::int) achievements,
    greatest(1,floor(t.focus_minutes/600.0)::int+1),c.category_minutes
  from totals t cross join events e cross join cats c where exists(select 1 from allowed);
$$;

revoke execute on function public.request_stat_comparison(uuid) from public,anon;
revoke execute on function public.respond_stat_comparison(uuid,boolean) from public,anon;
revoke execute on function public.revoke_stat_comparison(uuid) from public,anon;
revoke execute on function public.get_friend_comparison(uuid) from public,anon;
grant execute on function public.request_stat_comparison(uuid) to authenticated;
grant execute on function public.respond_stat_comparison(uuid,boolean) to authenticated;
grant execute on function public.revoke_stat_comparison(uuid) to authenticated;
grant execute on function public.get_friend_comparison(uuid) to authenticated;

revoke execute on function public.invite_to_room(uuid,uuid) from public,anon;
grant execute on function public.invite_to_room(uuid,uuid) to authenticated;


-- ======== folded from 20260712204156_release_5_private_voice.sql ========

create policy "room_voice_read"
on realtime.messages
for select
to authenticated
using (
  extension in ('presence', 'broadcast')
  and (select realtime.topic()) ~ '^room-voice:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (select public.can_access_room(split_part((select realtime.topic()), ':', 2)::uuid))
);

create policy "room_voice_write"
on realtime.messages
for insert
to authenticated
with check (
  extension in ('presence', 'broadcast')
  and (select realtime.topic()) ~ '^room-voice:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (select public.can_access_room(split_part((select realtime.topic()), ':', 2)::uuid))
);


-- ======== folded from 20260712205500_release_5_trigger_hardening.sql ========

-- Trigger functions must never be exposed as callable API RPCs.
revoke execute on function public.prepare_room_access() from public, anon, authenticated;
revoke execute on function public.add_room_host_access() from public, anon, authenticated;


-- ======== folded from 20260712210000_release_6_review_hardening.sql ========

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

-- ======== folded from 20260714013000_subscription_only_customer_premium.sql ========
-- Credit top-ups are standalone AI-upload credits. They must never create a
-- Premium entitlement. Customer-facing Premium is activated by Stripe
-- subscriptions; explicit admin grants remain an internal support override.

create or replace function public.process_stripe_credit_event(
  p_event_id text,
  p_event_type text,
  p_user uuid,
  p_credits int,
  p_external_ref text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted int;
begin
  if p_credits <= 0 then
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

  return 'processed';
end;
$$;

revoke execute on function public.process_stripe_credit_event(text, text, uuid, int, text) from public, anon, authenticated;
grant execute on function public.process_stripe_credit_event(text, text, uuid, int, text) to service_role;

-- Keep the former signature during rollout so an in-flight checkout created
-- by the previous deployment still grants its credits, while ignoring the old
-- premium-days value.
create or replace function public.process_stripe_credit_event(
  p_event_id text,
  p_event_type text,
  p_user uuid,
  p_credits int,
  p_premium_days int,
  p_external_ref text
)
returns text
language sql
security definer
set search_path = ''
as $$
  select public.process_stripe_credit_event(
    p_event_id,
    p_event_type,
    p_user,
    p_credits,
    p_external_ref
  );
$$;

revoke execute on function public.process_stripe_credit_event(text, text, uuid, int, int, text) from public, anon, authenticated;
grant execute on function public.process_stripe_credit_event(text, text, uuid, int, int, text) to service_role;

-- Trials are no longer a customer Premium path. Leave the function as a
-- harmless compatibility stub until all older clients have aged out.
create or replace function public.start_trial_if_eligible(p_user uuid)
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  select null::timestamptz;
$$;

revoke execute on function public.start_trial_if_eligible(uuid) from public, anon, authenticated;
grant execute on function public.start_trial_if_eligible(uuid) to service_role;

update public.premium_entitlements
   set status = 'revoked',
       note = case
         when note is null or note = '' then 'Customer Premium is subscription-only'
         else left(note || '; Customer Premium is subscription-only', 500)
       end,
       updated_at = now()
 where source in ('trial', 'credit_purchase')
   and status = 'active';

update public.profiles p
   set is_premium = public.has_active_premium(p.id),
       updated_at = now()
 where p.is_premium is distinct from public.has_active_premium(p.id);

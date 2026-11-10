-- Security assessment fixes (2026-11-10). Each block names its finding.

-- ============ RF-03: maintenance functions were executable by anyone ============
-- These SECURITY DEFINER sweeps never had EXECUTE revoked, so PostgREST let
-- anon/authenticated callers run them (repeated heavy aggregates and deletes,
-- incident creation → AI spend). pg_cron runs them as the owner and is unaffected.
revoke execute on function public.sh_sweep_contracts(integer)      from public, anon, authenticated;
revoke execute on function public.sh_sweep_journeys()              from public, anon, authenticated;
revoke execute on function public.sh_sweep_journey_health(integer) from public, anon, authenticated;
revoke execute on function public.sh_sweep_flag_rollback()         from public, anon, authenticated;
revoke execute on function public.sh_rollup_and_prune()            from public, anon, authenticated;

-- ============ RF-02: room chat pings on a private Realtime channel ============
-- Chat used a PUBLIC broadcast channel whose payloads the client rendered as
-- messages. The client now sends only a message id on the private topic
-- room-chat-ping:<room uuid> and fetches the row through RLS. These policies
-- limit that topic to people who can access the room (same gate as voice).
drop policy if exists "room_chat_ping_read" on realtime.messages;
create policy "room_chat_ping_read" on realtime.messages for select to authenticated using (
  extension in ('presence', 'broadcast')
  and (select realtime.topic()) ~ '^room-chat-ping:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (select public.can_access_room(split_part((select realtime.topic()), ':', 2)::uuid))
);
drop policy if exists "room_chat_ping_write" on realtime.messages;
create policy "room_chat_ping_write" on realtime.messages for insert to authenticated with check (
  extension = 'broadcast'
  and (select realtime.topic()) ~ '^room-chat-ping:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (select public.can_access_room(split_part((select realtime.topic()), ':', 2)::uuid))
);

-- ============ attempt log for rate-limited RPCs (RF-04, RF-08) ============
create table if not exists public.rpc_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists rpc_attempts_user_kind_at on public.rpc_attempts (user_id, kind, at desc);
alter table public.rpc_attempts enable row level security;
revoke all on table public.rpc_attempts from public, anon, authenticated;

-- ============ RF-04: private-room codes could be brute-forced ============
-- 6-character codes (32^6 ≈ 1.07 billion) stay, as chosen for readability; what
-- was missing was any limit on guesses. Ten wrong codes per account per hour.
-- A wrong code returns an empty result instead of raising, because raising
-- would roll back the recorded miss. The client treats empty as "not valid".
create or replace function public.join_room_by_code(p_code text)
returns setof public.rooms
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id uuid;
begin
  if v_user is null then raise exception 'not_signed_in'; end if;
  delete from public.rpc_attempts where user_id = v_user and at < now() - interval '1 day';
  if (select count(*) from public.rpc_attempts a
       where a.user_id = v_user and a.kind = 'room_code_miss' and a.at > now() - interval '1 hour') >= 10 then
    raise exception 'too_many_attempts';
  end if;
  select r.id into v_id from public.rooms r
   where r.invite_code = upper(trim(p_code)) and r.visibility = 'private';
  if v_id is null then
    insert into public.rpc_attempts (user_id, kind) values (v_user, 'room_code_miss');
    return;
  end if;
  return query select * from public.join_room(v_id, p_code);
end;
$$;
revoke execute on function public.join_room_by_code(text) from public, anon;
grant execute on function public.join_room_by_code(text) to authenticated;

-- ============ RF-08: email → account lookups were unlimited ============
create or replace function public.find_user_by_email(p_email text)
returns table (id uuid, username text, display_name text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then return; end if;
  if (select count(*) from public.rpc_attempts a
       where a.user_id = v_user and a.kind = 'email_lookup' and a.at > now() - interval '1 hour') >= 30 then
    raise exception 'too_many_lookups';
  end if;
  insert into public.rpc_attempts (user_id, kind) values (v_user, 'email_lookup');
  return query
    select p.id, p.username, p.display_name from public.profiles p
     where p.id <> v_user and lower(p.email) = lower(trim(p_email));
end;
$$;
revoke execute on function public.find_user_by_email(text) from public, anon;
grant execute on function public.find_user_by_email(text) to authenticated;

-- ============ RF-13: ad submissions could set their own status ============
revoke insert on public.ad_submissions from authenticated;
grant insert (user_id, ad_type, business_name, target_url, contact_email, plan, note)
  on public.ad_submissions to authenticated;
alter table public.ad_submissions drop constraint if exists ad_submissions_target_url_http;
alter table public.ad_submissions add constraint ad_submissions_target_url_http
  check (target_url ~* '^https?://') not valid;

-- ============ RF-15: self-reported focus minutes were unbounded ============
-- A browser timer can't be verified server-side, but a day still has 1440
-- minutes: clamp the per-day total, reject future dates, and cap how many
-- session events one account can add per day.
alter table public.focus_sessions drop constraint if exists focus_sessions_minutes_range;
alter table public.focus_sessions add constraint focus_sessions_minutes_range
  check (minutes between 0 and 1440) not valid;

create or replace function public.log_focus_minutes(p_date date, p_minutes int)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  if p_minutes not between 1 and 1440 then raise exception 'invalid_minutes'; end if;
  if p_date > current_date + 1 then raise exception 'invalid_date'; end if;
  insert into public.focus_sessions (user_id, date, minutes)
  values ((select auth.uid()), p_date, p_minutes)
  on conflict (user_id, date)
  do update set minutes = least(1440, public.focus_sessions.minutes + excluded.minutes),
                updated_at = now();
end;
$$;
revoke execute on function public.log_focus_minutes(date, int) from public, anon;
grant execute on function public.log_focus_minutes(date, int) to authenticated;

create or replace function public.record_focus_session(
  p_date date,
  p_minutes int,
  p_task uuid default null,
  p_task_title text default null,
  p_category text default 'Uncategorized',
  p_kind text default 'countdown',
  p_group_size int default 1
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
  v_group int := least(1000, greatest(1, coalesce(p_group_size, 1)));
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_minutes not between 1 and 1440 then raise exception 'invalid_minutes'; end if;
  if p_date > current_date + 1 then raise exception 'invalid_date'; end if;
  if p_kind not in ('countdown', 'count_up', 'room') then raise exception 'invalid_session_kind'; end if;
  if p_task is not null and not exists (
    select 1 from public.tasks t where t.id = p_task and t.user_id = v_user
  ) then raise exception 'invalid_task'; end if;

  insert into public.focus_sessions(user_id, date, minutes)
  values (v_user, p_date, p_minutes)
  on conflict (user_id, date) do update
    set minutes = least(1440, public.focus_sessions.minutes + excluded.minutes), updated_at = now();

  insert into public.study_session_events(user_id, task_id, task_title, category, minutes, session_kind, group_size)
  values (v_user, p_task, nullif(left(trim(p_task_title), 500), ''), v_category, p_minutes, p_kind, v_group)
  returning id into v_event;
  return v_event;
end;
$$;
revoke execute on function public.record_focus_session(date, int, uuid, text, text, text, int) from public, anon;
grant execute on function public.record_focus_session(date, int, uuid, text, text, text, int) to authenticated;

create or replace function public.enforce_study_event_daily_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.study_session_events e
       where e.user_id = new.user_id and e.created_at > now() - interval '1 day') >= 300 then
    raise exception 'too_many_sessions_today';
  end if;
  return new;
end;
$$;
drop trigger if exists study_event_daily_cap on public.study_session_events;
create trigger study_event_daily_cap
  before insert on public.study_session_events
  for each row execute function public.enforce_study_event_daily_cap();

-- ============ RF-05 (part 1): admin membership without the aal check ============
-- Lets the app tell an admin "turn on two-step verification" once is_admin()
-- starts requiring it (next migration). Only ever answers about the caller.
create or replace function public.is_admin_member()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;
revoke execute on function public.is_admin_member() from public, anon;
grant execute on function public.is_admin_member() to authenticated;

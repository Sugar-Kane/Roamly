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

-- Usage metrics + in-app feedback. Run once in Supabase Dashboard → SQL Editor.
-- Safe to run more than once.
--
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

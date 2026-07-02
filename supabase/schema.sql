-- Roamly Focus — Supabase schema (Phase 1)
-- Run this once in Supabase Dashboard → SQL Editor → New query.

-- ============ profiles ============
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  is_premium boolean not null default false,
  stripe_customer_id text unique,
  stripe_subscription_id text,
  daily_goal_minutes int not null default 120,
  exam_date date,
  ai_uploads_count int not null default 0,
  ai_uploads_period text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
-- role), never the client, so a signed-in user can't reset their own quota.
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

-- After running this file, also enable Realtime replication for the
-- `profiles` table: Database → Replication → toggle `profiles` on. This lets
-- the app reflect a Stripe webhook's is_premium update live, without a
-- manual refresh.

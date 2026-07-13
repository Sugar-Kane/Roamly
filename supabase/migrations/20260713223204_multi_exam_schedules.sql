-- Allow each signed-in user to track multiple exam countdowns on Focus.

create table public.exam_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 60),
  exam_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_schedules_unique_user_exam unique (user_id, name, exam_date)
);

create index exam_schedules_user_date_idx
  on public.exam_schedules (user_id, exam_date, created_at);

alter table public.exam_schedules enable row level security;

grant select, insert, delete on table public.exam_schedules to authenticated;
grant update (name, exam_date, updated_at) on table public.exam_schedules to authenticated;

create policy "exam_schedules_select_own"
  on public.exam_schedules for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "exam_schedules_insert_own"
  on public.exam_schedules for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "exam_schedules_update_own"
  on public.exam_schedules for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "exam_schedules_delete_own"
  on public.exam_schedules for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Preserve every user's existing single countdown as their first schedule row.
insert into public.exam_schedules (user_id, name, exam_date)
select id, coalesce(nullif(trim(exam_name), ''), 'Exam'), exam_date
from public.profiles
where exam_date is not null
on conflict (user_id, name, exam_date) do nothing;

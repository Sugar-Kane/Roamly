-- Client-side error reporting. Uncaught JS errors and React render crashes are
-- written here (insert-own) and read by admins via admin_list_errors, so the
-- owner can see production breakages without an external service.
-- Safe to run more than once.

create table if not exists public.client_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  message text not null check (char_length(message) between 1 and 500),
  stack text check (stack is null or char_length(stack) <= 2000),
  page text check (page is null or char_length(page) <= 40),
  device text check (device is null or char_length(device) <= 20),
  platform text check (platform is null or char_length(platform) <= 160),
  created_at timestamptz not null default now()
);

create index if not exists client_errors_created on public.client_errors (created_at desc);

alter table public.client_errors enable row level security;

drop policy if exists "client_errors_insert_own" on public.client_errors;
create policy "client_errors_insert_own"
  on public.client_errors for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Abuse guard: silently drop (not error) past 200 error rows per user per day.
create or replace function public.enforce_error_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.client_errors e
       where e.user_id = new.user_id
         and e.created_at > now() - interval '1 day') >= 200 then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists client_errors_limit on public.client_errors;
create trigger client_errors_limit
  before insert on public.client_errors
  for each row execute function public.enforce_error_limit();

create or replace function public.admin_list_errors(p_limit int default 100)
returns table (id uuid, email text, username text, message text, stack text, page text, device text, platform text, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select e.id, p.email, p.username, e.message, e.stack, e.page, e.device, e.platform, e.created_at
    from public.client_errors e
    left join public.profiles p on p.id = e.user_id
   where public.is_admin()
   order by e.created_at desc
   limit greatest(1, least(p_limit, 500));
$$;

revoke execute on function public.admin_list_errors(int) from public, anon;
grant execute on function public.admin_list_errors(int) to authenticated;

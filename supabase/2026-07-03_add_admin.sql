-- Admin area: grant/revoke Premium for free. Run once in Supabase Dashboard →
-- SQL Editor → New query.
--
-- Premium is a protected column (only service_role can write it via RLS), so
-- granting it from the app needs these SECURITY DEFINER functions, each gated
-- by an admins allowlist. After running this, seed yourself as an admin with
-- the INSERT at the bottom (edit the email first).

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.admins enable row level security;
-- No RLS policies: only SECURITY DEFINER functions + service_role touch it.

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

-- Make yourself an admin (edit the email to yours):
-- insert into public.admins (user_id)
-- select id from auth.users where email = 'you@example.com'
-- on conflict do nothing;

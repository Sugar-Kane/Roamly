-- Let the admin Users tab list everyone by default, not only after a search.
-- admin_search_users previously required a non-empty query (returned nothing
-- for a blank one). Now a blank/whitespace query returns all users, while a
-- non-empty query filters as before. Still SECURITY DEFINER + is_admin()-gated.
-- Limit raised so the full roster shows for an early-stage user base.
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

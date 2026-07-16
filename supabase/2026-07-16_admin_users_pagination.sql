-- Admin Users tab scalability (~1,000+ users): server-side pagination,
-- sorting, and filtering with a total count, replacing the client's habit of
-- pulling the whole roster (admin_search_users caps at 200 rows and has no
-- count, so the old UI both over-fetched and silently truncated).
--
-- Same security model as every other admin RPC: SECURITY DEFINER gated on
-- public.is_admin() inside the query itself, EXECUTE revoked from anon. A
-- non-admin calling it directly gets zero rows.
--
-- admin_search_users is left in place untouched — the client falls back to it
-- when this migration hasn't been applied yet.

create or replace function public.admin_list_users(
  p_query text default '',
  p_plan text default 'all',        -- 'all' | 'premium' | 'free' | 'admin'
  p_activity text default 'all',    -- 'all' | 'active' (events in 30d) | 'inactive'
  p_sort text default 'created_at', -- 'created_at' | 'email' | 'name' | 'credits' | 'last_active'
  p_dir text default 'desc',        -- 'asc' | 'desc'
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  id uuid, email text, username text, display_name text, is_premium boolean,
  ai_credits int, ai_uploads_count int, ai_uploads_period text,
  premium_expires_at timestamptz, created_at timestamptz, last_active timestamptz,
  total_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with filtered as (
    select p.id, p.email, p.username, p.display_name, p.is_premium,
           coalesce(p.ai_credits, 0) as ai_credits,
           coalesce(p.ai_uploads_count, 0) as ai_uploads_count,
           p.ai_uploads_period,
           (select max(e.expires_at) from public.premium_entitlements e
             where e.user_id = p.id and e.status = 'active' and e.expires_at > now()) as premium_expires_at,
           p.created_at,
           -- app_events (user_id, created_at desc) index makes this a cheap
           -- backward index scan per row.
           (select max(a.created_at) from public.app_events a where a.user_id = p.id) as last_active
      from public.profiles p
     where public.is_admin()
       and (length(trim(coalesce(p_query, ''))) = 0
         or p.email ilike '%' || trim(p_query) || '%'
         or p.username ilike '%' || trim(p_query) || '%'
         or p.display_name ilike '%' || trim(p_query) || '%')
       and (case
              when p_plan = 'premium' then p.is_premium
              when p_plan = 'free' then not p.is_premium
              when p_plan = 'admin' then exists (select 1 from public.admins ad where ad.user_id = p.id)
              else true
            end)
  ),
  activity_filtered as (
    select f.* from filtered f
     where case
             when p_activity = 'active' then f.last_active > now() - interval '30 days'
             when p_activity = 'inactive' then f.last_active is null or f.last_active <= now() - interval '30 days'
             else true
           end
  )
  select af.*, count(*) over () as total_count
    from activity_filtered af
   order by
     (case when p_sort = 'email' and p_dir = 'asc' then lower(af.email) end) asc nulls last,
     (case when p_sort = 'email' and p_dir <> 'asc' then lower(af.email) end) desc nulls last,
     (case when p_sort = 'name' and p_dir = 'asc' then lower(coalesce(af.display_name, af.username, af.email)) end) asc nulls last,
     (case when p_sort = 'name' and p_dir <> 'asc' then lower(coalesce(af.display_name, af.username, af.email)) end) desc nulls last,
     (case when p_sort = 'credits' and p_dir = 'asc' then af.ai_credits end) asc,
     (case when p_sort = 'credits' and p_dir <> 'asc' then af.ai_credits end) desc,
     (case when p_sort = 'last_active' and p_dir = 'asc' then af.last_active end) asc nulls last,
     (case when p_sort = 'last_active' and p_dir <> 'asc' then af.last_active end) desc nulls last,
     (case when p_sort = 'created_at' and p_dir = 'asc' then af.created_at end) asc,
     af.created_at desc
   limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke execute on function public.admin_list_users(text, text, text, text, text, int, int) from public, anon;
grant execute on function public.admin_list_users(text, text, text, text, text, int, int) to authenticated;

-- Signup-date sorting hits this directly; ~free at 1k rows but keeps the
-- common default sort index-backed as the table grows.
create index if not exists profiles_created_at on public.profiles (created_at desc);

-- Follow-up to release 11: surface stats_public on public profiles so the
-- friends UI can offer a direct "Compare" action for friends who have enabled
-- public sharing (no per-friend request needed). Without this the viewer had no
-- way to know sharing was on, so the public toggle wasn't usable end to end.
--
-- stats_public is a low-sensitivity preference ("I share my stats with
-- friends"); exposing it to signed-in callers is fine. get_friend_comparison
-- still enforces the real access check (Premium viewer + accepted friendship +
-- approved-or-public), so this only affects which button the UI shows.

drop function if exists public.get_public_profiles(uuid[]);
create or replace function public.get_public_profiles(p_ids uuid[])
returns table (id uuid, username text, display_name text, stats_public boolean)
language sql
security definer
set search_path = public
as $$
  select id, username, display_name, stats_public
    from public.profiles
   where id = any (p_ids) and auth.uid() is not null;
$$;

revoke execute on function public.get_public_profiles(uuid[]) from public, anon;
grant execute on function public.get_public_profiles(uuid[]) to authenticated;

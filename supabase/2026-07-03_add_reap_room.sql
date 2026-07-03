-- Auto-end for empty hosted study rooms. Run once in Supabase Dashboard →
-- SQL Editor → New query (or applied via MCP).
--
-- The rooms delete policy is host-only, but a room going empty is observed via
-- Realtime presence by any lobby viewer, not just the host. This SECURITY
-- DEFINER function lets any signed-in viewer reap a stale room, guarded to
-- non-system rooms older than 2 minutes so a freshly created room is never
-- removed. The app calls it only for rooms it has watched sit empty for 2 min.

create or replace function public.reap_room(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  delete from public.rooms
   where id = p_room
     and is_system = false
     and created_at < now() - interval '2 minutes';
end;
$$;

revoke execute on function public.reap_room(uuid) from public, anon;
grant execute on function public.reap_room(uuid) to authenticated;

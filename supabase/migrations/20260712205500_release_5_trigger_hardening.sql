-- Trigger functions must never be exposed as callable API RPCs.
revoke execute on function public.prepare_room_access() from public, anon, authenticated;
revoke execute on function public.add_room_host_access() from public, anon, authenticated;

-- Reliable room cleanup, independent of anyone's browser.
--
-- Before this, reaping only happened when a signed-in user sat on the lobby
-- page (their client observed emptiness and called reap_room), so rooms could
-- linger forever. Now a single sweep function deletes:
--   1. hosted rooms with nobody inside for ~1 minute (no fresh heartbeat);
--   2. ANY hosted room older than 12 hours — the hard lifetime cap that stops
--      a scripted client from keeping a room alive forever;
--   3. stale heartbeat rows (hygiene).
-- It runs two ways: pg_cron every minute (primary — enable the extension in
-- Dashboard -> Database -> Extensions -> pg_cron), and best-effort from the
-- client whenever anyone loads the lobby (fallback).
--
-- Safe to run more than once.

create or replace function public.reap_stale_rooms()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Empty for ~1 minute: no heartbeat fresher than 60s. The 90s age guard
  -- keeps a just-created room alive long enough for its first heartbeat.
  delete from public.rooms r
   where r.is_system = false
     and r.created_at < now() - interval '90 seconds'
     and not exists (
       select 1 from public.room_heartbeats h
        where h.room_id = r.id
          and h.seen_at > now() - interval '60 seconds'
     );

  -- Hard lifetime cap: no hosted room outlives 12 hours, occupied or not.
  delete from public.rooms r
   where r.is_system = false
     and r.created_at < now() - interval '12 hours';

  -- Orphaned heartbeats (closed tabs never delete their row).
  delete from public.room_heartbeats h
   where h.seen_at < now() - interval '1 hour';
end;
$$;

revoke execute on function public.reap_stale_rooms() from public, anon;
grant execute on function public.reap_stale_rooms() to authenticated;

-- Tighten single-room reap to the same 1-minute emptiness window.
create or replace function public.reap_room(p_room uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  delete from public.rooms r
   where r.id = p_room
     and r.is_system = false
     and r.created_at < now() - interval '90 seconds'
     and not exists (
       select 1 from public.room_heartbeats h
        where h.room_id = r.id
          and h.seen_at > now() - interval '60 seconds'
     );
end;
$$;

-- Schedule the sweep every minute if pg_cron is enabled; otherwise just note
-- it (the client-side fallback still sweeps on every lobby load).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('reap-stale-rooms', '* * * * *', 'select public.reap_stale_rooms()');
    raise notice 'pg_cron: reap-stale-rooms scheduled every minute.';
  else
    raise notice 'pg_cron not enabled — enable it under Database -> Extensions, then re-run this file for scheduled cleanup.';
  end if;
end;
$$;

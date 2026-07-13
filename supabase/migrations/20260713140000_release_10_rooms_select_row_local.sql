-- Release 10 — fix: room creation readback blocked by the select policy
--
-- The app creates rooms with insert-and-return in one call. The select
-- policy delegated to can_access_room(id), a STABLE function that looks the
-- room up in public.rooms — but inside the inserting statement's snapshot
-- the new row isn't visible yet, so the RETURNING check failed with 42501
-- ("new row violates row-level security policy") on every room creation.
--
-- Judge the row by its own columns instead: identical access semantics
-- (system / public / host / invited), no self-lookup, works mid-insert.
-- can_access_room() remains for the RPCs (join_room, chat, heartbeats).
drop policy if exists "rooms_select_accessible" on public.rooms;
create policy "rooms_select_accessible" on public.rooms for select to authenticated
  using (
    is_system
    or visibility = 'public'
    or host_id = (select auth.uid())
    or exists (select 1 from public.room_access a
                where a.room_id = id and a.user_id = (select auth.uid()))
  );

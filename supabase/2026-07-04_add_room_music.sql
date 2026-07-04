-- Room music: each room carries its own focus-sound track, shared by everyone
-- in it. The four always-on rooms are locked to lofi (the default below); a
-- host may change the track on their own hosted rooms.
--
-- Safe to run more than once.

alter table public.rooms
  add column if not exists music text not null default 'lofi';

-- Let a host update their own hosted room (rooms had no UPDATE policy before).
-- The client only ever sends `music`; the check keeps a host from flipping the
-- room into a system room or reassigning it.
drop policy if exists "rooms_update_host" on public.rooms;
create policy "rooms_update_host"
  on public.rooms for update
  to authenticated
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id and is_system = false);

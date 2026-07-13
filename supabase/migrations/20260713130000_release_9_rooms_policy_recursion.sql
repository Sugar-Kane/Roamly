-- Release 9 — fix: infinite recursion in rooms policies (42P17)
--
-- Room creation failed for everyone with "infinite recursion detected in
-- policy for relation rooms". The live DB carried a drifted policy set in
-- which evaluating a rooms policy re-entered a rooms policy (the insert
-- policy's hosted-room count subquery selects from rooms, which runs the
-- rooms SELECT policy under RLS).
--
-- Fix: both helper predicates run as SECURITY DEFINER (the function owner
-- bypasses RLS inside, so no policy can re-enter rooms), and the full rooms
-- policy set is dropped and recreated from canon — clearing any stale
-- variants left by partial manual applies.

create or replace function public.can_access_room(p_room uuid)
returns boolean language sql security definer stable set search_path = '' as $fn$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room and (
      r.is_system or r.visibility = 'public' or r.host_id = (select auth.uid()) or
      exists (select 1 from public.room_access a where a.room_id = r.id and a.user_id = (select auth.uid()))
    )
  );
$fn$;
revoke execute on function public.can_access_room(uuid) from public, anon;
grant execute on function public.can_access_room(uuid) to authenticated;

create or replace function public.hosted_room_count()
returns int language sql security definer stable set search_path = '' as $fn$
  select count(*)::int from public.rooms r
   where r.host_id = (select auth.uid()) and r.is_system = false;
$fn$;
revoke execute on function public.hosted_room_count() from public, anon;
grant execute on function public.hosted_room_count() to authenticated;

-- Drop EVERY policy on rooms, whatever it is named — stale variants from
-- earlier manual applies are exactly what caused the recursion.
do $fix$
declare pol record;
begin
  for pol in select polname from pg_policy where polrelid = 'public.rooms'::regclass loop
    execute format('drop policy %I on public.rooms', pol.polname);
  end loop;
end $fix$;

create policy "rooms_select_accessible" on public.rooms for select to authenticated
  using ((select public.can_access_room(id)));

create policy "rooms_insert_own" on public.rooms for insert to authenticated
  with check (
    (select auth.uid()) = host_id
    and is_system = false
    and (select public.has_my_active_premium())
    and (select public.hosted_room_count()) < 3
  );

create policy "rooms_update_host" on public.rooms for update to authenticated
  using ((select auth.uid()) = host_id)
  with check ((select auth.uid()) = host_id and is_system = false);

create policy "rooms_delete_host" on public.rooms for delete to authenticated
  using ((select auth.uid()) = host_id);

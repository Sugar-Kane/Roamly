-- Release 13: admin credit adjustment + reliable lobby room occupancy.
--
-- admin_adjust_credits: admins add or remove ONE purchased AI-upload credit at
-- a time (audited, ledgered, floored at zero). The strict ±1 contract matches
-- the admin UI's stepper and keeps accidental bulk changes impossible.
--
-- room_occupancy: the lobby's member counts previously depended entirely on
-- realtime presence channels, which fail silently (auth races, channel
-- errors) and left cards stuck at 0. Occupants already write room_heartbeats
-- every 20s, but heartbeats_select_own hides other users' rows — so expose
-- ONLY the aggregate count through a security-definer RPC and keep the raw
-- rows private.

create or replace function public.admin_adjust_credits(p_user uuid, p_delta int)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_balance int;
begin
  if v_admin is null or not exists (select 1 from public.admins a where a.user_id = v_admin) then
    raise exception 'not_admin';
  end if;
  if p_delta not in (1, -1) then raise exception 'invalid_delta'; end if;

  update public.profiles
     set ai_credits = greatest(0, coalesce(ai_credits, 0) + p_delta),
         updated_at = now()
   where id = p_user
     and (p_delta > 0 or coalesce(ai_credits, 0) > 0)
  returning ai_credits into v_balance;
  if not found then
    if not exists (select 1 from public.profiles where id = p_user) then
      raise exception 'user_not_found';
    end if;
    raise exception 'no_credits';
  end if;

  insert into public.credit_ledger(user_id, amount, reason, created_by)
  values (p_user, p_delta, 'admin_adjustment', v_admin);

  insert into public.admin_audit(admin_id, action, target, detail)
  values (v_admin, 'adjust_credits', p_user,
          format('%s 1 credit (balance now %s)', case when p_delta > 0 then 'Added' else 'Removed' end, v_balance));

  return v_balance;
end;
$$;

revoke execute on function public.admin_adjust_credits(uuid, int) from public, anon;
grant execute on function public.admin_adjust_credits(uuid, int) to authenticated;

-- Live-ish occupant counts for a set of rooms, from heartbeats fresher than
-- 60s (the same window the reap logic trusts). Aggregate only.
create or replace function public.room_occupancy(p_rooms uuid[])
returns table (room_id uuid, occupants bigint)
language sql
security definer
stable
set search_path = ''
as $$
  select h.room_id, count(distinct h.user_id)::bigint
    from public.room_heartbeats h
   where (select auth.uid()) is not null
     and h.room_id = any(p_rooms)
     and h.seen_at > now() - interval '60 seconds'
   group by h.room_id;
$$;

revoke execute on function public.room_occupancy(uuid[]) from public, anon;
grant execute on function public.room_occupancy(uuid[]) to authenticated;

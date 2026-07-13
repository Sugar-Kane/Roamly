-- An explicit admin revoke must remain authoritative. Previously, the client
-- immediately called start-trial again for any non-Premium confirmed account,
-- so a user who had never consumed a trial could regain access after revoke.
create or replace function public.start_trial_if_eligible(p_user uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expires timestamptz;
begin
  if p_user is null or p_user <> (select auth.uid()) then
    raise exception 'invalid_user';
  end if;

  if exists (
    select 1 from public.admin_audit a
     where a.target = p_user
       and a.action = 'premium_revoke'
  ) then
    return null;
  end if;

  insert into public.premium_entitlements(user_id, source, expires_at, external_ref)
  values (p_user, 'trial', now() + interval '30 days', 'trial:' || p_user::text)
  on conflict do nothing
  returning expires_at into v_expires;

  if v_expires is null then
    select e.expires_at into v_expires
      from public.premium_entitlements e
     where e.user_id = p_user and e.source = 'trial' and e.status = 'active';
  end if;

  update public.profiles
     set is_premium = public.has_active_premium(p_user), updated_at = now()
   where id = p_user;
  return v_expires;
end;
$$;

revoke execute on function public.start_trial_if_eligible(uuid) from public, anon, authenticated;
grant execute on function public.start_trial_if_eligible(uuid) to service_role;

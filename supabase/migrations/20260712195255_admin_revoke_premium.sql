-- Restore the admin portal's ability to revoke Premium access. This only
-- changes Roamly entitlements; it does not cancel an external Stripe plan.
create or replace function public.admin_revoke_premium(p_user uuid, p_reason text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := (select auth.uid());
  v_revoked int;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_user is null then raise exception 'invalid_user'; end if;

  update public.premium_entitlements
     set status = 'revoked',
         note = coalesce(nullif(left(trim(p_reason), 500), ''), note),
         updated_at = now()
   where user_id = p_user
     and status = 'active'
     and starts_at <= now()
     and expires_at > now();
  get diagnostics v_revoked = row_count;

  update public.profiles
     set is_premium = public.has_active_premium(p_user),
         updated_at = now()
   where id = p_user;
  if not found then raise exception 'profile_not_found'; end if;

  insert into public.admin_audit(admin_id, action, target, detail)
  values (
    v_admin,
    'premium_revoke',
    p_user,
    v_revoked::text || ' active entitlement(s) revoked' ||
      case when nullif(trim(p_reason), '') is null then '' else '; ' || left(trim(p_reason), 500) end
  );

  return v_revoked;
end;
$$;

revoke execute on function public.admin_revoke_premium(uuid, text) from public, anon;
grant execute on function public.admin_revoke_premium(uuid, text) to authenticated;

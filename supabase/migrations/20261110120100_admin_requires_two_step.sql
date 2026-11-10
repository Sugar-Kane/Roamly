-- RF-05 (part 2): admin access requires a two-step-verified session (aal2).
--
-- APPLY ONLY AFTER every admin has turned on two-step verification in Account
-- settings → Security, or they lose admin access until they do (nothing else
-- about their account changes). To roll back, re-run is_admin() without the
-- aal condition.
--
-- is_admin() is the single gate: 46 admin RPCs, the focus-music storage
-- policies and every admin API route (api/_admin.ts) ask it, so this one change
-- covers them all. admin_adjust_credits checked the admins table directly and
-- is moved onto is_admin() here.

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

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
  if v_admin is null or not public.is_admin() then
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

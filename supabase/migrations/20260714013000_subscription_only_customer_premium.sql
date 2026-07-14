-- Credit top-ups are standalone AI-upload credits. They must never create a
-- Premium entitlement. Customer-facing Premium is activated by Stripe
-- subscriptions; explicit admin grants remain an internal support override.

create or replace function public.process_stripe_credit_event(
  p_event_id text,
  p_event_type text,
  p_user uuid,
  p_credits int,
  p_external_ref text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted int;
begin
  if p_credits <= 0 then
    raise exception 'invalid_credit_event';
  end if;

  insert into public.stripe_events(id, type)
  values (p_event_id, p_event_type)
  on conflict (id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return 'duplicate'; end if;

  insert into public.credit_ledger(user_id, amount, reason, external_ref, stripe_event_id)
  values (p_user, p_credits, 'purchase', p_external_ref, p_event_id);

  update public.profiles
     set ai_credits = ai_credits + p_credits,
         updated_at = now()
   where id = p_user;
  if not found then raise exception 'profile_not_found'; end if;

  return 'processed';
end;
$$;

revoke execute on function public.process_stripe_credit_event(text, text, uuid, int, text) from public, anon, authenticated;
grant execute on function public.process_stripe_credit_event(text, text, uuid, int, text) to service_role;

-- Keep the former signature during rollout so an in-flight checkout created
-- by the previous deployment still grants its credits, while ignoring the old
-- premium-days value.
create or replace function public.process_stripe_credit_event(
  p_event_id text,
  p_event_type text,
  p_user uuid,
  p_credits int,
  p_premium_days int,
  p_external_ref text
)
returns text
language sql
security definer
set search_path = ''
as $$
  select public.process_stripe_credit_event(
    p_event_id,
    p_event_type,
    p_user,
    p_credits,
    p_external_ref
  );
$$;

revoke execute on function public.process_stripe_credit_event(text, text, uuid, int, int, text) from public, anon, authenticated;
grant execute on function public.process_stripe_credit_event(text, text, uuid, int, int, text) to service_role;

-- Trials are no longer a customer Premium path. Leave the function as a
-- harmless compatibility stub until all older clients have aged out.
create or replace function public.start_trial_if_eligible(p_user uuid)
returns timestamptz
language sql
security definer
set search_path = ''
as $$
  select null::timestamptz;
$$;

revoke execute on function public.start_trial_if_eligible(uuid) from public, anon, authenticated;
grant execute on function public.start_trial_if_eligible(uuid) to service_role;

update public.premium_entitlements
   set status = 'revoked',
       note = case
         when note is null or note = '' then 'Customer Premium is subscription-only'
         else left(note || '; Customer Premium is subscription-only', 500)
       end,
       updated_at = now()
 where source in ('trial', 'credit_purchase')
   and status = 'active';

update public.profiles p
   set is_premium = public.has_active_premium(p.id),
       updated_at = now()
 where p.is_premium is distinct from public.has_active_premium(p.id);

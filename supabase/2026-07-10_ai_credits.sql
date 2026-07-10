-- ============================================================================
-- 2026-07-10 — AI upload credits (one-time purchasable packs)
-- Idempotent: safe to run more than once. Paste the whole block into the
-- Supabase SQL editor and press Run once.
--
-- Credits are extra AI note uploads bought as one-time Stripe packs. They
-- never expire and are consumed only after the monthly allowance (3 free /
-- 30 premium) runs out. Only the server (service_role) may change balances —
-- the existing column-level grants on profiles already block client writes.
-- ============================================================================

alter table public.profiles
  add column if not exists ai_credits int not null default 0;

-- Grant credits after a verified Stripe payment (called by the webhook).
create or replace function public.add_ai_credits(p_user uuid, p_credits int)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set ai_credits = ai_credits + greatest(p_credits, 0)
   where id = p_user;
$$;

-- Atomically spend one credit. Returns 'ok' when a credit was consumed,
-- 'no_credits' when the balance is empty (the row-locked UPDATE makes
-- concurrent uploads unable to overspend).
create or replace function public.consume_ai_credit(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_left int;
begin
  update public.profiles
     set ai_credits = ai_credits - 1
   where id = p_user
     and ai_credits > 0
  returning ai_credits into v_left;
  if v_left is null then
    return 'no_credits';
  end if;
  return 'ok';
end;
$$;

revoke execute on function public.add_ai_credits(uuid, int) from public, anon, authenticated;
revoke execute on function public.consume_ai_credit(uuid) from public, anon, authenticated;
grant execute on function public.add_ai_credits(uuid, int) to service_role;
grant execute on function public.consume_ai_credit(uuid) to service_role;

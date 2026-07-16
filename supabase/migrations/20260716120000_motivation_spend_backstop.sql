-- Motivation AI spend backstop (2026-07-16).
--
-- /api/motivation was protected only by the Upstash burst limiter, which fails
-- OPEN when Upstash isn't configured — so with the limiter down, N valid JWTs
-- could drive unbounded Anthropic calls. This adds a DB-enforced per-user daily
-- cap plus an app-wide daily circuit breaker, mirroring reserve_ai_upload, so a
-- hard ceiling stands underneath the (best-effort) rate limiter. Server-only:
-- the endpoint calls reserve_motivation via the service-role client.

create table if not exists public.motivation_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  count int not null default 0,
  primary key (user_id, day)
);

-- Service-role only (like the other usage/billing tables): RLS on, no client
-- policies, so the anon/authenticated keys can neither read nor write it.
alter table public.motivation_usage enable row level security;

-- Reserve one motivation message for p_user today. Atomic: the upsert's row
-- lock serializes concurrent requests for the same user so the per-user cap
-- holds under parallelism. Returns 'ok' | 'daily_exceeded' | 'at_capacity'.
create or replace function public.reserve_motivation(p_user uuid, p_daily_cap int, p_global_cap int)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_count int;
  v_global bigint;
begin
  -- Check + increment in one statement. On first use today the INSERT wins;
  -- afterwards the conflicting row is updated only while under the cap, so an
  -- over-cap request affects 0 rows and RETURNING yields nothing.
  insert into public.motivation_usage (user_id, day, count)
    values (p_user, v_day, 1)
  on conflict (user_id, day) do update
    set count = public.motivation_usage.count + 1
    where public.motivation_usage.count < p_daily_cap
  returning count into v_count;

  if v_count is null then
    return 'daily_exceeded';
  end if;

  -- App-wide daily ceiling (circuit breaker for the Anthropic bill). Checked
  -- after our own increment, so racers can only overshoot by in-flight requests.
  select coalesce(sum(count), 0) into v_global
    from public.motivation_usage
   where day = v_day;
  if v_global > p_global_cap then
    update public.motivation_usage
       set count = greatest(count - 1, 0)
     where user_id = p_user and day = v_day;
    return 'at_capacity';
  end if;

  return 'ok';
end;
$$;

revoke execute on function public.reserve_motivation(uuid, int, int) from public, anon, authenticated;
grant execute on function public.reserve_motivation(uuid, int, int) to service_role;

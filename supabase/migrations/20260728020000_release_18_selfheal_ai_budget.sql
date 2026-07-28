-- Release 18: a hard monthly ceiling on self-healing AI spend.
--
-- Every Anthropic call the platform makes now appends one row here, and the
-- investigate loop refuses to start another incident once the calendar month's
-- total reaches SELFHEAL_MONTHLY_BUDGET_USD (default $4).
--
-- Why a dedicated ledger instead of summing the existing per-feature columns:
-- those columns drift. sh_diagnoses and sh_patches each carry a cost_usd, but
-- the reproduce stage never recorded its cost anywhere at all — so a budget
-- built on those columns would have silently undercounted from day one, which
-- is the specific failure mode a spending control cannot have. One append-only
-- table, written by one helper, is the whole truth.
--
-- Nothing reads this from the browser. It is service-role only, like the rest
-- of the platform's orchestration tables.

create table if not exists public.sh_ai_spend (
  id            uuid primary key default gen_random_uuid(),
  stage         text not null check (stage in ('diagnose', 'reproduce', 'patch')),
  model         text not null,
  incident_id   uuid references public.sh_incidents(id) on delete set null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd      numeric(10, 6) not null default 0,
  created_at    timestamptz not null default now()
);

-- The only query this table serves is "sum cost_usd for the current month",
-- run before every AI call, so the index matches that exactly.
create index if not exists sh_ai_spend_created_idx on public.sh_ai_spend (created_at desc);

comment on table public.sh_ai_spend is
  'Append-only ledger of every AI call made by the self-healing platform. Summed per calendar month to enforce SELFHEAL_MONTHLY_BUDGET_USD before spending more.';

-- RLS on with no policy: service role bypasses RLS, everyone else gets nothing.
-- Matches how the other sh_ orchestration tables are locked down.
alter table public.sh_ai_spend enable row level security;

revoke all on public.sh_ai_spend from anon, authenticated;

-- Backfill what we already know was spent, so the first month's ceiling counts
-- history instead of starting from zero. Reproduce attempts are absent by
-- necessity — their cost was never recorded and cannot be recovered.
insert into public.sh_ai_spend (stage, model, incident_id, input_tokens, output_tokens, cost_usd, created_at)
select 'diagnose', coalesce(model, 'unknown'), incident_id,
       coalesce(input_tokens, 0), coalesce(output_tokens, 0), coalesce(cost_usd, 0), created_at
from public.sh_diagnoses
where cost_usd is not null;

insert into public.sh_ai_spend (stage, model, incident_id, input_tokens, output_tokens, cost_usd, created_at)
select 'patch', coalesce(model, 'unknown'), incident_id, 0, 0, coalesce(cost_usd, 0), created_at
from public.sh_patches
where cost_usd is not null;

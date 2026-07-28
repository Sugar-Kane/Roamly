-- Release 19 — mean time to repair is measured, not remembered.
--
-- MTTR was `avg(repaired_ms)`, a snapshot column written in exactly one place:
-- admin_sh_set_incident, and only on its `resolved` branch. Every other way an
-- incident closes — a sweep, a patch deploy, an operator writing the row
-- directly — left repaired_ms NULL, and avg() skips NULLs silently. Those
-- resolutions moved the number by nothing at all.
--
-- The result was a metric that looked alive and was frozen. Of fourteen
-- incidents, two carried repaired_ms; both were resolved within a minute of
-- each other, and their average was what the dashboard kept showing no matter
-- how many tickets closed afterwards. It was not merely stale: those two took
-- ~6.6 hours while the later resolutions took ~18 minutes, so the figure
-- overstated repair time by roughly twenty times.
--
-- Deriving it from the timestamps that already exist removes the failure mode
-- instead of patching it. first_seen_at and resolved_at are written on every
-- close by every path, so the metric now moves the moment a ticket resolves,
-- whoever resolved it and however.
create or replace function public.admin_sh_overview(p_start timestamptz, p_end timestamptz)
returns table (
  open_incidents bigint, critical_incidents bigint, affected_users bigint,
  auto_resolved bigint, awaiting_approval bigint,
  mttd_seconds numeric, mttr_seconds numeric,
  outcome_success_rate numeric, journey_completion_rate numeric,
  sessions bigint, error_sessions bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*) from sh_incidents where status not in ('resolved','ignored','rejected')),
    (select count(*) from sh_incidents where status not in ('resolved','ignored','rejected') and severity = 'critical'),
    (select coalesce(sum(affected_users),0) from sh_incidents where last_seen_at between p_start and p_end),
    (select count(*) from sh_incidents i where i.resolved_at between p_start and p_end
       and exists (select 1 from sh_patches p where p.incident_id = i.id and p.approval_level = 'auto' and p.status = 'deployed')),
    (select count(*) from sh_patches where status in ('awaiting_approval','ci_passed')),
    (select avg(detected_ms) / 1000.0 from sh_incidents where created_at between p_start and p_end),
    -- Restricted to 'resolved': an incident that was ignored or rejected was
    -- never repaired, so counting it would let a batch of closed false
    -- positives masquerade as fast fixes. That matches what the old query
    -- effectively measured, since repaired_ms was only ever written there.
    -- The clock guard drops rows whose timestamps disagree rather than
    -- letting one negative duration drag the average below zero.
    (select avg(extract(epoch from (resolved_at - first_seen_at)))
       from sh_incidents
      where resolved_at between p_start and p_end
        and status = 'resolved'
        and resolved_at >= first_seen_at),
    (select case when sum(denominator) = 0 then null else sum(numerator)::numeric / sum(denominator) end
       from sh_metrics_hourly where metric = 'outcome.success_rate' and bucket between p_start and p_end),
    (select case when count(*) = 0 then null else
       count(*) filter (where status = 'succeeded')::numeric / count(*) end
       from sh_journey_runs where started_at between p_start and p_end),
    (select count(*) from sh_sessions where started_at between p_start and p_end),
    (select count(*) from sh_sessions where started_at between p_start and p_end and error_count > 0)
  where public.is_admin();
$$;

-- create or replace preserves privileges on an existing function; this is here
-- so the migration is still correct when replayed against a database where
-- admin_sh_overview is being created for the first time.
revoke execute on function public.admin_sh_overview(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_sh_overview(timestamptz, timestamptz) to authenticated;

-- Backfill the column for coherence, not because the metric needs it — nothing
-- in the app reads repaired_ms now. Leaving it NULL on most resolved rows,
-- purely because of which code path happened to close them, is a trap for
-- whoever queries the table next. admin_sh_set_incident still stamps it going
-- forward and is left alone.
update public.sh_incidents
   set repaired_ms = (extract(epoch from (resolved_at - first_seen_at)) * 1000)::int
 where repaired_ms is null
   and status = 'resolved'
   and resolved_at is not null
   and resolved_at >= first_seen_at;

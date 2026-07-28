-- Release 19b — count affected users, and be able to name them.
--
-- The KPI summed a per-incident counter:
--
--     select coalesce(sum(affected_users),0) from sh_incidents
--      where last_seen_at between p_start and p_end
--
-- while its tooltip promised "distinct users who hit an incident in this
-- window". A sum is not a distinct count, so one person hitting three
-- incidents reads as three users — which is exactly what the dashboard showed:
-- three incidents at affected_users = 1, one real human behind all of them.
--
-- 09-security-and-privacy.md says affected_users is "recounted from distinct
-- ids rather than incremented". That holds per incident; summing those
-- per-incident distinct counts at the dashboard level put the inflation back.
--
-- Counting distinct ids across the window fixes it at the level the claim is
-- made. Signed-out traffic carries no identity by design, so this counts
-- identified users only; admin_sh_affected_users below reports the anonymous
-- remainder separately rather than pretending it is zero.

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
    -- Distinct humans, not a sum of counters. Reads from the events that were
    -- actually attached to an incident, so it cannot drift from reality the
    -- way a stored counter does.
    (select count(distinct ev.user_id)
       from sh_events ev
      where ev.incident_id is not null
        and ev.user_id is not null
        and ev.ts between p_start and p_end),
    (select count(*) from sh_incidents i where i.resolved_at between p_start and p_end
       and exists (select 1 from sh_patches p where p.incident_id = i.id and p.approval_level = 'auto' and p.status = 'deployed')),
    (select count(*) from sh_patches where status in ('awaiting_approval','ci_passed')),
    (select avg(detected_ms) / 1000.0 from sh_incidents where created_at between p_start and p_end),
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

-- Who is actually hitting problems, worst-affected first.
--
-- "Everything attributable to a user is reachable by user_id across four
-- tables" is already the stated access model; this makes the dashboard use it
-- instead of leaving an operator to write the join by hand. Identity comes
-- from profiles, joined on the verified user_id the ingest route recorded —
-- never from anything a client claimed.
create or replace function public.admin_sh_affected_users(
  p_start timestamptz, p_end timestamptz, p_limit int default 50
)
returns table (
  user_id uuid, email text, display_name text,
  incidents bigint, events bigint,
  first_seen_at timestamptz, last_seen_at timestamptz,
  worst_severity public.sh_severity, last_route text, open_incidents bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select ev.user_id, p.email, p.display_name,
         count(distinct ev.incident_id),
         count(*),
         min(ev.ts), max(ev.ts),
         max(i.severity),
         (array_agg(ev.route order by ev.ts desc))[1],
         count(distinct ev.incident_id)
           filter (where i.status not in ('resolved','ignored','rejected'))
    from sh_events ev
    join sh_incidents i on i.id = ev.incident_id
    left join profiles p on p.id = ev.user_id
   where ev.user_id is not null
     and ev.ts between p_start and p_end
     and public.is_admin()
   group by ev.user_id, p.email, p.display_name
   order by count(distinct ev.incident_id) filter (where i.status not in ('resolved','ignored','rejected')) desc,
            count(distinct ev.incident_id) desc,
            max(ev.ts) desc
   limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

-- Per-incident: who hit THIS bug. Added alongside the existing `sessions`
-- list, which carries replay refs but no identity.
create or replace function public.admin_sh_incident_detail(p_id uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select case when not public.is_admin() then null else
    jsonb_build_object(
      'incident',  to_jsonb(i),
      'diagnosis', (select to_jsonb(d) from sh_diagnoses d where d.incident_id = i.id order by version desc limit 1),
      'diagnoses', (select coalesce(jsonb_agg(to_jsonb(d) order by d.version desc), '[]'::jsonb) from sh_diagnoses d where d.incident_id = i.id),
      'patches',   (select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc), '[]'::jsonb) from sh_patches p where p.incident_id = i.id),
      'repro',     (select coalesce(jsonb_agg(to_jsonb(r) order by r.attempt), '[]'::jsonb) from sh_repro_attempts r where r.incident_id = i.id),
      'evidence',  (select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'label', e.label, 'content', e.content,
                                                                'storage_ref', e.storage_ref, 'collected_at', e.collected_at)
                                     order by e.collected_at), '[]'::jsonb)
                      from sh_incident_evidence e where e.incident_id = i.id),
      'timeline',  (select coalesce(jsonb_agg(jsonb_build_object('at', a.at, 'actor', a.actor, 'action', a.action, 'detail', a.detail)
                                     order by a.at), '[]'::jsonb)
                      from sh_audit_log a where a.incident_id = i.id),
      'sessions',  (select coalesce(jsonb_agg(distinct jsonb_build_object('session_id', ev.session_id, 'replay_ref', s.replay_ref)), '[]'::jsonb)
                      from sh_events ev join sh_sessions s on s.id = ev.session_id
                     where ev.incident_id = i.id),
      'users',     (select coalesce(jsonb_agg(u.obj order by (u.obj->>'events')::int desc), '[]'::jsonb)
                      from (
                        select jsonb_build_object(
                                 'user_id',    ev.user_id,
                                 'email',      pr.email,
                                 'display_name', pr.display_name,
                                 'events',     count(*),
                                 'first_seen', min(ev.ts),
                                 'last_seen',  max(ev.ts)
                               ) as obj
                          from sh_events ev
                          left join profiles pr on pr.id = ev.user_id
                         where ev.incident_id = i.id and ev.user_id is not null
                         group by ev.user_id, pr.email, pr.display_name
                      ) u),
      -- Signed-out telemetry carries no identity by design, so the user list
      -- can never be the whole story. Reporting the remainder keeps an empty
      -- list from reading as "nobody was affected".
      'anonymous_sessions', (select count(distinct ev.session_id) from sh_events ev
                              where ev.incident_id = i.id and ev.user_id is null),
      'similar',   (select coalesce(jsonb_agg(jsonb_build_object('title', l.title, 'root_cause', l.root_cause,
                                                                'fix_summary', l.fix_summary, 'incident_id', l.incident_id)), '[]'::jsonb)
                      from sh_learning l where l.fingerprint = i.fingerprint or l.route = i.route limit 5)
    )
  end
  from sh_incidents i where i.id = p_id;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_sh_overview(timestamptz, timestamptz)',
    'public.admin_sh_incident_detail(uuid)',
    'public.admin_sh_affected_users(timestamptz, timestamptz, int)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

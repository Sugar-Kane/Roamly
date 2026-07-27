-- ===========================================================================
-- Roamly Self-Healing Platform — core schema (Phase 1)
-- ===========================================================================
--
-- Design notes (read before changing anything here):
--
-- 1. NO CLIENT WRITES. Unlike client_errors/app_events (which clients insert
--    directly under insert-own RLS), every table in this migration is written
--    ONLY by the service role via /api/telemetry. Reasons:
--      * signed-OUT sessions must be covered — RLS insert-own can't express that,
--        which is exactly why today's crash reporter drops anonymous crashes;
--      * the ingest endpoint is the single place to scrub PII, clamp payload
--        sizes, rate-limit by IP, and stamp server-side truth (ip_hash, geo,
--        release) that a client must never be trusted to supply;
--      * a compromised anon key then cannot forge incidents, flip flags, or
--        poison the learning corpus.
--    So: RLS is enabled everywhere and NO policies are created. Only the
--    service role and the SECURITY DEFINER RPCs below can see these rows.
--
-- 2. Reads for the dashboard go through is_admin()-gated SECURITY DEFINER
--    RPCs, matching the existing admin dashboard pattern exactly.
--
-- 3. Everything is fingerprint-deduplicated. One incident per (fingerprint,
--    open window) — occurrences increment a counter rather than creating rows,
--    so a broken deploy hitting 100k users is one incident, not 100k.
--
-- 4. Retention is explicit and enforced by pg_cron (bottom of file). Raw
--    telemetry is cheap to produce and expensive to keep; rollups are the
--    long-lived artifact.
--
-- Safe to run more than once.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.sh_severity as enum ('info','low','medium','high','critical');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sh_incident_status as enum (
    'detected','investigating','diagnosed','reproducing','patch_proposed',
    'awaiting_approval','approved','deploying','verifying','resolved',
    'rejected','ignored','regressed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  -- Which automation tier a proposed change is allowed to take.
  --   auto     — Level 1: cosmetic/non-functional, may self-deploy
  --   pr_only  — Level 2: functional frontend, opens a PR, human merges
  --   manual   — Level 3: money/security/data, human writes or signs off
  create type public.sh_approval_level as enum ('auto','pr_only','manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sh_outcome_status as enum ('started','succeeded','failed','timeout','abandoned');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. Feature outcome contracts
-- ---------------------------------------------------------------------------
-- The heart of the system: a machine-readable statement of what "this feature
-- worked" MEANS. Crash-only monitoring says the Create Study Plan button is
-- fine because nothing threw; a contract says the plan must exist in the DB,
-- the user must be redirected, and a toast must appear — within 8 seconds.
--
-- Contracts are declared in code (src/selfheal/contracts.ts is the source of
-- truth and seeds this table) but live in the DB so timeouts and severity can
-- be re-tuned in production without a deploy.

create table if not exists public.sh_feature_contracts (
  key                text primary key,                 -- 'study_plan.create'
  label              text not null,
  surface            text not null default 'web',      -- web | api | worker
  component          text,                             -- source hint: 'src/UploadTasks.tsx'
  -- Expected observable outcomes. Array of {type, selector?, route?, table?, event?, matcher?}
  -- type ∈ db_row | navigation | toast | analytics_event | api_2xx | dom | state
  expectations       jsonb not null default '[]'::jsonb,
  timeout_ms         integer not null default 8000 check (timeout_ms between 250 and 600000),
  severity           public.sh_severity not null default 'medium',
  -- What the client should try before giving up: retry | refresh_token | reload | none
  recovery_strategy  text not null default 'retry',
  max_recovery_tries smallint not null default 1 check (max_recovery_tries between 0 and 5),
  -- Level 3 blast radius: touching money/auth/data forces manual review no
  -- matter how confident the AI is.
  approval_level     public.sh_approval_level not null default 'pr_only',
  -- Below this success rate (0-1) over the alert window, open an incident even
  -- if no individual attempt failed loudly.
  min_success_rate   real not null default 0.97 check (min_success_rate between 0 and 1),
  owner_team         text,
  enabled            boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.sh_feature_contracts is
  'Declarative "did this feature actually work" definitions. Seeded from src/selfheal/contracts.ts.';

-- ---------------------------------------------------------------------------
-- 2. Journey definitions
-- ---------------------------------------------------------------------------
-- A journey is an ordered sequence of contracts plus its own funnel semantics:
-- registration, checkout, upload → AI generation, etc. Journeys catch the
-- failures contracts can't: the user who never reaches step 3 at all.

create table if not exists public.sh_journeys (
  key            text primary key,                     -- 'checkout.premium'
  label          text not null,
  -- [{ step:'checkout.start', contract:'billing.checkout_session', optional:false, timeout_ms:15000 }]
  steps          jsonb not null default '[]'::jsonb,
  total_timeout_ms integer not null default 300000,
  severity       public.sh_severity not null default 'high',
  -- Journeys that move money or create accounts are never auto-patched.
  approval_level public.sh_approval_level not null default 'manual',
  min_completion_rate real not null default 0.8 check (min_completion_rate between 0 and 1),
  enabled        boolean not null default true,
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Sessions
-- ---------------------------------------------------------------------------
-- One row per browser session (signed in or not). user_id is nullable on
-- purpose — anonymous failures (the signup form that never submits) are the
-- ones that cost the most and are invisible today.

create table if not exists public.sh_sessions (
  id             uuid primary key,                     -- client-generated, unguessable
  user_id        uuid references auth.users (id) on delete set null,
  anon_id        text,                                 -- stable per-device pseudonym, rotated every 30d
  started_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  release        text,                                 -- git sha of the deployed build
  environment    text not null default 'production',
  device         text,                                 -- phone | tablet | pc
  os             text,
  browser        text,
  viewport_w     integer,
  viewport_h     integer,
  locale         text,
  timezone       text,
  -- Salted hash only. Raw IPs are never stored (GDPR data minimisation);
  -- the hash exists purely to correlate an abuse burst to one origin.
  ip_hash        text,
  country        text,
  entry_route    text,
  is_premium     boolean,
  flag_state     jsonb not null default '{}'::jsonb,   -- flags active for this session
  replay_ref     text,                                 -- storage path of the replay bundle
  event_count    integer not null default 0,
  error_count    integer not null default 0,
  rage_count     integer not null default 0,
  ended_at       timestamptz
);

create index if not exists sh_sessions_last_seen on public.sh_sessions (last_seen_at desc);
create index if not exists sh_sessions_user on public.sh_sessions (user_id, started_at desc);
create index if not exists sh_sessions_release on public.sh_sessions (release, started_at desc);

-- ---------------------------------------------------------------------------
-- 4. Raw event stream
-- ---------------------------------------------------------------------------
-- Append-only, high volume, short retention (14 days). This is the evidence
-- pool the AI reads when building an incident report; the rollups below are
-- what survives long term.
--
-- Declarative daily partitioning is applied at the 100k-user tier (see
-- docs/self-healing/06-scalability.md); at current volume a single table with
-- BRIN-friendly ordering is materially simpler and fast enough.

create table if not exists public.sh_events (
  id           bigserial primary key,
  session_id   uuid not null references public.sh_sessions (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null,
  ts           timestamptz not null default now(),
  -- dead_click | rage_click | js_error | promise_rejection | react_error |
  -- network_error | slow_request | spinner_stuck | nav_failed | layout_shift |
  -- long_task | memory_pressure | offline | a11y_violation | console_error |
  -- outcome_started | outcome_ok | outcome_failed | journey_step | custom
  kind         text not null,
  severity     public.sh_severity not null default 'info',
  route        text,
  component    text,
  -- Free-form but size-clamped at ingest. Already PII-scrubbed twice (client
  -- masking + server scrubber) before it lands here.
  payload      jsonb not null default '{}'::jsonb,
  fingerprint  text,                                   -- set for anything incident-worthy
  incident_id  uuid
);

create index if not exists sh_events_ts on public.sh_events (ts desc);
create index if not exists sh_events_session on public.sh_events (session_id, ts);
create index if not exists sh_events_kind_ts on public.sh_events (kind, ts desc);
create index if not exists sh_events_fingerprint on public.sh_events (fingerprint, ts desc) where fingerprint is not null;
create index if not exists sh_events_incident on public.sh_events (incident_id, ts) where incident_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Feature outcome attempts
-- ---------------------------------------------------------------------------
-- One row per "user tried to do the thing". The success-rate signal that
-- powers "Create Study Plan is 12% down since the 14:02 deploy".

create table if not exists public.sh_outcomes (
  id            uuid primary key default gen_random_uuid(),
  contract_key  text not null,
  session_id    uuid references public.sh_sessions (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete set null,
  status        public.sh_outcome_status not null default 'started',
  started_at    timestamptz not null default now(),
  settled_at    timestamptz,
  duration_ms   integer,
  route         text,
  release       text,
  device        text,
  -- Which expectations were met and which were not — the diff IS the diagnosis
  -- hint. [{type:'db_row', met:false}, {type:'toast', met:true}]
  expectations  jsonb not null default '[]'::jsonb,
  failed_reason text,
  recovery_used text,
  incident_id   uuid
);

create index if not exists sh_outcomes_contract_time on public.sh_outcomes (contract_key, started_at desc);
create index if not exists sh_outcomes_status on public.sh_outcomes (status, started_at desc) where status in ('failed','timeout');
create index if not exists sh_outcomes_release on public.sh_outcomes (release, started_at desc);

-- ---------------------------------------------------------------------------
-- 6. Journey runs
-- ---------------------------------------------------------------------------

create table if not exists public.sh_journey_runs (
  id           uuid primary key default gen_random_uuid(),
  journey_key  text not null,
  session_id   uuid references public.sh_sessions (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete set null,
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  completed_at timestamptz,
  status       public.sh_outcome_status not null default 'started',
  current_step text,
  steps_done   jsonb not null default '[]'::jsonb,
  abandoned_at_step text,
  incident_id  uuid
);

create index if not exists sh_journey_runs_key on public.sh_journey_runs (journey_key, started_at desc);
create index if not exists sh_journey_runs_open on public.sh_journey_runs (updated_at)
  where status = 'started';

-- ---------------------------------------------------------------------------
-- 7. Incidents
-- ---------------------------------------------------------------------------

create table if not exists public.sh_incidents (
  id                uuid primary key default gen_random_uuid(),
  -- Stable hash over (kind, normalised message, route, component). Two users
  -- hitting the same bug produce the same fingerprint and therefore one row.
  fingerprint       text not null,
  title             text not null,
  kind              text not null,
  status            public.sh_incident_status not null default 'detected',
  severity          public.sh_severity not null default 'medium',
  approval_level    public.sh_approval_level not null default 'pr_only',
  source            text not null default 'frontend',  -- frontend|backend|db|third_party|synthetic
  route             text,
  component         text,
  contract_key      text,
  journey_key       text,
  release           text,
  environment       text not null default 'production',
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  occurrences       integer not null default 1,
  affected_users    integer not null default 0,
  affected_sessions integer not null default 0,
  -- 0-100 composite of severity × reach × business surface, used for ranking
  -- and for the "is this worth waking a human" decision.
  priority_score    integer not null default 0 check (priority_score between 0 and 100),
  business_impact   text,
  -- Deploy correlation: the release this started in, if attributable.
  suspected_release text,
  suspected_commit  text,
  assigned_to       uuid references auth.users (id) on delete set null,
  resolved_at       timestamptz,
  resolution        text,                               -- patched | config | flag_off | not_a_bug | duplicate
  duplicate_of      uuid references public.sh_incidents (id) on delete set null,
  -- Timing KPIs, denormalised so MTTD/MTTR are a single scan.
  detected_ms       integer,                            -- first occurrence → incident created
  diagnosed_ms      integer,
  repaired_ms       integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- One OPEN incident per fingerprint; resolved ones can repeat (regression).
create unique index if not exists sh_incidents_open_fingerprint
  on public.sh_incidents (fingerprint)
  where status not in ('resolved','ignored','rejected');

create index if not exists sh_incidents_status on public.sh_incidents (status, priority_score desc, last_seen_at desc);
create index if not exists sh_incidents_last_seen on public.sh_incidents (last_seen_at desc);
create index if not exists sh_incidents_severity on public.sh_incidents (severity, last_seen_at desc);
create index if not exists sh_incidents_release on public.sh_incidents (suspected_release) where suspected_release is not null;

-- ---------------------------------------------------------------------------
-- 8. Evidence bundle
-- ---------------------------------------------------------------------------
-- Everything the AI collected, kept separate from the incident so the incident
-- row stays small and the (potentially large) evidence can age out on its own
-- retention clock.

create table if not exists public.sh_incident_evidence (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.sh_incidents (id) on delete cascade,
  kind        text not null,   -- console|network|replay|db_query|source|commit|pr|deploy|screenshot|trace|flag_state
  label       text,
  -- Small structured evidence inline; anything large is a storage pointer.
  content     jsonb,
  storage_ref text,
  bytes       integer,
  collected_at timestamptz not null default now()
);

create index if not exists sh_evidence_incident on public.sh_incident_evidence (incident_id, kind);

-- ---------------------------------------------------------------------------
-- 9. AI diagnosis
-- ---------------------------------------------------------------------------
-- Versioned: re-running analysis appends rather than overwrites, so we can
-- measure whether the model is getting better and roll back a bad prompt.

create table if not exists public.sh_diagnoses (
  id                uuid primary key default gen_random_uuid(),
  incident_id       uuid not null references public.sh_incidents (id) on delete cascade,
  version           integer not null default 1,
  model             text not null,
  prompt_version    text not null default 'v1',
  root_cause        text not null,
  reasoning         text,
  confidence        real not null check (confidence between 0 and 1),
  -- [{hypothesis, confidence, disproved_by}]
  alternatives      jsonb not null default '[]'::jsonb,
  affected_files    jsonb not null default '[]'::jsonb,
  affected_components jsonb not null default '[]'::jsonb,
  estimated_users   integer,
  regression_risk   text,      -- low | medium | high
  suggested_priority public.sh_severity,
  -- Prior incidents the model leaned on (continuous learning in action).
  similar_incidents jsonb not null default '[]'::jsonb,
  input_tokens      integer,
  output_tokens     integer,
  cost_usd          numeric(10,4),
  created_at        timestamptz not null default now(),
  unique (incident_id, version)
);

create index if not exists sh_diagnoses_incident on public.sh_diagnoses (incident_id, version desc);

-- ---------------------------------------------------------------------------
-- 10. Reproduction attempts
-- ---------------------------------------------------------------------------

create table if not exists public.sh_repro_attempts (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references public.sh_incidents (id) on delete cascade,
  attempt      integer not null default 1,
  strategy     text,                       -- replay_derived | contract_derived | llm_authored
  test_path    text,
  test_source  text,
  reproduced   boolean not null default false,
  exit_code    integer,
  duration_ms  integer,
  -- Playwright trace.zip / screenshots / video live in storage, not Postgres.
  artifacts    jsonb not null default '[]'::jsonb,
  stdout_tail  text,
  workflow_run_url text,
  created_at   timestamptz not null default now(),
  unique (incident_id, attempt)
);

-- ---------------------------------------------------------------------------
-- 11. Proposed patches
-- ---------------------------------------------------------------------------

create table if not exists public.sh_patches (
  id                uuid primary key default gen_random_uuid(),
  incident_id       uuid not null references public.sh_incidents (id) on delete cascade,
  diagnosis_id      uuid references public.sh_diagnoses (id) on delete set null,
  status            text not null default 'proposed'
                    check (status in ('proposed','ci_running','ci_failed','ci_passed',
                                      'awaiting_approval','approved','rejected',
                                      'deploying','deployed','rolled_back','superseded')),
  approval_level    public.sh_approval_level not null default 'pr_only',
  -- Why this level: which safety rule matched. Auditable, so a Level-1
  -- auto-deploy can always be explained after the fact.
  level_reason      text,
  summary           text not null,
  explanation       text,
  branch            text,
  commit_message    text,
  diff              text,                    -- unified diff, size-clamped
  files_changed     jsonb not null default '[]'::jsonb,
  migration_sql     text,
  tests_added       jsonb not null default '[]'::jsonb,
  github_pr_number  integer,
  github_pr_url     text,
  github_issue_number integer,
  ci_run_url        text,
  ci_summary        jsonb,
  preview_url       text,
  approved_by       uuid references auth.users (id) on delete set null,
  approved_at       timestamptz,
  rejected_reason   text,
  deployed_at       timestamptz,
  rolled_back_at    timestamptz,
  model             text,
  cost_usd          numeric(10,4),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists sh_patches_incident on public.sh_patches (incident_id, created_at desc);
create index if not exists sh_patches_status on public.sh_patches (status, created_at desc);

-- ---------------------------------------------------------------------------
-- 12. Approval / action audit log
-- ---------------------------------------------------------------------------
-- Append-only. Every automated action and every human decision, forever.
-- This is the table a compliance auditor reads.

create table if not exists public.sh_audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       text not null,                 -- 'ai' | 'system' | user uuid as text
  actor_user  uuid references auth.users (id) on delete set null,
  action      text not null,                 -- incident_opened | diagnosis_created | patch_proposed |
                                             -- patch_approved | patch_rejected | deployed | rolled_back |
                                             -- flag_disabled | alert_sent | safety_block
  incident_id uuid references public.sh_incidents (id) on delete set null,
  patch_id    uuid references public.sh_patches (id) on delete set null,
  detail      jsonb not null default '{}'::jsonb
);

create index if not exists sh_audit_at on public.sh_audit_log (at desc);
create index if not exists sh_audit_incident on public.sh_audit_log (incident_id, at desc);

-- ---------------------------------------------------------------------------
-- 13. Learning corpus
-- ---------------------------------------------------------------------------
-- Every resolved incident becomes retrieval context for the next one. Kept as
-- a separate, denormalised, long-retention table so purging raw telemetry
-- never destroys institutional memory.
--
-- The embedding column is provisioned but nullable: pgvector is enabled at the
-- 1k-incident mark (see docs); until then retrieval is trigram + tag matching,
-- which is materially cheaper and good enough at this corpus size.

create table if not exists public.sh_learning (
  id              uuid primary key default gen_random_uuid(),
  incident_id     uuid references public.sh_incidents (id) on delete set null,
  fingerprint     text not null,
  title           text not null,
  kind            text,
  route           text,
  component       text,
  root_cause      text not null,
  fix_summary     text,
  files_modified  jsonb not null default '[]'::jsonb,
  tests_generated jsonb not null default '[]'::jsonb,
  diff_excerpt    text,
  tags            text[] not null default '{}',
  time_to_detect_ms  integer,
  time_to_diagnose_ms integer,
  time_to_repair_ms  integer,
  ai_confidence   real,
  -- Did the AI's diagnosis survive contact with reality? The single most
  -- important column for measuring whether this platform is working.
  diagnosis_correct boolean,
  human_edits_required boolean,
  regressed_count integer not null default 0,
  related_incidents jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists sh_learning_fingerprint on public.sh_learning (fingerprint);
create index if not exists sh_learning_tags on public.sh_learning using gin (tags);
create index if not exists sh_learning_route on public.sh_learning (route);

-- ---------------------------------------------------------------------------
-- 14. Feature flags
-- ---------------------------------------------------------------------------
-- Kill switches are the fastest self-healing action available: disabling a
-- broken feature takes ~2s and needs no deploy, no CI, no review. Auto-rollback
-- thresholds make that reaction automatic.

create table if not exists public.sh_flags (
  key             text primary key,
  label           text not null,
  description     text,
  enabled         boolean not null default true,
  -- 0-100. Deterministic bucketing by hash(key || anon_id) so a user's
  -- experience is stable across reloads and devices-per-account.
  rollout_percent smallint not null default 100 check (rollout_percent between 0 and 100),
  premium_only    boolean not null default false,
  beta_only       boolean not null default false,
  regions         text[],                     -- null = everywhere
  -- Auto-rollback: if error rate for this flag's surface exceeds N% over the
  -- window while the flag is on, the sweeper disables it and opens an incident.
  auto_rollback_error_rate real check (auto_rollback_error_rate is null or auto_rollback_error_rate between 0 and 1),
  auto_rollback_window_min integer not null default 10,
  auto_disabled_at timestamptz,
  auto_disabled_reason text,
  updated_by      uuid references auth.users (id) on delete set null,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create table if not exists public.sh_flag_audit (
  id         bigserial primary key,
  flag_key   text not null,
  at         timestamptz not null default now(),
  actor      text not null,
  was        jsonb,
  now_state  jsonb,
  reason     text
);

create index if not exists sh_flag_audit_key on public.sh_flag_audit (flag_key, at desc);

-- ---------------------------------------------------------------------------
-- 15. Alerts (deduplicated notification state)
-- ---------------------------------------------------------------------------
-- Alert fatigue is the failure mode that kills monitoring platforms. One row
-- per (incident, channel); re-alerting requires escalation, not repetition.

create table if not exists public.sh_alerts (
  id           uuid primary key default gen_random_uuid(),
  incident_id  uuid not null references public.sh_incidents (id) on delete cascade,
  channel      text not null,                -- email | slack | discord | sms | dashboard
  severity_at_send public.sh_severity not null,
  sent_at      timestamptz not null default now(),
  recipient    text,
  dedupe_key   text not null,
  escalation   smallint not null default 0,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users (id) on delete set null,
  unique (dedupe_key)
);

create index if not exists sh_alerts_incident on public.sh_alerts (incident_id, sent_at desc);

-- ---------------------------------------------------------------------------
-- 16. Metric rollups
-- ---------------------------------------------------------------------------
-- Hourly aggregates survive raw-event purge and make the dashboard O(rows in
-- window) instead of O(events). Written by the sweeper below.

create table if not exists public.sh_metrics_hourly (
  bucket        timestamptz not null,
  metric        text not null,               -- 'outcome.success_rate' | 'journey.completion' | 'error.rate'
  dimension     text not null default '',    -- contract key / journey key / route
  device        text not null default '',
  release       text not null default '',
  numerator     bigint not null default 0,
  denominator   bigint not null default 0,
  p50_ms        integer,
  p95_ms        integer,
  primary key (bucket, metric, dimension, device, release)
);

create index if not exists sh_metrics_hourly_metric on public.sh_metrics_hourly (metric, bucket desc);

-- ===========================================================================
-- 17. Lockdown — RLS on, zero policies, service role only
-- ===========================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'sh_feature_contracts','sh_journeys','sh_sessions','sh_events','sh_outcomes',
    'sh_journey_runs','sh_incidents','sh_incident_evidence','sh_diagnoses',
    'sh_repro_attempts','sh_patches','sh_audit_log','sh_learning','sh_flags',
    'sh_flag_audit','sh_alerts','sh_metrics_hourly'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

-- Sequences used by service-role inserts.
grant usage, select on sequence public.sh_events_id_seq to service_role;
grant usage, select on sequence public.sh_audit_log_id_seq to service_role;
grant usage, select on sequence public.sh_flag_audit_id_seq to service_role;

-- One exception: flags must be READABLE by everyone, including signed-out
-- visitors, or the kill switch can't reach the users who need it. Only the
-- serving projection is exposed (never thresholds or audit state), and only
-- through a stable RPC.
create or replace function public.sh_public_flags()
returns table (key text, enabled boolean, rollout_percent smallint, premium_only boolean, beta_only boolean, regions text[])
language sql
security definer
set search_path = public
stable
as $$
  select f.key, f.enabled, f.rollout_percent, f.premium_only, f.beta_only, f.regions
    from public.sh_flags f;
$$;

revoke execute on function public.sh_public_flags() from public;
grant execute on function public.sh_public_flags() to anon, authenticated;

-- ===========================================================================
-- 18. Core server-side logic
-- ===========================================================================

-- Normalise a message so "Cannot read x of undefined at 0x7ffd" and the same
-- error with a different address/uuid/number collapse to one fingerprint.
create or replace function public.sh_normalise(p_text text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(coalesce(p_text, ''),
          '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '<uuid>', 'gi'),
        '\m\d+\M', '<n>', 'g'),
      '\s+', ' ', 'g')
  );
$$;

create or replace function public.sh_fingerprint(
  p_kind text, p_message text, p_route text, p_component text
) returns text
language sql
immutable
set search_path = public
as $$
  select md5(
    coalesce(p_kind,'') || chr(31) ||
    public.sh_normalise(p_message) || chr(31) ||
    coalesce(p_route,'') || chr(31) ||
    coalesce(p_component,'')
  );
$$;

-- Composite priority. Deliberately arithmetic rather than ML: an on-call
-- engineer must be able to explain at 3am why they were paged.
--   severity   0-40   how bad is one occurrence
--   reach      0-35   how many distinct users, log-scaled
--   surface    0-15   does it touch money / auth / data
--   freshness  0-10   is it happening right now
create or replace function public.sh_priority(
  p_severity public.sh_severity,
  p_affected_users integer,
  p_approval_level public.sh_approval_level,
  p_last_seen timestamptz
) returns integer
language sql
immutable
set search_path = public
as $$
  select least(100, greatest(0,
      (case p_severity
         when 'critical' then 40 when 'high' then 30 when 'medium' then 18
         when 'low' then 8 else 2 end)
    + least(35, (ln(greatest(coalesce(p_affected_users,0), 1)) * 7)::int)
    + (case p_approval_level when 'manual' then 15 when 'pr_only' then 6 else 0 end)
    + (case when p_last_seen > now() - interval '15 minutes' then 10
            when p_last_seen > now() - interval '2 hours'   then 5
            else 0 end)
  ))::int;
$$;

-- The single entry point for "something went wrong". Idempotent by
-- fingerprint: first call opens an incident, subsequent calls fold in.
-- Returns the incident id so the caller can attach evidence.
create or replace function public.sh_record_incident(
  p_fingerprint    text,
  p_title          text,
  p_kind           text,
  p_severity       public.sh_severity,
  p_source         text default 'frontend',
  p_route          text default null,
  p_component      text default null,
  p_contract_key   text default null,
  p_journey_key    text default null,
  p_release        text default null,
  p_user_id        uuid default null,
  p_session_id     uuid default null,
  p_approval_level public.sh_approval_level default 'pr_only',
  p_first_seen     timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_users int;
  v_sessions int;
begin
  select id into v_id
    from public.sh_incidents
   where fingerprint = p_fingerprint
     and status not in ('resolved','ignored','rejected')
   limit 1;

  if v_id is null then
    insert into public.sh_incidents (
      fingerprint, title, kind, severity, source, route, component,
      contract_key, journey_key, release, approval_level,
      first_seen_at, last_seen_at, occurrences,
      affected_users, affected_sessions, detected_ms
    ) values (
      p_fingerprint, left(p_title, 300), p_kind, p_severity, p_source, p_route, p_component,
      p_contract_key, p_journey_key, p_release, p_approval_level,
      coalesce(p_first_seen, now()), now(), 1,
      case when p_user_id is null then 0 else 1 end,
      case when p_session_id is null then 0 else 1 end,
      case when p_first_seen is null then 0
           else greatest(0, (extract(epoch from (now() - p_first_seen)) * 1000)::int) end
    )
    returning id into v_id;

    insert into public.sh_audit_log (actor, action, incident_id, detail)
    values ('system', 'incident_opened', v_id,
            jsonb_build_object('fingerprint', p_fingerprint, 'severity', p_severity, 'source', p_source));
  else
    -- Recount reach from the event stream rather than incrementing blindly:
    -- one user refreshing 40 times is not 40 affected users.
    select count(distinct user_id), count(distinct session_id)
      into v_users, v_sessions
      from public.sh_events
     where incident_id = v_id;

    update public.sh_incidents
       set occurrences = occurrences + 1,
           last_seen_at = now(),
           affected_users = greatest(coalesce(v_users, 0), affected_users),
           affected_sessions = greatest(coalesce(v_sessions, 0), affected_sessions),
           -- Severity only ever escalates automatically; de-escalation is a
           -- human judgement call.
           severity = case when p_severity > severity then p_severity else severity end,
           updated_at = now()
     where id = v_id;
  end if;

  update public.sh_incidents
     set priority_score = public.sh_priority(severity, affected_users, approval_level, last_seen_at)
   where id = v_id;

  return v_id;
end;
$$;

revoke execute on function public.sh_record_incident(text,text,text,public.sh_severity,text,text,text,text,text,text,uuid,uuid,public.sh_approval_level,timestamptz) from public, anon, authenticated;
revoke execute on function public.sh_fingerprint(text,text,text,text) from public, anon, authenticated;

-- Session counters, incremented rather than recomputed so a hot session
-- doesn't cost a scan per batch.
create or replace function public.sh_bump_session_counters(
  p_session uuid, p_events integer, p_errors integer, p_rage integer
) returns void
language sql
security definer
set search_path = public
as $$
  update public.sh_sessions
     set event_count = event_count + greatest(coalesce(p_events, 0), 0),
         error_count = error_count + greatest(coalesce(p_errors, 0), 0),
         rage_count  = rage_count  + greatest(coalesce(p_rage, 0), 0),
         last_seen_at = now()
   where id = p_session;
$$;

revoke execute on function public.sh_bump_session_counters(uuid,integer,integer,integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Safety classifier — the Level 3 guardrail, enforced in the DATABASE.
-- ---------------------------------------------------------------------------
-- The AI proposes an approval level; this function has the final say. Putting
-- it in SQL (rather than only in the orchestrator) means a prompt-injected or
-- buggy agent still cannot mark a Stripe change auto-deployable: the check
-- runs on the write path it cannot bypass.
create or replace function public.sh_classify_approval(p_files jsonb, p_diff text)
returns public.sh_approval_level
language plpgsql
immutable
set search_path = public
as $$
declare
  v_blob text;
  v_manual text[] := array[
    'stripe','billing','checkout','subscription','price','invoice','webhook',
    -- Entitlement logic is as money-critical as the payment rails: getting it
    -- wrong either gives the product away or locks out people who paid. The
    -- classifier corpus caught this gap on first run.
    -- NOT 'gate' — substring of navigate/aggregate/delegate, which would send
    -- most routine frontend work to manual review. A safety control that is
    -- noisy is a safety control that gets switched off.
    'premium','entitlement','paywall','credits','quota',
    'auth','session','token','jwt','password','login','signup',
    'rls','policy','grant','revoke','security definer','service_role',
    'migration','schema.sql','alter table','drop table','delete from',
    'supabase/migrations','delete-account','admin-','encrypt','secret','env',
    'resend','email','broadcast','flag','privacy','gdpr'
  ];
  -- Cosmetic-only surfaces that may self-deploy.
  v_auto_ok boolean;
  v_needle text;
begin
  v_blob := lower(coalesce(p_files::text, '') || ' ' || coalesce(left(p_diff, 200000), ''));

  foreach v_needle in array v_manual loop
    if position(v_needle in v_blob) > 0 then
      return 'manual';
    end if;
  end loop;

  -- Auto tier only when EVERY changed file is a stylesheet/asset/copy file and
  -- the diff has no control flow. Anything else is at most pr_only.
  select bool_and(
           f ~ '\.(css|scss|svg|png|jpg|webp|md|json)$'
           or f ~ '(^|/)(index\.html|tailwind\.config\.js)$'
         )
    into v_auto_ok
    from jsonb_array_elements_text(coalesce(p_files, '[]'::jsonb)) as f;

  if coalesce(v_auto_ok, false)
     and p_diff !~ '(?i)(function|=>|await|if\s*\(|for\s*\(|while\s*\()' then
    return 'auto';
  end if;

  return 'pr_only';
end;
$$;

comment on function public.sh_classify_approval(jsonb, text) is
  'Final authority on automation tier. AI suggestions are advisory; this is enforced.';

-- A patch can never be stored claiming a weaker tier than the classifier
-- allows. Trigger, not application code, so every write path is covered.
create or replace function public.sh_enforce_patch_level()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_required public.sh_approval_level;
begin
  v_required := public.sh_classify_approval(new.files_changed, coalesce(new.diff, '') || coalesce(new.migration_sql, ''));
  -- Migrations are always manual regardless of content.
  if new.migration_sql is not null and length(btrim(new.migration_sql)) > 0 then
    v_required := 'manual';
  end if;
  if new.approval_level < v_required then
    new.approval_level := v_required;
    new.level_reason := coalesce(new.level_reason, '') || ' [escalated by sh_classify_approval]';
  end if;
  -- Nothing above 'auto' may reach 'deployed' without a recorded approver.
  if new.status in ('deploying','deployed')
     and new.approval_level <> 'auto'
     and new.approved_by is null then
    raise exception 'patch % requires human approval before deployment', new.id
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sh_patches_enforce_level on public.sh_patches;
create trigger sh_patches_enforce_level
  before insert or update on public.sh_patches
  for each row execute function public.sh_enforce_patch_level();

-- ===========================================================================
-- 19. Detection sweeps (pg_cron) — the "before users report it" half
-- ===========================================================================

-- Contracts whose success rate has fallen below their floor. Catches the
-- silent failures: no exception, no 500, users just don't get the outcome.
create or replace function public.sh_sweep_contracts(p_window_min integer default 15)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_open int := 0;
  v_id uuid;
begin
  for r in
    select o.contract_key,
           count(*) filter (where o.status in ('succeeded'))::numeric as ok,
           count(*)::numeric as total,
           count(*) filter (where o.status in ('failed','timeout')) as bad,
           count(distinct o.user_id) as users,
           max(o.release) as release,
           c.min_success_rate, c.severity, c.approval_level, c.label, c.component
      from public.sh_outcomes o
      join public.sh_feature_contracts c on c.key = o.contract_key
     where o.started_at > now() - make_interval(mins => p_window_min)
       and c.enabled
       and o.status <> 'started'
     group by o.contract_key, c.min_success_rate, c.severity, c.approval_level, c.label, c.component
    -- Statistical floor: 20 attempts before we believe a rate. Below that a
    -- single failure would page someone at 4am for noise.
    having count(*) >= 20
       and (count(*) filter (where o.status = 'succeeded'))::numeric / count(*)::numeric < c.min_success_rate
  loop
    v_id := public.sh_record_incident(
      public.sh_fingerprint('contract_degraded', r.contract_key, null, r.component),
      format('%s success rate %s%% (floor %s%%)', r.label,
             round(100 * r.ok / nullif(r.total,0)), round(100 * r.min_success_rate)),
      'contract_degraded',
      case when r.ok / nullif(r.total,0) < (r.min_success_rate / 2) then 'critical'::public.sh_severity
           else r.severity end,
      'frontend', null, r.component, r.contract_key, null, r.release,
      null, null, r.approval_level, now() - make_interval(mins => p_window_min)
    );
    update public.sh_incidents
       set affected_users = greatest(affected_users, r.users),
           occurrences = greatest(occurrences, r.bad),
           business_impact = format('%s of %s attempts failed in the last %s min',
                                    r.bad, r.total::int, p_window_min)
     where id = v_id;
    v_open := v_open + 1;
  end loop;
  return v_open;
end;
$$;

-- Journeys that started and then went quiet past their total timeout.
create or replace function public.sh_sweep_journeys()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select jr.id, jr.journey_key, jr.current_step, jr.user_id, jr.session_id,
           j.severity, j.approval_level, j.label
      from public.sh_journey_runs jr
      join public.sh_journeys j on j.key = jr.journey_key
     where jr.status = 'started'
       and jr.updated_at < now() - make_interval(secs => j.total_timeout_ms / 1000)
     limit 500
  loop
    update public.sh_journey_runs
       set status = 'abandoned', abandoned_at_step = r.current_step, updated_at = now()
     where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Journey completion rate below floor → incident.
create or replace function public.sh_sweep_journey_health(p_window_min integer default 60)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_open int := 0;
  v_id uuid;
begin
  for r in
    select jr.journey_key, j.label, j.severity, j.approval_level, j.min_completion_rate,
           count(*)::numeric as total,
           count(*) filter (where jr.status = 'succeeded')::numeric as done,
           count(distinct jr.user_id) as users,
           mode() within group (order by jr.abandoned_at_step) as stuck_step
      from public.sh_journey_runs jr
      join public.sh_journeys j on j.key = jr.journey_key
     where jr.started_at > now() - make_interval(mins => p_window_min)
       and j.enabled
     group by jr.journey_key, j.label, j.severity, j.approval_level, j.min_completion_rate
    having count(*) >= 15
       and count(*) filter (where jr.status = 'succeeded')::numeric / count(*)::numeric < j.min_completion_rate
  loop
    v_id := public.sh_record_incident(
      public.sh_fingerprint('journey_degraded', r.journey_key, r.stuck_step, null),
      format('%s completion %s%% — users stalling at "%s"', r.label,
             round(100 * r.done / nullif(r.total,0)), coalesce(r.stuck_step, 'unknown')),
      'journey_degraded', r.severity, 'frontend', null, null, null, r.journey_key,
      null, null, null, r.approval_level, now() - make_interval(mins => p_window_min)
    );
    update public.sh_incidents set affected_users = greatest(affected_users, r.users) where id = v_id;
    v_open := v_open + 1;
  end loop;
  return v_open;
end;
$$;

-- Flag auto-rollback: a feature whose error rate blew past its threshold gets
-- switched off automatically. Fastest possible remediation — no deploy needed.
create or replace function public.sh_sweep_flag_rollback()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_rate numeric;
  v_count int := 0;
begin
  for r in
    select * from public.sh_flags
     where enabled and auto_rollback_error_rate is not null and auto_disabled_at is null
  loop
    select case when count(*) = 0 then 0
                else count(*) filter (where e.severity in ('high','critical'))::numeric / count(*)::numeric end
      into v_rate
      from public.sh_events e
      join public.sh_sessions s on s.id = e.session_id
     where e.ts > now() - make_interval(mins => r.auto_rollback_window_min)
       and s.flag_state ? r.key;

    if v_rate > r.auto_rollback_error_rate then
      update public.sh_flags
         set enabled = false, auto_disabled_at = now(),
             auto_disabled_reason = format('error rate %s exceeded threshold %s', round(v_rate,3), r.auto_rollback_error_rate),
             updated_at = now()
       where key = r.key;
      insert into public.sh_flag_audit (flag_key, actor, was, now_state, reason)
      values (r.key, 'system', jsonb_build_object('enabled', true), jsonb_build_object('enabled', false),
              format('auto-rollback: error rate %s', round(v_rate,3)));
      insert into public.sh_audit_log (actor, action, detail)
      values ('system', 'flag_disabled', jsonb_build_object('flag', r.key, 'error_rate', v_rate));
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- Hourly rollup + retention. Raw events 14d, sessions 30d, outcomes 90d;
-- incidents, patches, audit and learning are kept indefinitely.
create or replace function public.sh_rollup_and_prune()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sh_metrics_hourly (bucket, metric, dimension, device, release, numerator, denominator, p50_ms, p95_ms)
  select date_trunc('hour', o.started_at),
         'outcome.success_rate',
         o.contract_key,
         coalesce(o.device, ''),
         coalesce(o.release, ''),
         count(*) filter (where o.status = 'succeeded'),
         count(*),
         percentile_disc(0.5) within group (order by o.duration_ms)::int,
         percentile_disc(0.95) within group (order by o.duration_ms)::int
    from public.sh_outcomes o
   where o.started_at >= date_trunc('hour', now()) - interval '2 hours'
     and o.started_at <  date_trunc('hour', now())
     and o.status <> 'started'
   group by 1,3,4,5
  on conflict (bucket, metric, dimension, device, release) do update
     set numerator = excluded.numerator, denominator = excluded.denominator,
         p50_ms = excluded.p50_ms, p95_ms = excluded.p95_ms;

  delete from public.sh_events   where ts < now() - interval '14 days';
  delete from public.sh_sessions where last_seen_at < now() - interval '30 days';
  delete from public.sh_outcomes where started_at < now() - interval '90 days';
  delete from public.sh_journey_runs where started_at < now() - interval '90 days';
  delete from public.sh_metrics_hourly where bucket < now() - interval '400 days';
end;
$$;

-- Schedule the sweeps. pg_cron is already in use for the room sweep, so this
-- adds no new infrastructure. Guarded so the migration still applies on a
-- database without the extension (local dev, CI).
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobname) from cron.job
      where jobname in ('sh_sweep','sh_rollup');
    perform cron.schedule('sh_sweep', '* * * * *', $cron$
      select public.sh_sweep_contracts(15);
      select public.sh_sweep_journeys();
      select public.sh_sweep_journey_health(60);
      select public.sh_sweep_flag_rollback();
    $cron$);
    perform cron.schedule('sh_rollup', '7 * * * *', $cron$ select public.sh_rollup_and_prune(); $cron$);
  end if;
end $$;

-- ===========================================================================
-- 20. Admin read APIs (is_admin()-gated, mirroring the existing dashboard)
-- ===========================================================================

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
    (select avg(repaired_ms) / 1000.0 from sh_incidents where resolved_at between p_start and p_end),
    (select case when sum(denominator) = 0 then null else sum(numerator)::numeric / sum(denominator) end
       from sh_metrics_hourly where metric = 'outcome.success_rate' and bucket between p_start and p_end),
    (select case when count(*) = 0 then null else
       count(*) filter (where status = 'succeeded')::numeric / count(*) end
       from sh_journey_runs where started_at between p_start and p_end),
    (select count(*) from sh_sessions where started_at between p_start and p_end),
    (select count(*) from sh_sessions where started_at between p_start and p_end and error_count > 0)
  where public.is_admin();
$$;

create or replace function public.admin_sh_incidents(
  p_status text default null,
  p_severity text default null,
  p_search text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns table (
  id uuid, title text, kind text, status text, severity text, approval_level text,
  source text, route text, component text, contract_key text, journey_key text,
  occurrences integer, affected_users integer, priority_score integer,
  suspected_release text, first_seen_at timestamptz, last_seen_at timestamptz,
  assigned_email text, has_diagnosis boolean, has_patch boolean,
  patch_status text, pr_url text, preview_url text, ai_confidence real, total_count bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with filtered as (
    select i.*
      from sh_incidents i
     where public.is_admin()
       and (p_status is null or i.status::text = p_status)
       and (p_severity is null or i.severity::text = p_severity)
       and (p_search is null or p_search = '' or i.title ilike '%' || p_search || '%'
            or coalesce(i.route,'') ilike '%' || p_search || '%')
  )
  select f.id, f.title, f.kind, f.status::text, f.severity::text, f.approval_level::text,
         f.source, f.route, f.component, f.contract_key, f.journey_key,
         f.occurrences, f.affected_users, f.priority_score,
         f.suspected_release, f.first_seen_at, f.last_seen_at,
         pr.email,
         d.id is not null,
         pt.id is not null,
         pt.status, pt.github_pr_url, pt.preview_url, d.confidence,
         (select count(*) from filtered)
    from filtered f
    left join profiles pr on pr.id = f.assigned_to
    left join lateral (
      select * from sh_diagnoses d2 where d2.incident_id = f.id order by version desc limit 1
    ) d on true
    left join lateral (
      select * from sh_patches p2 where p2.incident_id = f.id order by created_at desc limit 1
    ) pt on true
   order by
     case f.status when 'awaiting_approval' then 0 else 1 end,
     f.priority_score desc, f.last_seen_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

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
      'similar',   (select coalesce(jsonb_agg(jsonb_build_object('title', l.title, 'root_cause', l.root_cause,
                                                                'fix_summary', l.fix_summary, 'incident_id', l.incident_id)), '[]'::jsonb)
                      from sh_learning l where l.fingerprint = i.fingerprint or l.route = i.route limit 5)
    )
  end
  from sh_incidents i where i.id = p_id;
$$;

-- Success-rate table for the dashboard's feature health grid.
create or replace function public.admin_sh_feature_health(p_start timestamptz, p_end timestamptz)
returns table (contract_key text, label text, attempts bigint, successes bigint,
               success_rate numeric, floor_rate real, p95_ms integer, severity text)
language sql
security definer
set search_path = public
stable
as $$
  select c.key, c.label,
         count(o.id), count(o.id) filter (where o.status = 'succeeded'),
         case when count(o.id) = 0 then null
              else count(o.id) filter (where o.status = 'succeeded')::numeric / count(o.id) end,
         c.min_success_rate,
         percentile_disc(0.95) within group (order by o.duration_ms)::int,
         c.severity::text
    from sh_feature_contracts c
    left join sh_outcomes o
      on o.contract_key = c.key and o.started_at between p_start and p_end and o.status <> 'started'
   where public.is_admin() and c.enabled
   group by c.key, c.label, c.min_success_rate, c.severity
   order by 5 nulls last;
$$;

create or replace function public.admin_sh_incident_series(p_start timestamptz, p_end timestamptz)
returns table (day date, opened bigint, resolved bigint, affected_users bigint)
language sql
security definer
set search_path = public
stable
as $$
  select d::date,
         (select count(*) from sh_incidents i where i.created_at::date = d::date),
         (select count(*) from sh_incidents i where i.resolved_at::date = d::date),
         (select coalesce(sum(i.affected_users),0) from sh_incidents i where i.created_at::date = d::date)
    from generate_series(p_start::date, p_end::date, interval '1 day') d
   where public.is_admin();
$$;

-- Write path used by the dashboard's Approve / Reject / Assign / Ignore
-- buttons. Deliberately narrow: approving a patch here only RECORDS consent —
-- the deploy is carried out by /api/selfheal-action, which re-checks the level.
create or replace function public.admin_sh_set_incident(
  p_id uuid, p_status text default null, p_severity text default null,
  p_assign uuid default null, p_resolution text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  update public.sh_incidents
     set status = coalesce(p_status::public.sh_incident_status, status),
         severity = coalesce(p_severity::public.sh_severity, severity),
         assigned_to = coalesce(p_assign, assigned_to),
         resolution = coalesce(p_resolution, resolution),
         resolved_at = case when p_status in ('resolved','ignored','rejected') then now() else resolved_at end,
         repaired_ms = case when p_status = 'resolved'
                            then (extract(epoch from (now() - first_seen_at)) * 1000)::int
                            else repaired_ms end,
         updated_at = now()
   where id = p_id;

  insert into public.sh_audit_log (actor, actor_user, action, incident_id, detail)
  values (auth.uid()::text, auth.uid(), 'incident_updated', p_id,
          jsonb_build_object('status', p_status, 'severity', p_severity, 'resolution', p_resolution));
end;
$$;

create or replace function public.admin_sh_flags()
returns setof public.sh_flags
language sql security definer set search_path = public stable
as $$ select * from public.sh_flags where public.is_admin() order by key; $$;

create or replace function public.admin_sh_set_flag(
  p_key text, p_enabled boolean default null, p_rollout smallint default null, p_reason text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare v_was jsonb;
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  select to_jsonb(f) into v_was from public.sh_flags f where f.key = p_key;
  update public.sh_flags
     set enabled = coalesce(p_enabled, enabled),
         rollout_percent = coalesce(p_rollout, rollout_percent),
         auto_disabled_at = case when p_enabled then null else auto_disabled_at end,
         updated_by = auth.uid(), updated_at = now()
   where key = p_key;
  insert into public.sh_flag_audit (flag_key, actor, was, now_state, reason)
  select p_key, coalesce(auth.uid()::text, 'unknown'), v_was, to_jsonb(f), p_reason
    from public.sh_flags f where f.key = p_key;
end;
$$;

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_sh_overview(timestamptz, timestamptz)',
    'public.admin_sh_incidents(text, text, text, int, int)',
    'public.admin_sh_incident_detail(uuid)',
    'public.admin_sh_feature_health(timestamptz, timestamptz)',
    'public.admin_sh_incident_series(timestamptz, timestamptz)',
    'public.admin_sh_set_incident(uuid, text, text, uuid, text)',
    'public.admin_sh_flags()',
    'public.admin_sh_set_flag(text, boolean, smallint, text)'
  ]
  loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end $$;

-- ===========================================================================
-- 21. Seed — contracts, journeys and flags for the features that exist today
-- ===========================================================================
-- Kept in SQL (not only in TS) so a fresh database is immediately useful. The
-- TS declarations in src/selfheal/contracts.ts are the editing surface; this
-- upsert is regenerated from them by scripts/sync-contracts.mjs.

insert into public.sh_feature_contracts (key, label, component, expectations, timeout_ms, severity, approval_level, min_success_rate) values
  ('auth.sign_in', 'Sign in', 'src/Auth.tsx',
   '[{"type":"api_2xx","matcher":"auth/v1/token"},{"type":"state","matcher":"session"},{"type":"navigation","route":"focus"}]', 12000, 'critical', 'manual', 0.95),
  ('auth.sign_up', 'Create account', 'src/Auth.tsx',
   '[{"type":"api_2xx","matcher":"auth/v1/signup"},{"type":"toast"},{"type":"db_row","table":"profiles"}]', 15000, 'critical', 'manual', 0.9),
  ('auth.password_reset', 'Password reset', 'src/Auth.tsx',
   '[{"type":"api_2xx","matcher":"auth/v1/recover"},{"type":"toast"}]', 12000, 'high', 'manual', 0.9),
  ('task.create', 'Create task', 'src/App.tsx',
   '[{"type":"db_row","table":"tasks"},{"type":"dom","matcher":"task-row"},{"type":"analytics_event","event":"task_add"}]', 6000, 'high', 'pr_only', 0.98),
  ('task.complete', 'Complete task', 'src/App.tsx',
   '[{"type":"db_row","table":"tasks"},{"type":"state","matcher":"done"}]', 6000, 'medium', 'pr_only', 0.98),
  ('focus.session_complete', 'Finish a focus session', 'src/FocusMode.tsx',
   '[{"type":"db_row","table":"focus_sessions"},{"type":"analytics_event","event":"session_complete"}]', 10000, 'high', 'pr_only', 0.97),
  ('upload.study_file', 'Upload study file', 'src/UploadTasks.tsx',
   '[{"type":"api_2xx","matcher":"storage/v1/object"},{"type":"dom","matcher":"upload-ready"}]', 60000, 'high', 'pr_only', 0.93),
  ('ai.generate_tasks', 'AI task generation', 'api/generate-tasks.ts',
   '[{"type":"api_2xx","matcher":"/api/generate-tasks"},{"type":"db_row","table":"tasks"},{"type":"toast"}]', 120000, 'high', 'pr_only', 0.9),
  ('billing.checkout', 'Premium checkout', 'api/billing.ts',
   '[{"type":"api_2xx","matcher":"/api/billing"},{"type":"navigation","route":"stripe"}]', 20000, 'critical', 'manual', 0.95),
  ('billing.portal', 'Billing portal', 'api/billing.ts',
   '[{"type":"api_2xx","matcher":"/api/billing"},{"type":"navigation","route":"stripe"}]', 20000, 'high', 'manual', 0.95),
  ('rooms.join', 'Join a study room', 'src/RoomsLive.tsx',
   '[{"type":"api_2xx","matcher":"rpc/join_room"},{"type":"state","matcher":"realtime_subscribed"},{"type":"dom","matcher":"room-timer"}]', 15000, 'high', 'pr_only', 0.95),
  ('rooms.create', 'Create a study room', 'src/RoomsLive.tsx',
   '[{"type":"db_row","table":"rooms"},{"type":"navigation","route":"rooms"}]', 12000, 'medium', 'pr_only', 0.95),
  ('calendar.plan_session', 'Plan a study session', 'src/StudyInsights.tsx',
   '[{"type":"db_row","table":"planned_study_sessions"},{"type":"dom","matcher":"calendar-entry"}]', 8000, 'medium', 'pr_only', 0.97),
  ('notifications.deliver', 'Notification delivered', 'src/Notifications.tsx',
   '[{"type":"db_row","table":"notifications"},{"type":"dom","matcher":"notification-item"}]', 10000, 'low', 'pr_only', 0.95),
  ('feedback.submit', 'Submit feedback', 'src/Feedback.tsx',
   '[{"type":"db_row","table":"feedback"},{"type":"toast"}]', 8000, 'medium', 'pr_only', 0.97),
  ('avatar.upload', 'Upload avatar', 'src/avatarUpload.ts',
   '[{"type":"api_2xx","matcher":"storage/v1/object"},{"type":"dom","matcher":"avatar-image"}]', 30000, 'low', 'pr_only', 0.95),
  ('premium.gate', 'Premium gate resolves correctly', 'src/LockedFeaturePreview.tsx',
   '[{"type":"state","matcher":"is_premium_resolved"}]', 5000, 'high', 'manual', 0.99)
on conflict (key) do update
  set label = excluded.label, component = excluded.component,
      expectations = excluded.expectations, timeout_ms = excluded.timeout_ms;

insert into public.sh_journeys (key, label, steps, total_timeout_ms, severity, approval_level, min_completion_rate) values
  ('journey.registration', 'Registration → first session',
   '[{"step":"signup_submitted","contract":"auth.sign_up"},{"step":"email_verified"},{"step":"first_signin","contract":"auth.sign_in"},{"step":"first_task","contract":"task.create"}]',
   1800000, 'critical', 'manual', 0.6),
  ('journey.checkout', 'Premium purchase',
   '[{"step":"upgrade_clicked"},{"step":"checkout_session","contract":"billing.checkout"},{"step":"stripe_redirect"},{"step":"webhook_premium"},{"step":"premium_visible","contract":"premium.gate"}]',
   900000, 'critical', 'manual', 0.7),
  ('journey.ai_upload', 'Upload → AI tasks',
   '[{"step":"file_selected"},{"step":"uploaded","contract":"upload.study_file"},{"step":"generated","contract":"ai.generate_tasks"},{"step":"tasks_visible"}]',
   300000, 'high', 'pr_only', 0.8),
  ('journey.study_session', 'Plan → focus → complete',
   '[{"step":"session_started"},{"step":"timer_running"},{"step":"session_saved","contract":"focus.session_complete"}]',
   7200000, 'high', 'pr_only', 0.85),
  ('journey.room', 'Join and study in a room',
   '[{"step":"room_opened"},{"step":"joined","contract":"rooms.join"},{"step":"timer_synced"},{"step":"left_cleanly"}]',
   7200000, 'medium', 'pr_only', 0.8),
  ('journey.cancel', 'Subscription cancellation',
   '[{"step":"portal_opened","contract":"billing.portal"},{"step":"cancel_confirmed"},{"step":"webhook_downgrade"}]',
   900000, 'high', 'manual', 0.8)
on conflict (key) do update set label = excluded.label, steps = excluded.steps;

insert into public.sh_flags (key, label, description, enabled, rollout_percent, auto_rollback_error_rate) values
  ('selfheal.telemetry',    'Self-healing telemetry', 'Master switch for the frontend SDK. Off = zero collection.', true, 100, null),
  ('selfheal.replay',       'Session replay', 'Privacy-masked DOM/interaction replay capture.', true, 25, null),
  ('selfheal.auto_deploy',  'Level 1 auto-deploy', 'Allow cosmetic fixes to deploy without a human.', false, 100, null),
  ('rooms.voice',           'Room voice chat', 'Realtime voice in study rooms.', true, 100, 0.08),
  ('ai.task_generation',    'AI task generation', 'Notes → task list.', true, 100, 0.12),
  ('garden.enabled',        'Garden', 'Garden area and plant growth.', true, 100, 0.15),
  ('music.player',          'Music player', 'Focus channels and playback.', true, 100, 0.10)
on conflict (key) do nothing;

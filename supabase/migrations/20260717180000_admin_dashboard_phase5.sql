-- Admin BI dashboard — Phase 5 read-only operational RPCs (Invites + Errors).
--
-- Same security model as Phases 1-4: SECURITY DEFINER, gated by
-- public.is_admin() inside the query, EXECUTE revoked from public/anon. A
-- non-admin gets zero rows. No schema, RLS, auth, or billing changes.
--
-- Notes:
--   * invitations has no accept timestamp — only created_at and
--     invited_user_id (set when the invite is accepted). So "accepted" counts
--     are cohort-based: an invite CREATED in the window that has since been
--     accepted. The UI labels this.
--   * client_errors has no severity/status columns; grouping here is by exact
--     message + page. Adding severity/status is a schema change deferred to a
--     separately-approved step.

-- ---------------------------------------------------------------------------
-- 1) Invite volume + acceptance summary. Snapshots are lifetime "as of p_end";
--    flow fields cover [p_start, p_end). Call twice for period-over-period Δ.
-- ---------------------------------------------------------------------------
create or replace function public.admin_invite_summary(
  p_start timestamptz,
  p_end   timestamptz
)
returns table (
  total_invites bigint, accepted bigint, pending bigint, unique_inviters bigint,
  sent_in_window bigint, accepted_in_window bigint
)
language sql
security definer
set search_path = public
stable
as $$
  select
    (select count(*) from invitations where created_at < p_end),
    (select count(*) from invitations where created_at < p_end and invited_user_id is not null),
    (select count(*) from invitations where created_at < p_end and invited_user_id is null),
    (select count(distinct inviter_id) from invitations where created_at < p_end),
    (select count(*) from invitations where created_at >= p_start and created_at < p_end),
    (select count(*) from invitations
       where created_at >= p_start and created_at < p_end and invited_user_id is not null)
  where public.is_admin();
$$;

revoke execute on function public.admin_invite_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_invite_summary(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Per-day invite flow: sent, and of those an accepted-cohort count.
-- ---------------------------------------------------------------------------
create or replace function public.admin_invite_series(
  p_start timestamptz,
  p_end   timestamptz
)
returns table (day date, sent bigint, accepted bigint)
language sql
security definer
set search_path = public
stable
as $$
  with days as (
    select generate_series((p_start at time zone 'UTC')::date,
                           (p_end   at time zone 'UTC')::date - 1,
                           interval '1 day')::date as day
  )
  select
    days.day,
    (select count(*) from invitations
       where (created_at at time zone 'UTC')::date = days.day),
    (select count(*) from invitations
       where (created_at at time zone 'UTC')::date = days.day and invited_user_id is not null)
  from days
  where public.is_admin()
  order by days.day;
$$;

revoke execute on function public.admin_invite_series(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_invite_series(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Top recurring client errors in the window, grouped by message + page.
--    occurrences, distinct affected users, and first/last seen for triage.
-- ---------------------------------------------------------------------------
create or replace function public.admin_error_groups(
  p_start timestamptz,
  p_end   timestamptz,
  p_limit int default 50
)
returns table (
  message text, page text, occurrences bigint, affected_users bigint,
  first_seen timestamptz, last_seen timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    e.message,
    coalesce(e.page, '') as page,
    count(*) as occurrences,
    count(distinct e.user_id) as affected_users,
    min(e.created_at) as first_seen,
    max(e.created_at) as last_seen
  from client_errors e
  where public.is_admin()
    and e.created_at >= p_start and e.created_at < p_end
  group by e.message, coalesce(e.page, '')
  order by count(*) desc, max(e.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke execute on function public.admin_error_groups(timestamptz, timestamptz, int) from public, anon;
grant execute on function public.admin_error_groups(timestamptz, timestamptz, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4) Per-day client-error volume + distinct affected users (trend spark).
-- ---------------------------------------------------------------------------
create or replace function public.admin_error_series(
  p_start timestamptz,
  p_end   timestamptz
)
returns table (day date, errors bigint, affected_users bigint)
language sql
security definer
set search_path = public
stable
as $$
  with days as (
    select generate_series((p_start at time zone 'UTC')::date,
                           (p_end   at time zone 'UTC')::date - 1,
                           interval '1 day')::date as day
  )
  select
    days.day,
    (select count(*) from client_errors
       where (created_at at time zone 'UTC')::date = days.day),
    (select count(distinct user_id) from client_errors
       where (created_at at time zone 'UTC')::date = days.day)
  from days
  where public.is_admin()
  order by days.day;
$$;

revoke execute on function public.admin_error_series(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_error_series(timestamptz, timestamptz) to authenticated;

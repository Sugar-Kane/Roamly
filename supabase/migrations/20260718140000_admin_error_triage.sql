-- Admin BI dashboard — Errors triage (approved schema change).
--
-- Adds per-error-signature triage state (status + severity + note) so admins
-- can work the error log like a queue. Triage lives in its own table keyed by
-- the error SIGNATURE (message + page) rather than on client_errors, so state
-- is set once per distinct error and survives new occurrences (and we never
-- fan a write out across thousands of occurrence rows).
--
-- Security: no RLS policies on the triage table — clients can't touch it. All
-- access is through SECURITY DEFINER, is_admin()-gated RPCs (read via the
-- existing admin_error_groups, write via admin_set_error_triage) plus the
-- service role. Signature = md5(message || 0x1f || coalesce(page,'')), computed
-- server-side so the client never has to reproduce it.

create table if not exists public.error_triage (
  signature text primary key,
  message text not null,
  page text,
  status text not null default 'open' check (status in ('open','investigating','resolved','ignored')),
  severity text check (severity is null or severity in ('low','medium','high','critical')),
  note text check (note is null or char_length(note) <= 500),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.error_triage enable row level security;
revoke all on table public.error_triage from public, anon, authenticated;
grant select, insert, update on table public.error_triage to service_role;

-- Shared signature helper so the RPCs and any future caller agree on the key.
create or replace function public.error_signature(p_message text, p_page text)
returns text
language sql
immutable
set search_path = public
as $$
  select md5(coalesce(p_message,'') || chr(31) || coalesce(p_page,''));
$$;

-- Re-create the grouped-errors RPC to left-join triage state. Return type
-- changes, so drop then create.
drop function if exists public.admin_error_groups(timestamptz, timestamptz, int);
create function public.admin_error_groups(
  p_start timestamptz,
  p_end   timestamptz,
  p_limit int default 50
)
returns table (
  message text, page text, occurrences bigint, affected_users bigint,
  first_seen timestamptz, last_seen timestamptz,
  status text, severity text, note text
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
    max(e.created_at) as last_seen,
    coalesce(t.status, 'open') as status,
    t.severity,
    t.note
  from client_errors e
  left join error_triage t
    on t.signature = public.error_signature(e.message, coalesce(e.page, ''))
  where public.is_admin()
    and e.created_at >= p_start and e.created_at < p_end
  group by e.message, coalesce(e.page, ''), t.status, t.severity, t.note
  order by count(*) desc, max(e.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke execute on function public.admin_error_groups(timestamptz, timestamptz, int) from public, anon;
grant execute on function public.admin_error_groups(timestamptz, timestamptz, int) to authenticated;

-- Upsert triage for one error signature. Admin-only (raises otherwise, so it
-- can't be called by a normal authenticated user). Passing p_status/p_severity
-- as null leaves that facet unchanged on an existing row; note is always set.
create or replace function public.admin_set_error_triage(
  p_message  text,
  p_page     text,
  p_status   text default null,
  p_severity text default null,
  p_note     text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sig text := public.error_signature(p_message, coalesce(p_page, ''));
begin
  if not public.is_admin() then raise exception 'not_admin'; end if;
  if p_status is not null and p_status not in ('open','investigating','resolved','ignored') then
    raise exception 'bad_status';
  end if;
  if p_severity is not null and p_severity not in ('low','medium','high','critical') then
    raise exception 'bad_severity';
  end if;

  insert into public.error_triage (signature, message, page, status, severity, note, updated_by, updated_at)
  values (v_sig, p_message, coalesce(p_page, ''), coalesce(p_status, 'open'), p_severity, p_note, auth.uid(), now())
  on conflict (signature) do update set
    status     = coalesce(p_status, error_triage.status),
    severity   = coalesce(p_severity, error_triage.severity),
    note       = coalesce(p_note, error_triage.note),
    updated_by = auth.uid(),
    updated_at = now();
end;
$$;

revoke execute on function public.admin_set_error_triage(text, text, text, text, text) from public, anon;
grant execute on function public.admin_set_error_triage(text, text, text, text, text) to authenticated;

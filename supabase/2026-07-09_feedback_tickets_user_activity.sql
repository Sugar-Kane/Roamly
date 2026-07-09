-- ============================================================================
-- 2026-07-09 — Feedback ticket system + per-user activity search
-- Idempotent: safe to run more than once. Paste the whole block into the
-- Supabase SQL editor (project llpfswjymroikzxohrop) and press Run once.
-- ============================================================================

-- ---- 1) Feedback becomes a ticket ------------------------------------------
-- New lifecycle + admin-reply + GitHub-issue link columns on the existing
-- feedback table. All additive, so existing rows keep working.
alter table public.feedback
  add column if not exists status text not null default 'open'
    check (status in ('open', 'in_progress', 'done'));
alter table public.feedback
  add column if not exists admin_reply text;
alter table public.feedback
  add column if not exists github_issue_number int;
alter table public.feedback
  add column if not exists github_issue_url text;
alter table public.feedback
  add column if not exists updated_at timestamptz not null default now();

-- Read-own policy so submitFeedback's insert().select("id") can return the new
-- row (the client uses that id to mirror the feedback to a GitHub issue).
-- Without a SELECT policy the RETURNING clause is filtered out by RLS and the
-- insert reads as a failure even though the row was saved.
drop policy if exists "feedback_select_own" on public.feedback;
create policy "feedback_select_own"
  on public.feedback for select
  to authenticated
  using (auth.uid() = user_id);

-- Admins read the inbox through this RPC — extend it to return the new ticket
-- fields and sort open tickets first, newest within each status.
create or replace function public.admin_list_feedback(p_limit int default 50)
returns table (
  id uuid, email text, username text, category text, message text,
  repro text, page text, device text, platform text, created_at timestamptz,
  status text, admin_reply text, github_issue_number int, github_issue_url text, updated_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select f.id, p.email, p.username, f.category, f.message, f.repro, f.page,
         f.device, f.platform, f.created_at,
         f.status, f.admin_reply, f.github_issue_number, f.github_issue_url, f.updated_at
    from public.feedback f
    left join public.profiles p on p.id = f.user_id
   where public.is_admin()
   order by (case f.status when 'open' then 0 when 'in_progress' then 1 else 2 end),
            f.created_at desc
   limit greatest(1, least(p_limit, 200));
$$;

revoke execute on function public.admin_list_feedback(int) from public, anon;
grant execute on function public.admin_list_feedback(int) to authenticated;

-- ---- 2) Search one user's activity -----------------------------------------
-- Admin-only: given a search string (email / username / display name), return
-- that user's raw event timeline newest-first so behaviour can be inspected.
create or replace function public.admin_user_activity(p_query text, p_limit int default 200)
returns table (email text, username text, name text, event text, meta text, device text, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select p.email, p.username, p.display_name as name,
         e.name as event, e.meta, e.device, e.created_at
    from public.app_events e
    join public.profiles p on p.id = e.user_id
   where public.is_admin()
     and coalesce(nullif(trim(p_query), ''), '') <> ''
     and (p.email ilike '%' || p_query || '%'
          or p.username ilike '%' || p_query || '%'
          or p.display_name ilike '%' || p_query || '%')
   order by e.created_at desc
   limit greatest(1, least(p_limit, 500));
$$;

revoke execute on function public.admin_user_activity(text, int) from public, anon;
grant execute on function public.admin_user_activity(text, int) to authenticated;

-- Planned-study invites never worked: every insert failed with
--   infinite recursion detected in policy for relation "planned_study_invites"
-- (surfaced in the app as "The plan was saved, but some invitations could not
-- be sent").
--
-- Two policies read each other's tables under RLS:
--   * planned_study_invites INSERT checks the inviter owns the plan by
--     selecting planned_study_sessions, whose SELECT policy ...
--   * planned_study_sessions SELECT lets invitees see a plan by selecting
--     planned_study_invites, whose policies are evaluated again -> recursion.
--
-- That SELECT policy also had a scoping bug: inside the subquery the bare `id`
-- resolved to invitation.id, so it compared an invite to itself and invitees
-- could never see the plan they were invited to.
--
-- Fix: do both cross-table checks in SECURITY DEFINER helpers (they read the
-- other table without re-entering its RLS, the same pattern as
-- has_my_active_premium), and compare against the plan's own id.

create or replace function public.owns_planned_study(p_plan uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.planned_study_sessions plan
    where plan.id = p_plan
      and plan.user_id = (select auth.uid())
  );
$$;

revoke execute on function public.owns_planned_study(uuid) from public, anon;
grant execute on function public.owns_planned_study(uuid) to authenticated;

create or replace function public.invited_to_planned_study(p_plan uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.planned_study_invites invitation
    where invitation.plan_id = p_plan
      and invitation.invitee_id = (select auth.uid())
  );
$$;

revoke execute on function public.invited_to_planned_study(uuid) from public, anon;
grant execute on function public.invited_to_planned_study(uuid) to authenticated;

drop policy if exists planned_sessions_select_own_or_invited on public.planned_study_sessions;
create policy planned_sessions_select_own_or_invited
  on public.planned_study_sessions
  for select
  to authenticated
  using (
    (select public.has_my_active_premium())
    and (
      (select auth.uid()) = user_id
      or public.invited_to_planned_study(id)
    )
  );

drop policy if exists planned_study_invites_insert_premium_owner_friend on public.planned_study_invites;
create policy planned_study_invites_insert_premium_owner_friend
  on public.planned_study_invites
  for insert
  to authenticated
  with check (
    (select public.has_my_active_premium())
    and (select auth.uid()) = inviter_id
    and public.owns_planned_study(plan_id)
    and exists (
      select 1
      from public.friendships friendship
      where friendship.status = 'accepted'
        and (
          (friendship.requester = (select auth.uid()) and friendship.addressee = invitee_id)
          or (friendship.addressee = (select auth.uid()) and friendship.requester = invitee_id)
        )
    )
  );

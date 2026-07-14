-- Planned Study is a Premium-only workflow. Keep existing rows intact, but
-- require a current entitlement for every participant read and every owner write.

drop policy if exists planned_sessions_select_own_or_invited on public.planned_study_sessions;
create policy planned_sessions_select_own_or_invited
  on public.planned_study_sessions
  for select
  to authenticated
  using (
    (select public.has_my_active_premium())
    and (
      (select auth.uid()) = user_id
      or exists (
        select 1
        from public.planned_study_invites invitation
        where invitation.plan_id = id
          and invitation.invitee_id = (select auth.uid())
      )
    )
  );

drop policy if exists "planned_sessions_insert_own" on public.planned_study_sessions;
create policy planned_sessions_insert_premium_own
  on public.planned_study_sessions
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and (select public.has_my_active_premium())
  );

drop policy if exists "planned_sessions_update_own" on public.planned_study_sessions;
create policy planned_sessions_update_premium_own
  on public.planned_study_sessions
  for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    and (select public.has_my_active_premium())
  )
  with check (
    (select auth.uid()) = user_id
    and (select public.has_my_active_premium())
  );

drop policy if exists "planned_sessions_delete_own" on public.planned_study_sessions;
create policy planned_sessions_delete_premium_own
  on public.planned_study_sessions
  for delete
  to authenticated
  using (
    (select auth.uid()) = user_id
    and (select public.has_my_active_premium())
  );

drop policy if exists planned_study_invites_select_participants on public.planned_study_invites;
create policy planned_study_invites_select_premium_participants
  on public.planned_study_invites
  for select
  to authenticated
  using (
    (select public.has_my_active_premium())
    and ((select auth.uid()) = inviter_id or (select auth.uid()) = invitee_id)
  );

drop policy if exists planned_study_invites_insert_owner_friend on public.planned_study_invites;
create policy planned_study_invites_insert_premium_owner_friend
  on public.planned_study_invites
  for insert
  to authenticated
  with check (
    (select public.has_my_active_premium())
    and (select auth.uid()) = inviter_id
    and exists (
      select 1
      from public.planned_study_sessions plan
      where plan.id = plan_id
        and plan.user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.friendships friendship
      where friendship.status = 'accepted'
        and (
          (friendship.requester = (select auth.uid()) and friendship.addressee = invitee_id)
          or
          (friendship.addressee = (select auth.uid()) and friendship.requester = invitee_id)
        )
    )
  );

drop policy if exists planned_study_invites_update_invitee on public.planned_study_invites;
create policy planned_study_invites_update_premium_invitee
  on public.planned_study_invites
  for update
  to authenticated
  using (
    (select public.has_my_active_premium())
    and (select auth.uid()) = invitee_id
  )
  with check (
    (select public.has_my_active_premium())
    and (select auth.uid()) = invitee_id
  );

drop policy if exists planned_study_invites_delete_participants on public.planned_study_invites;
create policy planned_study_invites_delete_premium_participants
  on public.planned_study_invites
  for delete
  to authenticated
  using (
    (select public.has_my_active_premium())
    and ((select auth.uid()) = inviter_id or (select auth.uid()) = invitee_id)
  );

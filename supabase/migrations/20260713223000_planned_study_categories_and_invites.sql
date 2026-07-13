-- Extend planned study to support category snapshots and friend invitations.

alter table public.planned_study_sessions
  add column if not exists target_type text not null default 'task',
  add column if not exists include_all_category_tasks boolean not null default false,
  add column if not exists included_task_ids uuid[] not null default '{}'::uuid[],
  add column if not exists included_task_titles text[] not null default '{}'::text[];

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.planned_study_sessions'::regclass
      and conname = 'planned_study_sessions_target_type_check'
  ) then
    alter table public.planned_study_sessions
      add constraint planned_study_sessions_target_type_check
      check (target_type in ('task', 'category'));
  end if;
end
$$;

create table if not exists public.planned_study_invites (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.planned_study_sessions(id) on delete cascade,
  inviter_id uuid not null references auth.users(id) on delete cascade,
  invitee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint planned_study_invites_distinct_users check (inviter_id <> invitee_id),
  constraint planned_study_invites_unique_invitee unique (plan_id, invitee_id)
);

create index if not exists planned_study_invites_invitee_created_idx
  on public.planned_study_invites (invitee_id, created_at desc);

alter table public.planned_study_invites enable row level security;

grant select, insert, delete on public.planned_study_invites to authenticated;
revoke update on public.planned_study_invites from authenticated;
grant update (status, updated_at) on public.planned_study_invites to authenticated;

drop policy if exists planned_study_invites_select_participants on public.planned_study_invites;
create policy planned_study_invites_select_participants
  on public.planned_study_invites
  for select
  to authenticated
  using ((select auth.uid()) = inviter_id or (select auth.uid()) = invitee_id);

drop policy if exists planned_study_invites_insert_owner_friend on public.planned_study_invites;
create policy planned_study_invites_insert_owner_friend
  on public.planned_study_invites
  for insert
  to authenticated
  with check (
    (select auth.uid()) = inviter_id
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
create policy planned_study_invites_update_invitee
  on public.planned_study_invites
  for update
  to authenticated
  using ((select auth.uid()) = invitee_id)
  with check ((select auth.uid()) = invitee_id);

drop policy if exists planned_study_invites_delete_participants on public.planned_study_invites;
create policy planned_study_invites_delete_participants
  on public.planned_study_invites
  for delete
  to authenticated
  using ((select auth.uid()) = inviter_id or (select auth.uid()) = invitee_id);

drop policy if exists planned_sessions_select_own on public.planned_study_sessions;
drop policy if exists planned_sessions_select_own_or_invited on public.planned_study_sessions;
create policy planned_sessions_select_own_or_invited
  on public.planned_study_sessions
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from public.planned_study_invites invitation
      where invitation.plan_id = id
        and invitation.invitee_id = (select auth.uid())
    )
  );

alter table public.notifications
  add column if not exists planned_study_session_id uuid
    references public.planned_study_sessions(id) on delete set null;

alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in (
    'friend_request',
    'friend_accepted',
    'room_invite',
    'room_created',
    'room_joined',
    'stats_request',
    'stats_approved',
    'planned_study_invite'
  ));

create index if not exists notifications_planned_study_session_idx
  on public.notifications (planned_study_session_id)
  where planned_study_session_id is not null;

create schema if not exists private;

create or replace function private.notify_planned_study_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (
    user_id,
    actor_id,
    kind,
    planned_study_session_id
  )
  values (
    new.invitee_id,
    new.inviter_id,
    'planned_study_invite',
    new.plan_id
  );
  return new;
end;
$$;

revoke all on function private.notify_planned_study_invite() from public, anon, authenticated;

drop trigger if exists notify_planned_study_invite on public.planned_study_invites;
create trigger notify_planned_study_invite
  after insert on public.planned_study_invites
  for each row execute function private.notify_planned_study_invite();

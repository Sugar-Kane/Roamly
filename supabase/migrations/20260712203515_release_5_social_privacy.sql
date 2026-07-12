-- Release 5: database-enforced room privacy and analytics-sharing consent.

alter table public.rooms add column visibility text not null default 'public'
  check (visibility in ('public', 'private'));
alter table public.rooms add column invite_code text;
create unique index rooms_invite_code_uidx on public.rooms(invite_code) where invite_code is not null;

create table public.room_access (
  room_id uuid not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('host', 'invited', 'public')),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index room_access_user_idx on public.room_access(user_id, created_at desc);
alter table public.room_access enable row level security;
grant select on public.room_access to authenticated;
create policy "room_access_select_own" on public.room_access for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.can_access_room(p_room uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (
    select 1 from public.rooms r
    where r.id = p_room and (
      r.is_system or r.visibility = 'public' or r.host_id = (select auth.uid()) or
      exists (select 1 from public.room_access a where a.room_id = r.id and a.user_id = (select auth.uid()))
    )
  );
$$;
revoke execute on function public.can_access_room(uuid) from public, anon;
grant execute on function public.can_access_room(uuid) to authenticated;

create or replace function public.prepare_room_access()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.visibility = 'private' and new.invite_code is null then
    new.invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  elsif new.visibility = 'public' then
    new.invite_code := null;
  end if;
  return new;
end;
$$;
create trigger rooms_prepare_access before insert on public.rooms
  for each row execute function public.prepare_room_access();

create or replace function public.add_room_host_access()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.host_id is not null then
    insert into public.room_access(room_id, user_id, role, invited_by)
    values (new.id, new.host_id, 'host', new.host_id) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger rooms_add_host_access after insert on public.rooms
  for each row execute function public.add_room_host_access();

insert into public.room_access(room_id, user_id, role, invited_by)
select id, host_id, 'host', host_id from public.rooms where host_id is not null
on conflict do nothing;

drop policy if exists "rooms_select_all" on public.rooms;
create policy "rooms_select_accessible" on public.rooms for select to authenticated
  using ((select public.can_access_room(id)));

drop policy if exists "heartbeats_insert_own" on public.room_heartbeats;
create policy "heartbeats_insert_accessible" on public.room_heartbeats for insert to authenticated
  with check ((select auth.uid()) = user_id and (select public.can_access_room(room_id)));
drop policy if exists "heartbeats_update_own" on public.room_heartbeats;
create policy "heartbeats_update_accessible" on public.room_heartbeats for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and (select public.can_access_room(room_id)));

drop policy if exists "room_messages_insert_own" on public.room_messages;
create policy "room_messages_insert_accessible" on public.room_messages for insert to authenticated
  with check ((select auth.uid()) = user_id and (select public.can_access_room(room_id)));
drop policy if exists "room_messages_select_participants" on public.room_messages;
create policy "room_messages_select_accessible" on public.room_messages for select to authenticated
  using ((select public.can_access_room(room_id)) and (
    user_id = (select auth.uid()) or
    exists (select 1 from public.rooms r where r.id = room_id and (r.is_system or r.host_id = (select auth.uid()))) or
    exists (select 1 from public.room_heartbeats h where h.room_id = room_id and h.user_id = (select auth.uid()))
  ));

create or replace function public.join_room(p_room uuid, p_code text default null)
returns setof public.rooms language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  if (select auth.uid()) is null then raise exception 'not_signed_in'; end if;
  select * into v_room from public.rooms where id = p_room;
  if not found then raise exception 'room_not_found'; end if;
  if not (v_room.is_system or v_room.visibility = 'public' or v_room.host_id = (select auth.uid()) or
    exists(select 1 from public.room_access a where a.room_id=p_room and a.user_id=(select auth.uid())) or
    (p_code is not null and upper(trim(p_code)) = v_room.invite_code)) then
    raise exception 'room_access_denied';
  end if;
  insert into public.room_access(room_id,user_id,role)
  values (p_room,(select auth.uid()),case when v_room.visibility='public' or v_room.is_system then 'public' else 'invited' end)
  on conflict (room_id,user_id) do nothing;
  return next v_room;
end;
$$;
revoke execute on function public.join_room(uuid, text) from public, anon;
grant execute on function public.join_room(uuid, text) to authenticated;

create or replace function public.join_room_by_code(p_code text)
returns setof public.rooms language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  select id into v_id from public.rooms where invite_code = upper(trim(p_code)) and visibility='private';
  if v_id is null then raise exception 'invalid_invite_code'; end if;
  return query select * from public.join_room(v_id, p_code);
end;
$$;
revoke execute on function public.join_room_by_code(text) from public, anon;
grant execute on function public.join_room_by_code(text) to authenticated;

-- Room presence channels are private and use the same database authorization.
create policy "room_presence_read" on realtime.messages for select to authenticated using (
  extension = 'presence' and (select realtime.topic()) ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and
  (select public.can_access_room(split_part((select realtime.topic()), ':', 2)::uuid))
);
create policy "room_presence_write" on realtime.messages for insert to authenticated with check (
  extension = 'presence' and (select realtime.topic()) ~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and
  (select public.can_access_room(split_part((select realtime.topic()), ':', 2)::uuid))
);

create or replace function public.invite_to_room(p_room uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not_signed_in'; end if;
  if not exists(select 1 from public.rooms where id=p_room and host_id=(select auth.uid()) and is_system=false) then raise exception 'not_room_host'; end if;
  if not exists(select 1 from public.friendships where status='accepted' and
    ((requester=(select auth.uid()) and addressee=p_user) or (requester=p_user and addressee=(select auth.uid())))) then raise exception 'not_friends'; end if;
  insert into public.room_access(room_id,user_id,role,invited_by)
  values(p_room,p_user,'invited',(select auth.uid()))
  on conflict(room_id,user_id) do update set role='invited', invited_by=excluded.invited_by;
  insert into public.notifications(user_id,actor_id,kind,room_id)
  values(p_user,(select auth.uid()),'room_invite',p_room);
end;
$$;

-- Statistics sharing is separate from friendship and starts with no rows.
create table public.stat_comparison_permissions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','approved')),
  requested_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(owner_id,viewer_id),
  check(owner_id <> viewer_id)
);
create index stat_permissions_viewer_idx on public.stat_comparison_permissions(viewer_id,updated_at desc);
alter table public.stat_comparison_permissions enable row level security;
grant select on public.stat_comparison_permissions to authenticated;
create policy "stat_permissions_parties_read" on public.stat_comparison_permissions for select to authenticated
  using ((select auth.uid()) in (owner_id,viewer_id));

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check
  (kind in ('friend_request','friend_accepted','room_invite','room_created','room_joined','stats_request','stats_approved'));

create or replace function public.request_stat_comparison(p_friend uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.friendships where status='accepted' and
    ((requester=(select auth.uid()) and addressee=p_friend) or (requester=p_friend and addressee=(select auth.uid())))) then raise exception 'not_friends'; end if;
  insert into public.stat_comparison_permissions(owner_id,viewer_id,status,requested_by)
  values(p_friend,(select auth.uid()),'pending',(select auth.uid()))
  on conflict(owner_id,viewer_id) do update set status='pending',requested_by=excluded.requested_by,updated_at=now();
  insert into public.notifications(user_id,actor_id,kind) values(p_friend,(select auth.uid()),'stats_request');
end;
$$;

create or replace function public.respond_stat_comparison(p_viewer uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_approve then
    update public.stat_comparison_permissions set status='approved',updated_at=now()
    where owner_id=(select auth.uid()) and viewer_id=p_viewer and status='pending';
    if not found then raise exception 'request_not_found'; end if;
    insert into public.notifications(user_id,actor_id,kind) values(p_viewer,(select auth.uid()),'stats_approved');
  else
    delete from public.stat_comparison_permissions where owner_id=(select auth.uid()) and viewer_id=p_viewer and status='pending';
    if not found then raise exception 'request_not_found'; end if;
  end if;
end;
$$;

create or replace function public.revoke_stat_comparison(p_friend uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.stat_comparison_permissions
  where (owner_id=(select auth.uid()) and viewer_id=p_friend) or (owner_id=p_friend and viewer_id=(select auth.uid()));
end;
$$;

create or replace function public.get_friend_comparison(p_friend uuid)
returns table(focus_minutes bigint,session_count bigint,weekly_consistency bigint,achievements int,level int,category_minutes jsonb)
language sql security definer stable set search_path = '' as $$
  with allowed as (
    select 1 where exists(select 1 from public.stat_comparison_permissions p
      where p.owner_id=p_friend and p.viewer_id=(select auth.uid()) and p.status='approved')
    and exists(select 1 from public.friendships f where f.status='accepted' and
      ((f.requester=(select auth.uid()) and f.addressee=p_friend) or (f.requester=p_friend and f.addressee=(select auth.uid()))))
  ), totals as (
    select coalesce(sum(minutes),0)::bigint focus_minutes,
      count(*) filter(where minutes>0)::bigint active_days,
      count(*) filter(where date>=current_date-6 and minutes>0)::bigint weekly_consistency
    from public.focus_sessions,allowed where user_id=p_friend
  ), events as (
    select count(*)::bigint session_count from public.study_session_events,allowed where user_id=p_friend
  ), cats as (
    select coalesce(jsonb_object_agg(category,total),'{}'::jsonb) category_minutes from (
      select category,sum(minutes)::bigint total from public.study_session_events,allowed where user_id=p_friend group by category
    ) q
  )
  select t.focus_minutes,e.session_count,t.weekly_consistency,
    ((t.focus_minutes>0)::int+(t.focus_minutes>=600)::int+(t.focus_minutes>=1500)::int+(t.active_days>=7)::int) achievements,
    greatest(1,floor(t.focus_minutes/600.0)::int+1),c.category_minutes
  from totals t cross join events e cross join cats c where exists(select 1 from allowed);
$$;

revoke execute on function public.request_stat_comparison(uuid) from public,anon;
revoke execute on function public.respond_stat_comparison(uuid,boolean) from public,anon;
revoke execute on function public.revoke_stat_comparison(uuid) from public,anon;
revoke execute on function public.get_friend_comparison(uuid) from public,anon;
grant execute on function public.request_stat_comparison(uuid) to authenticated;
grant execute on function public.respond_stat_comparison(uuid,boolean) to authenticated;
grant execute on function public.revoke_stat_comparison(uuid) to authenticated;
grant execute on function public.get_friend_comparison(uuid) to authenticated;

revoke execute on function public.invite_to_room(uuid,uuid) from public,anon;
grant execute on function public.invite_to_room(uuid,uuid) to authenticated;

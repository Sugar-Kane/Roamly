-- Release 11: companions, leveling, achievements & rewards.
--
-- Adds the first persistent gamification layer. Two unlock tracks:
--   * Pets are earned by cumulative completed-session milestones (everyone
--     starts with a dog and a cat, both unlock at 0 sessions).
--   * XP -> levels -> level rewards (plants, trees, pet cosmetics, themes).
-- XP = achievement XP (each achievement is worth XP) + per-session activity XP,
-- where room/group sessions apply a headcount multiplier so studying together
-- levels you faster.
--
-- All awarding happens inside security-definer RPCs so a client can never
-- self-grant XP, pets, or rewards. Catalog tables are read-only reference data;
-- the per-user tables are own-row readable, and only the is_active flag is
-- client-writable (which pet/plant to show).

-- ============ catalogs (static reference data) ============
create table public.pet_catalog (
  id text primary key,
  species text not null,
  name text not null,
  unlock_sessions int not null default 0 check (unlock_sessions >= 0),
  sort int not null default 0
);
alter table public.pet_catalog enable row level security;
grant select on public.pet_catalog to authenticated;
create policy "pet_catalog_read" on public.pet_catalog for select to authenticated using (true);

create table public.reward_catalog (
  id text primary key,
  kind text not null check (kind in ('plant', 'tree', 'accessory', 'theme')),
  name text not null,
  unlock_level int not null default 1 check (unlock_level >= 1),
  meta jsonb not null default '{}'::jsonb,
  sort int not null default 0
);
alter table public.reward_catalog enable row level security;
grant select on public.reward_catalog to authenticated;
create policy "reward_catalog_read" on public.reward_catalog for select to authenticated using (true);

create table public.achievement_catalog (
  id text primary key,
  name text not null,
  hint text not null,
  xp int not null default 0 check (xp >= 0),
  sort int not null default 0
);
alter table public.achievement_catalog enable row level security;
grant select on public.achievement_catalog to authenticated;
create policy "achievement_catalog_read" on public.achievement_catalog for select to authenticated using (true);

-- ============ per-user gamification state ============
create table public.gamification_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  xp int not null default 0,
  level int not null default 1,
  sessions_completed int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.gamification_state enable row level security;
grant select on public.gamification_state to authenticated;
create policy "gamification_state_select_own" on public.gamification_state
  for select to authenticated using ((select auth.uid()) = user_id);
-- No client insert/update/delete: only sync_my_gamification() (security definer) writes.

create table public.user_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  achievement_id text not null references public.achievement_catalog(id),
  earned_at timestamptz not null default now(),
  primary key (user_id, achievement_id)
);
alter table public.user_achievements enable row level security;
grant select on public.user_achievements to authenticated;
create policy "user_achievements_select_own" on public.user_achievements
  for select to authenticated using ((select auth.uid()) = user_id);

create table public.user_pets (
  user_id uuid not null references auth.users(id) on delete cascade,
  pet_id text not null references public.pet_catalog(id),
  earned_at timestamptz not null default now(),
  is_active boolean not null default false,
  primary key (user_id, pet_id)
);
alter table public.user_pets enable row level security;
grant select on public.user_pets to authenticated;
grant update (is_active) on public.user_pets to authenticated;
create policy "user_pets_select_own" on public.user_pets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_pets_update_own" on public.user_pets
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create table public.user_rewards (
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_id text not null references public.reward_catalog(id),
  earned_at timestamptz not null default now(),
  growth_points int not null default 0,
  is_active boolean not null default false,
  primary key (user_id, reward_id)
);
alter table public.user_rewards enable row level security;
grant select on public.user_rewards to authenticated;
grant update (is_active) on public.user_rewards to authenticated;
create policy "user_rewards_select_own" on public.user_rewards
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "user_rewards_update_own" on public.user_rewards
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ============ group-session crediting ============
-- Room focus blocks were never credited to study_session_events before; the
-- new group_size records how many people shared the room when the block ended.
alter table public.study_session_events
  add column if not exists group_size int not null default 1 check (group_size between 1 and 1000);

-- record_focus_session gains p_group_size. Drop the old 6-arg signature and
-- recreate with the extra defaulted parameter (named-param callers that omit it
-- still resolve to this function and get the default of 1).
drop function if exists public.record_focus_session(date, int, uuid, text, text, text);
create or replace function public.record_focus_session(
  p_date date,
  p_minutes int,
  p_task uuid default null,
  p_task_title text default null,
  p_category text default 'Uncategorized',
  p_kind text default 'countdown',
  p_group_size int default 1
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_event uuid;
  v_category text := coalesce(nullif(left(trim(p_category), 80), ''), 'Uncategorized');
  v_group int := least(1000, greatest(1, coalesce(p_group_size, 1)));
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if p_minutes not between 1 and 1440 then raise exception 'invalid_minutes'; end if;
  if p_kind not in ('countdown', 'count_up', 'room') then raise exception 'invalid_session_kind'; end if;
  if p_task is not null and not exists (
    select 1 from public.tasks t where t.id = p_task and t.user_id = v_user
  ) then raise exception 'invalid_task'; end if;

  insert into public.focus_sessions(user_id, date, minutes)
  values (v_user, p_date, p_minutes)
  on conflict (user_id, date) do update
    set minutes = public.focus_sessions.minutes + excluded.minutes, updated_at = now();

  insert into public.study_session_events(user_id, task_id, task_title, category, minutes, session_kind, group_size)
  values (v_user, p_task, nullif(left(trim(p_task_title), 500), ''), v_category, p_minutes, p_kind, v_group)
  returning id into v_event;
  return v_event;
end;
$$;
revoke execute on function public.record_focus_session(date, int, uuid, text, text, text, int) from public, anon;
grant execute on function public.record_focus_session(date, int, uuid, text, text, text, int) to authenticated;

-- ============ public stats sharing ============
alter table public.profiles add column if not exists stats_public boolean not null default false;
-- Not added to the column-level update grant on profiles: enabling public
-- sharing is Premium-only, enforced by set_stats_public() below.

create or replace function public.set_stats_public(p_public boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not_authenticated'; end if;
  if p_public and not public.has_my_active_premium() then raise exception 'premium_required'; end if;
  update public.profiles set stats_public = p_public, updated_at = now() where id = (select auth.uid());
end;
$$;
revoke execute on function public.set_stats_public(boolean) from public, anon;
grant execute on function public.set_stats_public(boolean) to authenticated;

-- ============ XP curve ============
-- level = 1 + floor(sqrt(xp / 50)); its inverse gives the XP a level starts at.
create or replace function public.level_for_xp(p_xp int)
returns int language sql immutable set search_path = '' as $$
  select greatest(1, floor(sqrt(greatest(coalesce(p_xp, 0), 0) / 50.0))::int + 1);
$$;
create or replace function public.xp_for_level(p_level int)
returns int language sql immutable set search_path = '' as $$
  select (greatest(coalesce(p_level, 1), 1) - 1) * (greatest(coalesce(p_level, 1), 1) - 1) * 50;
$$;
revoke execute on function public.level_for_xp(int) from public, anon;
revoke execute on function public.xp_for_level(int) from public, anon;
grant execute on function public.level_for_xp(int) to authenticated;
grant execute on function public.xp_for_level(int) to authenticated;

-- ============ seed catalogs ============
insert into public.pet_catalog(id, species, name, unlock_sessions, sort) values
  ('dog',     'dog',     'Pip the Pup',      0,   1),
  ('cat',     'cat',     'Mochi the Cat',    0,   2),
  ('bird',    'bird',    'Sunny the Finch',  5,   3),
  ('rabbit',  'rabbit',  'Clover the Bunny', 15,  4),
  ('hamster', 'hamster', 'Biscuit',          30,  5),
  ('fox',     'fox',     'Ember the Fox',    60,  6),
  ('penguin', 'penguin', 'Waddles',          100, 7),
  ('owl',     'owl',     'Professor Hoot',   150, 8),
  ('turtle',  'turtle',  'Sage the Turtle',  250, 9)
on conflict (id) do nothing;

insert into public.reward_catalog(id, kind, name, unlock_level, meta, sort) values
  ('sprout',        'plant',     'Sprout',          1,  '{"emoji":"🌱"}', 1),
  ('succulent',     'plant',     'Succulent',       2,  '{"emoji":"🪴"}', 2),
  ('pet_bed',       'accessory', 'Cozy Pet Bed',    3,  '{"emoji":"🛏️"}', 3),
  ('fern',          'plant',     'Fern',            4,  '{"emoji":"🌿"}', 4),
  ('bonsai',        'tree',      'Bonsai',          5,  '{"emoji":"🎍"}', 5),
  ('sunflower',     'plant',     'Sunflower',       6,  '{"emoji":"🌻"}', 6),
  ('party_hat',     'accessory', 'Party Hat',       7,  '{"emoji":"🎉"}', 7),
  ('maple_sapling', 'tree',      'Maple Sapling',   8,  '{"emoji":"🍁"}', 8),
  ('monstera',      'plant',     'Monstera',        9,  '{"emoji":"🌴"}', 9),
  ('forest_theme',  'theme',     'Forest Theme',    10, '{"emoji":"🌲"}', 10),
  ('crown',         'accessory', 'Golden Crown',    11, '{"emoji":"👑"}', 11),
  ('oak',           'tree',      'Mighty Oak',      12, '{"emoji":"🌳"}', 12),
  ('midnight_theme','theme',     'Midnight Theme',  14, '{"emoji":"🌙"}', 13),
  ('cherry_blossom','tree',      'Cherry Blossom',  15, '{"emoji":"🌸"}', 14)
on conflict (id) do nothing;

insert into public.achievement_catalog(id, name, hint, xp, sort) values
  ('first_focus',    'First focus',    'Finish one focus session',       20,  1),
  ('streak_3',       '3-day streak',   'Study 3 days in a row',          30,  2),
  ('streak_7',       '7-day streak',   'Study 7 days in a row',          60,  3),
  ('century_day',    'Century day',    '100 focus minutes in a day',     40,  4),
  ('deep_day',       'Deep day',       '3 hours of focus in one day',    80,  5),
  ('total_10h',      '10 hours in',    '10 hours of total focus',        50,  6),
  ('total_25h',      '25 hours in',    '25 hours of total focus',        100, 7),
  ('task_finisher',  'Task finisher',  'Complete 10 tasks',              50,  8),
  ('total_50h',      '50 hours in',    '50 hours of total focus',        150, 9),
  ('sessions_50',    'Half-century',   'Complete 50 focus sessions',     80,  10),
  ('social_studier', 'Study buddy',    'Finish a session in a group room', 40, 11),
  ('streak_30',      'Monthly master', 'Study 30 days in a row',         300, 12)
on conflict (id) do nothing;

-- ============ sync: recompute & award (idempotent) ============
create or replace function public.sync_my_gamification()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_total_min bigint := 0;
  v_best_day bigint := 0;
  v_streak int := 0;
  v_sessions int := 0;
  v_done_tasks int := 0;
  v_has_room boolean := false;
  v_activity_xp int := 0;
  v_ach_xp int := 0;
  v_xp int := 0;
  v_level int := 1;
  v_new_ach text[] := '{}';
  v_new_pets text[] := '{}';
  v_new_rewards text[] := '{}';
begin
  if v_user is null then return '{}'::jsonb; end if;

  select coalesce(sum(minutes), 0), coalesce(max(minutes), 0)
    into v_total_min, v_best_day
    from public.focus_sessions where user_id = v_user;

  select count(*) into v_sessions from public.study_session_events where user_id = v_user;
  select count(*) into v_done_tasks from public.tasks where user_id = v_user and done;
  select exists(select 1 from public.study_session_events where user_id = v_user and session_kind = 'room')
    into v_has_room;
  select coalesce(sum(10 * least(3.0, 1 + 0.25 * (group_size - 1))), 0)::int
    into v_activity_xp
    from public.study_session_events where user_id = v_user;

  -- Current streak = length of the most recent consecutive run of active days,
  -- counted only if it reaches today or yesterday (a one-day grace).
  with active as (
    select distinct date d from public.focus_sessions
     where user_id = v_user and minutes > 0 and date <= current_date
  ), ranked as (
    select d, (d - (row_number() over (order by d))::int) grp from active
  ), runs as (
    select grp, count(*) len, max(d) last_day from ranked group by grp
  )
  select coalesce((select len from runs where last_day >= current_date - 1 order by last_day desc limit 1), 0)
    into v_streak;

  -- Award newly-earned achievements from real metrics.
  with ins as (
    insert into public.user_achievements(user_id, achievement_id)
    select v_user, a.id from (values
      ('first_focus',    v_total_min > 0),
      ('streak_3',       v_streak >= 3),
      ('streak_7',       v_streak >= 7),
      ('century_day',    v_best_day >= 100),
      ('deep_day',       v_best_day >= 180),
      ('total_10h',      v_total_min >= 600),
      ('total_25h',      v_total_min >= 1500),
      ('task_finisher',  v_done_tasks >= 10),
      ('total_50h',      v_total_min >= 3000),
      ('sessions_50',    v_sessions >= 50),
      ('social_studier', v_has_room),
      ('streak_30',      v_streak >= 30)
    ) as a(id, earned)
    where a.earned
    on conflict (user_id, achievement_id) do nothing
    returning achievement_id
  )
  select coalesce(array_agg(achievement_id), '{}'::text[]) into v_new_ach from ins;

  select coalesce(sum(c.xp), 0) into v_ach_xp
    from public.user_achievements ua
    join public.achievement_catalog c on c.id = ua.achievement_id
   where ua.user_id = v_user;

  v_xp := v_ach_xp + v_activity_xp;
  v_level := public.level_for_xp(v_xp);

  -- Award pets by cumulative completed sessions (dog + cat unlock at 0).
  with ins as (
    insert into public.user_pets(user_id, pet_id)
    select v_user, p.id from public.pet_catalog p where p.unlock_sessions <= v_sessions
    on conflict (user_id, pet_id) do nothing
    returning pet_id
  )
  select coalesce(array_agg(pet_id), '{}'::text[]) into v_new_pets from ins;

  -- Award level rewards.
  with ins as (
    insert into public.user_rewards(user_id, reward_id)
    select v_user, r.id from public.reward_catalog r where r.unlock_level <= v_level
    on conflict (user_id, reward_id) do nothing
    returning reward_id
  )
  select coalesce(array_agg(reward_id), '{}'::text[]) into v_new_rewards from ins;

  -- Ensure a starter pet and starter plant are active so something always shows.
  if not exists (select 1 from public.user_pets where user_id = v_user and is_active) then
    update public.user_pets set is_active = true where user_id = v_user and pet_id = 'dog';
  end if;
  if not exists (
    select 1 from public.user_rewards ur join public.reward_catalog rc on rc.id = ur.reward_id
     where ur.user_id = v_user and ur.is_active and rc.kind in ('plant', 'tree')
  ) then
    update public.user_rewards ur set is_active = true
      from public.reward_catalog rc
     where ur.reward_id = rc.id and ur.user_id = v_user and rc.kind in ('plant', 'tree')
       and rc.unlock_level = (
         select min(rc2.unlock_level) from public.user_rewards ur2
           join public.reward_catalog rc2 on rc2.id = ur2.reward_id
          where ur2.user_id = v_user and rc2.kind in ('plant', 'tree')
       );
  end if;

  -- Growth of the active plant/tree scales with cumulative completed sessions.
  update public.user_rewards ur set growth_points = v_sessions
    from public.reward_catalog rc
   where ur.reward_id = rc.id and ur.user_id = v_user and rc.kind in ('plant', 'tree') and ur.is_active;

  insert into public.gamification_state(user_id, xp, level, sessions_completed, updated_at)
  values (v_user, v_xp, v_level, v_sessions, now())
  on conflict (user_id) do update
    set xp = excluded.xp, level = excluded.level,
        sessions_completed = excluded.sessions_completed, updated_at = now();

  return jsonb_build_object(
    'xp', v_xp,
    'level', v_level,
    'sessions_completed', v_sessions,
    'new_achievements', to_jsonb(v_new_ach),
    'new_pets', to_jsonb(v_new_pets),
    'new_rewards', to_jsonb(v_new_rewards)
  );
end;
$$;
revoke execute on function public.sync_my_gamification() from public, anon;
grant execute on function public.sync_my_gamification() to authenticated;

-- ============ read: full state for the UI ============
create or replace function public.get_my_gamification()
returns jsonb language sql security definer stable set search_path = '' as $$
  with u as (select (select auth.uid()) as uid),
  st as (
    select coalesce(g.xp, 0) xp, coalesce(g.level, 1) lvl, coalesce(g.sessions_completed, 0) sc
    from u left join public.gamification_state g on g.user_id = u.uid
  )
  select jsonb_build_object(
    'xp', st.xp,
    'level', st.lvl,
    'sessions_completed', st.sc,
    'xp_for_level', public.xp_for_level(st.lvl),
    'xp_for_next', public.xp_for_level(st.lvl + 1),
    'stats_public', coalesce((select p.stats_public from public.profiles p, u where p.id = u.uid), false),
    'achievements', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'hint', c.hint, 'xp', c.xp, 'sort', c.sort,
        'earned', ua.user_id is not null, 'earned_at', ua.earned_at) order by c.sort), '[]'::jsonb)
      from public.achievement_catalog c
      left join public.user_achievements ua
        on ua.achievement_id = c.id and ua.user_id = (select uid from u)
    ),
    'pets', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'species', c.species, 'name', c.name,
        'unlock_sessions', c.unlock_sessions, 'sort', c.sort,
        'owned', up.user_id is not null, 'is_active', coalesce(up.is_active, false)) order by c.sort), '[]'::jsonb)
      from public.pet_catalog c
      left join public.user_pets up
        on up.pet_id = c.id and up.user_id = (select uid from u)
    ),
    'rewards', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'name', c.name, 'unlock_level', c.unlock_level,
        'meta', c.meta, 'sort', c.sort,
        'owned', ur.user_id is not null, 'is_active', coalesce(ur.is_active, false),
        'growth_points', coalesce(ur.growth_points, 0)) order by c.sort), '[]'::jsonb)
      from public.reward_catalog c
      left join public.user_rewards ur
        on ur.reward_id = c.id and ur.user_id = (select uid from u)
    )
  ) from st;
$$;
revoke execute on function public.get_my_gamification() from public, anon;
grant execute on function public.get_my_gamification() to authenticated;

-- ============ friend comparison: Premium-gated + public sharing + real level ============
-- Requesting a comparison is now a Premium action.
create or replace function public.request_stat_comparison(p_friend uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_my_active_premium() then raise exception 'premium_required'; end if;
  if not exists(select 1 from public.friendships where status='accepted' and
    ((requester=(select auth.uid()) and addressee=p_friend) or (requester=p_friend and addressee=(select auth.uid())))) then raise exception 'not_friends'; end if;
  insert into public.stat_comparison_permissions(owner_id,viewer_id,status,requested_by)
  values(p_friend,(select auth.uid()),'pending',(select auth.uid()))
  on conflict(owner_id,viewer_id) do update set status='pending',requested_by=excluded.requested_by,updated_at=now();
  insert into public.notifications(user_id,actor_id,kind) values(p_friend,(select auth.uid()),'stats_request');
end;
$$;

-- Viewing a friend's stats requires the viewer to be Premium and either an
-- approved per-friend permission OR the owner having public sharing enabled.
-- Adds pets_count and sources level/achievements from the persistent tables.
drop function if exists public.get_friend_comparison(uuid);
create or replace function public.get_friend_comparison(p_friend uuid)
returns table(focus_minutes bigint, session_count bigint, weekly_consistency bigint,
              achievements int, level int, category_minutes jsonb, pets_count bigint)
language sql security definer stable set search_path = '' as $$
  with allowed as (
    select 1
    where (select public.has_my_active_premium())
      and exists(select 1 from public.friendships f where f.status='accepted' and
        ((f.requester=(select auth.uid()) and f.addressee=p_friend) or (f.requester=p_friend and f.addressee=(select auth.uid()))))
      and (
        exists(select 1 from public.stat_comparison_permissions p
          where p.owner_id=p_friend and p.viewer_id=(select auth.uid()) and p.status='approved')
        or exists(select 1 from public.profiles pr where pr.id=p_friend and pr.stats_public)
      )
  ), totals as (
    select coalesce(sum(minutes),0)::bigint focus_minutes,
      count(*) filter(where date>=current_date-6 and minutes>0)::bigint weekly_consistency
    from public.focus_sessions, allowed where user_id=p_friend
  ), events as (
    select count(*)::bigint session_count from public.study_session_events, allowed where user_id=p_friend
  ), cats as (
    select coalesce(jsonb_object_agg(category,total),'{}'::jsonb) category_minutes from (
      select category,sum(minutes)::bigint total from public.study_session_events, allowed where user_id=p_friend group by category
    ) q
  )
  select t.focus_minutes, e.session_count, t.weekly_consistency,
    coalesce((select count(*)::int from public.user_achievements ua, allowed where ua.user_id=p_friend), 0),
    coalesce((select g.level from public.gamification_state g, allowed where g.user_id=p_friend), 1),
    c.category_minutes,
    coalesce((select count(*)::bigint from public.user_pets up, allowed where up.user_id=p_friend), 0)
  from totals t cross join events e cross join cats c where exists(select 1 from allowed);
$$;

revoke execute on function public.request_stat_comparison(uuid) from public, anon;
grant execute on function public.request_stat_comparison(uuid) to authenticated;
revoke execute on function public.get_friend_comparison(uuid) from public, anon;
grant execute on function public.get_friend_comparison(uuid) to authenticated;

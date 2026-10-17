-- Release 19: the garden grows with study TIME, not session count.
--
-- Plants and trees used to grow one stage per 6 completed sessions, so a
-- 15-minute sprint grew a plant exactly as much as a 90-minute deep block, and
-- nothing showed progress between stages. Growth is now measured in focus
-- minutes recorded since the plant went into the garden:
--   * user_rewards.planted_at_minutes — the user's recorded focus minutes at the
--     moment of planting (stamped server-side, like planted_at_sessions);
--   * user_rewards.growth_minutes — focus minutes since then, maintained by
--     sync_my_gamification and returned by get_my_gamification.
-- Stage thresholds live in the client (src/petCatalog.ts PLANT_STAGE_MINUTES;
-- trees take twice as long). growth_points (sessions) is still maintained so a
-- client deployed before or after this migration keeps working.
--
-- Minutes come from study_session_events (one row per recorded block), the same
-- source as the session count, so the session-based baseline converts exactly:
-- a plant planted after the user's Nth session gets the minutes of their first
-- N sessions as its baseline.

alter table public.user_rewards
  add column if not exists planted_at_minutes int not null default 0,
  add column if not exists growth_minutes int not null default 0;

-- Convert existing baselines: minutes of the first planted_at_sessions blocks.
update public.user_rewards ur
   set planted_at_minutes = coalesce((
     select sum(e.minutes) from (
       select se.minutes from public.study_session_events se
        where se.user_id = ur.user_id
        order by se.completed_at, se.id
        limit ur.planted_at_sessions
     ) e), 0)
 where ur.planted_at_sessions > 0;

-- Seed growth_minutes for everything currently planted, so the garden shows the
-- right size before each user's next sync.
update public.user_rewards ur
   set growth_minutes = greatest(0, coalesce((
     select sum(se.minutes) from public.study_session_events se where se.user_id = ur.user_id), 0) - ur.planted_at_minutes)
  from public.reward_catalog rc
 where ur.reward_id = rc.id and rc.kind in ('plant', 'tree') and ur.is_active;

-- Stamp both baselines on planting (false -> true); a replanted reward starts
-- over as a seedling.
create or replace function public.stamp_planted_baseline()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_active and not coalesce(old.is_active, false) then
    new.planted_at_sessions := coalesce(
      (select gs.sessions_completed from public.gamification_state gs where gs.user_id = new.user_id), 0);
    new.planted_at_minutes := coalesce(
      (select sum(se.minutes) from public.study_session_events se where se.user_id = new.user_id), 0);
    new.growth_minutes := 0;
  end if;
  return new;
end;
$$;

-- ============ sync: release 17 body + time-based growth ============
create or replace function public.sync_my_gamification()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid());
  v_total_min bigint := 0;
  v_event_min bigint := 0;
  v_best_day bigint := 0;
  v_streak int := 0;
  v_sessions int := 0;
  v_done_tasks int := 0;
  v_has_room boolean := false;
  v_room_sessions int := 0;
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

  select count(*), coalesce(sum(minutes), 0) into v_sessions, v_event_min
    from public.study_session_events where user_id = v_user;
  select count(*) into v_done_tasks from public.tasks where user_id = v_user and done;
  select count(*) into v_room_sessions
    from public.study_session_events where user_id = v_user and session_kind = 'room';
  v_has_room := v_room_sessions > 0;
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
      -- Focus time
      ('first_focus',      v_total_min > 0),
      ('half_century_day', v_best_day >= 50),
      ('century_day',      v_best_day >= 100),
      ('deep_day',         v_best_day >= 180),
      ('ultra_day',        v_best_day >= 300),
      ('marathon_day',     v_best_day >= 480),
      ('total_5h',         v_total_min >= 300),
      ('total_10h',        v_total_min >= 600),
      ('total_25h',        v_total_min >= 1500),
      ('total_50h',        v_total_min >= 3000),
      ('total_100h',       v_total_min >= 6000),
      ('total_250h',       v_total_min >= 15000),
      ('total_500h',       v_total_min >= 30000),
      ('total_1000h',      v_total_min >= 60000),
      -- Session milestones
      ('sessions_10',      v_sessions >= 10),
      ('sessions_25',      v_sessions >= 25),
      ('sessions_50',      v_sessions >= 50),
      ('sessions_100',     v_sessions >= 100),
      ('sessions_250',     v_sessions >= 250),
      ('sessions_500',     v_sessions >= 500),
      ('sessions_1000',    v_sessions >= 1000),
      -- Streaks & consistency
      ('streak_3',         v_streak >= 3),
      ('streak_7',         v_streak >= 7),
      ('streak_14',        v_streak >= 14),
      ('streak_21',        v_streak >= 21),
      ('streak_30',        v_streak >= 30),
      ('streak_60',        v_streak >= 60),
      ('streak_100',       v_streak >= 100),
      ('streak_180',       v_streak >= 180),
      ('streak_365',       v_streak >= 365),
      -- Tasks
      ('task_finisher',    v_done_tasks >= 10),
      ('task_25',          v_done_tasks >= 25),
      ('task_50',          v_done_tasks >= 50),
      ('task_100',         v_done_tasks >= 100),
      ('task_250',         v_done_tasks >= 250),
      ('task_500',         v_done_tasks >= 500),
      -- Group study
      ('social_studier',   v_has_room),
      ('squad_scholar',    v_room_sessions >= 10),
      ('squad_25',         v_room_sessions >= 25),
      ('squad_50',         v_room_sessions >= 50),
      ('squad_100',        v_room_sessions >= 100)
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

  -- Growth is counted from the moment a plant went INTO the garden, so adding
  -- something new starts it as a seedling instead of teleporting it to your
  -- lifetime total. Rows planted before this column existed carry a baseline of
  -- 0, which is exactly the old "grows with all your sessions" behaviour.
  -- Time-based growth (release 19): growth_minutes is the focus time recorded
  -- since planting. growth_points (sessions) is kept for older clients.
  update public.user_rewards ur set growth_points = greatest(0, v_sessions - ur.planted_at_sessions),
         growth_minutes = greatest(0, v_event_min - ur.planted_at_minutes)
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

-- ============ read: expose growth_minutes, and unlock dates for pets/rewards ============
-- earned_at lets the Garden page's journey timeline place every unlock on the
-- day it happened (achievements already carried it).
create or replace function public.get_my_gamification()
returns jsonb language sql stable security definer set search_path = '' as $$
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
        'owned', up.user_id is not null, 'is_active', coalesce(up.is_active, false),
        'earned_at', up.earned_at) order by c.sort), '[]'::jsonb)
      from public.pet_catalog c
      left join public.user_pets up
        on up.pet_id = c.id and up.user_id = (select uid from u)
    ),
    'rewards', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'name', c.name, 'unlock_level', c.unlock_level,
        'meta', c.meta, 'sort', c.sort,
        'owned', ur.user_id is not null, 'is_active', coalesce(ur.is_active, false),
        'growth_points', coalesce(ur.growth_points, 0),
        'growth_minutes', coalesce(ur.growth_minutes, 0),
        'earned_at', ur.earned_at) order by c.sort), '[]'::jsonb)
      from public.reward_catalog c
      left join public.user_rewards ur
        on ur.reward_id = c.id and ur.user_id = (select uid from u)
    )
  ) from st;
$$;
revoke execute on function public.get_my_gamification() from public, anon;
grant execute on function public.get_my_gamification() to authenticated;

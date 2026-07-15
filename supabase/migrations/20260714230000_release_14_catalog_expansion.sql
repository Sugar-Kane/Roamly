-- Release 14: catalog expansion — more achievements, companions & level rewards.
--
-- Adds 10 achievements (new long-term streak/hour/session/task tiers plus a
-- group-room counter), 9 companions extending the session curve to 1000, and
-- 12 level rewards extending the level curve to 30. Existing pet sort values
-- are renumbered so the collection stays ordered by unlock milestone.
-- sync_my_gamification() is recreated with the new award conditions and one
-- new metric (count of room sessions). Mirror of src/petCatalog.ts — keep the
-- two in sync.

-- ============ pets ============
update public.pet_catalog set sort = 7  where id = 'fox';
update public.pet_catalog set sort = 9  where id = 'penguin';
update public.pet_catalog set sort = 11 where id = 'owl';
update public.pet_catalog set sort = 13 where id = 'turtle';

insert into public.pet_catalog(id, species, name, unlock_sessions, sort) values
  ('duck',     'duck',     'Puddles the Duck',  40,   6),
  ('frog',     'frog',     'Lilypad Louie',     80,   8),
  ('raccoon',  'raccoon',  'Bandit',            120,  10),
  ('hedgehog', 'hedgehog', 'Pokey',             200,  12),
  ('koala',    'koala',    'Eucalyptus Eddie',  350,  14),
  ('sloth',    'sloth',    'Slowmo the Sloth',  450,  15),
  ('panda',    'panda',    'Bamboo',            600,  16),
  ('dragon',   'dragon',   'Cinder the Dragon', 800,  17),
  ('unicorn',  'unicorn',  'Stardust',          1000, 18)
on conflict (id) do nothing;

-- ============ level rewards ============
insert into public.reward_catalog(id, kind, name, unlock_level, meta, sort) values
  ('cactus',         'plant',     'Desert Cactus',  16, '{"emoji":"🌵"}', 15),
  ('study_cap',      'accessory', 'Study Cap',      17, '{"emoji":"🧢"}', 16),
  ('mushroom_grove', 'plant',     'Mushroom Grove', 18, '{"emoji":"🍄"}', 17),
  ('wishing_bamboo', 'tree',      'Wishing Bamboo', 19, '{"emoji":"🎋"}', 18),
  ('rainbow_theme',  'theme',     'Rainbow Theme',  20, '{"emoji":"🌈"}', 19),
  ('cool_shades',    'accessory', 'Cool Shades',    21, '{"emoji":"🕶️"}', 20),
  ('hibiscus',       'plant',     'Hibiscus',       22, '{"emoji":"🌺"}', 21),
  ('evergreen',      'tree',      'Evergreen',      24, '{"emoji":"🎄"}', 22),
  ('lotus',          'plant',     'Lotus',          25, '{"emoji":"🪷"}', 23),
  ('top_hat',        'accessory', 'Top Hat',        26, '{"emoji":"🎩"}', 24),
  ('grape_arbor',    'tree',      'Grape Arbor',    28, '{"emoji":"🍇"}', 25),
  ('galaxy_theme',   'theme',     'Galaxy Theme',   30, '{"emoji":"🌌"}', 26)
on conflict (id) do nothing;

-- ============ achievements ============
insert into public.achievement_catalog(id, name, hint, xp, sort) values
  ('streak_14',     'Fortnight of focus',   'Study 14 days in a row',           120,  13),
  ('task_50',       'Task master',          'Complete 50 tasks',                120,  14),
  ('ultra_day',     'Ultra day',            '5 hours of focus in one day',      150,  15),
  ('squad_scholar', 'Squad scholar',        'Finish 10 sessions in group rooms', 100, 16),
  ('total_100h',    'Triple digits',        '100 hours of total focus',         250,  17),
  ('sessions_100',  'Session centurion',    'Complete 100 focus sessions',      150,  18),
  ('task_100',      'Checklist champion',   'Complete 100 tasks',               200,  19),
  ('total_250h',    'Scholar in residence', '250 hours of total focus',         500,  20),
  ('sessions_500',  'Marathon mind',        'Complete 500 focus sessions',      500,  21),
  ('streak_100',    'Centurion',            'Study 100 days in a row',          1000, 22)
on conflict (id) do nothing;

-- ============ sync: recompute & award (idempotent) ============
-- Same body as release_11 plus v_room_sessions and the new award conditions.
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

  select count(*) into v_sessions from public.study_session_events where user_id = v_user;
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
      ('streak_30',      v_streak >= 30),
      ('streak_14',      v_streak >= 14),
      ('task_50',        v_done_tasks >= 50),
      ('ultra_day',      v_best_day >= 300),
      ('squad_scholar',  v_room_sessions >= 10),
      ('total_100h',     v_total_min >= 6000),
      ('sessions_100',   v_sessions >= 100),
      ('task_100',       v_done_tasks >= 100),
      ('total_250h',     v_total_min >= 15000),
      ('sessions_500',   v_sessions >= 500),
      ('streak_100',     v_streak >= 100)
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

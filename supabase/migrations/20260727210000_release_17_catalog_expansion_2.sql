-- Release 17: catalog expansion 2 — grouped achievements + a lot more rewards.
--
-- Adds 19 achievements (new tiers across focus time, session counts, streaks,
-- tasks and group study) and 29 level rewards extending the level curve to 60.
-- The expansion is weighted toward ACCESSORIES, which are the rewards that
-- visibly change the pet stage; every one reuses an existing slot so the canvas
-- needs no new code.
--
-- Achievement CATEGORIES live only in src/petCatalog.ts. They are presentation
-- only and are resolved client-side by id, so there is deliberately no category
-- column here — the server contract is unchanged.
--
-- sync_my_gamification() is recreated (base: release_16, which added per-plant
-- growth) with the award conditions for the new achievements. Mirror of
-- src/petCatalog.ts — keep the two in sync.

-- ============ level rewards ============
insert into public.reward_catalog(id, kind, name, unlock_level, meta, sort) values
  ('reading_glasses',  'accessory', 'Reading Glasses',  23, '{"emoji":"👓","slot":"face"}',  28),
  ('yarn_ball',        'accessory', 'Ball of Yarn',     27, '{"emoji":"🧶","slot":"toy"}',   29),
  ('straw_hat',        'accessory', 'Straw Hat',        29, '{"emoji":"👒","slot":"hat"}',   30),
  ('lavender',         'plant',     'Lavender',         31, '{"emoji":"🪻"}',                31),
  ('frisbee',          'accessory', 'Frisbee',          32, '{"emoji":"🥏","slot":"toy"}',   32),
  ('palm_grove',       'tree',      'Palm Grove',       33, '{"emoji":"🏝️"}',               33),
  ('milk_bowl',        'accessory', 'Milk Bowl',        34, '{"emoji":"🥛","slot":"bowl"}',  34),
  ('graduation_cap',   'accessory', 'Graduation Cap',   35, '{"emoji":"🎓","slot":"hat"}',   35),
  ('goggles',          'accessory', 'Lab Goggles',      36, '{"emoji":"🥽","slot":"face"}',  36),
  ('teddy',            'accessory', 'Teddy Bear',       37, '{"emoji":"🧸","slot":"toy"}',   37),
  ('tulip',            'plant',     'Tulip',            38, '{"emoji":"🌷"}',                38),
  ('cookie_jar',       'accessory', 'Cookie Jar',       39, '{"emoji":"🍪","slot":"bowl"}',  39),
  ('sunset_theme',     'theme',     'Sunset Theme',     40, '{"emoji":"🌅"}',                40),
  ('adventure_helmet', 'accessory', 'Adventure Helmet', 41, '{"emoji":"🪖","slot":"hat"}',   41),
  ('bubbles',          'accessory', 'Bubble Wand',      42, '{"emoji":"🫧","slot":"toy"}',   42),
  ('orchid',           'plant',     'Orchid',           43, '{"emoji":"🌼"}',                43),
  ('theatre_mask',     'accessory', 'Theatre Mask',     44, '{"emoji":"🎭","slot":"face"}',  44),
  ('toy_rocket',       'accessory', 'Toy Rocket',       45, '{"emoji":"🚀","slot":"toy"}',   45),
  ('cloud_bed',        'accessory', 'Cloud Bed',        46, '{"emoji":"☁️","slot":"bed"}',   46),
  ('honey_pot',        'accessory', 'Honey Pot',        47, '{"emoji":"🍯","slot":"bowl"}',  47),
  ('apple_tree',       'tree',      'Apple Tree',       48, '{"emoji":"🍎"}',                48),
  ('flower_crown',     'accessory', 'Flower Crown',     49, '{"emoji":"💐","slot":"hat"}',   49),
  ('ocean_theme',      'theme',     'Ocean Theme',      50, '{"emoji":"🌊"}',                50),
  ('rose',             'plant',     'Rose',             52, '{"emoji":"🌹"}',                51),
  ('autumn_maple',     'tree',      'Autumn Maple',     54, '{"emoji":"🍂"}',                52),
  ('treat_jar',        'accessory', 'Treat Jar',        55, '{"emoji":"🫙","slot":"bowl"}',  53),
  ('party_hat',        'accessory', 'Party Hat',        56, '{"emoji":"🎉","slot":"hat"}',   54),
  ('desert_theme',     'theme',     'Desert Theme',     58, '{"emoji":"🏜️"}',               55),
  ('star_plush',       'accessory', 'Star Plush',       60, '{"emoji":"⭐","slot":"toy"}',    56)
on conflict (id) do nothing;

-- ============ achievements ============
-- Existing rows are renumbered so each category occupies its own sort band
-- (focus 1-14, sessions 20-26, streaks 30-38, tasks 40-45, social 50-54),
-- matching ACHIEVEMENT_CATALOG. Sort is the tiebreak inside a category.
update public.achievement_catalog set sort = 3  where id = 'century_day';
update public.achievement_catalog set sort = 4  where id = 'deep_day';
update public.achievement_catalog set sort = 5  where id = 'ultra_day';
update public.achievement_catalog set sort = 8  where id = 'total_10h';
update public.achievement_catalog set sort = 9  where id = 'total_25h';
update public.achievement_catalog set sort = 10 where id = 'total_50h';
update public.achievement_catalog set sort = 11 where id = 'total_100h';
update public.achievement_catalog set sort = 12 where id = 'total_250h';
update public.achievement_catalog set sort = 22 where id = 'sessions_50';
update public.achievement_catalog set sort = 23 where id = 'sessions_100';
update public.achievement_catalog set sort = 25 where id = 'sessions_500';
update public.achievement_catalog set sort = 30 where id = 'streak_3';
update public.achievement_catalog set sort = 31 where id = 'streak_7';
update public.achievement_catalog set sort = 32 where id = 'streak_14';
update public.achievement_catalog set sort = 34 where id = 'streak_30';
update public.achievement_catalog set sort = 36 where id = 'streak_100';
update public.achievement_catalog set sort = 40 where id = 'task_finisher';
update public.achievement_catalog set sort = 42 where id = 'task_50';
update public.achievement_catalog set sort = 43 where id = 'task_100';
update public.achievement_catalog set sort = 50 where id = 'social_studier';
update public.achievement_catalog set sort = 51 where id = 'squad_scholar';

insert into public.achievement_catalog(id, name, hint, xp, sort) values
  ('half_century_day', 'Half-century day',   '50 focus minutes in a day',          20,   2),
  ('marathon_day',     'Marathon day',       '8 hours of focus in one day',        300,  6),
  ('total_5h',         'Five hours deep',    '5 hours of total focus',             30,   7),
  ('total_500h',       'Devoted scholar',    '500 hours of total focus',           800,  13),
  ('total_1000h',      'Thousand-hour club', '1,000 hours of total focus',         1500, 14),
  ('sessions_10',      'Getting started',    'Complete 10 focus sessions',         30,   20),
  ('sessions_25',      'Quarter century',    'Complete 25 focus sessions',         50,   21),
  ('sessions_250',     'Session veteran',    'Complete 250 focus sessions',        300,  24),
  ('sessions_1000',    'Thousand sessions',  'Complete 1,000 focus sessions',      1000, 26),
  ('streak_21',        'Habit formed',       'Study 21 days in a row',             200,  33),
  ('streak_60',        'Two-month streak',   'Study 60 days in a row',             500,  35),
  ('streak_180',       'Half-year habit',    'Study 180 days in a row',            1500, 37),
  ('streak_365',       'Year of focus',      'Study 365 days in a row',            3000, 38),
  ('task_25',          'Getting things done','Complete 25 tasks',                  80,   41),
  ('task_250',         'Task titan',         'Complete 250 tasks',                 350,  44),
  ('task_500',         'Completionist',      'Complete 500 tasks',                 600,  45),
  ('squad_25',         'Study circle',       'Finish 25 sessions in group rooms',  200,  52),
  ('squad_50',         'Room regular',       'Finish 50 sessions in group rooms',  350,  53),
  ('squad_100',        'Community pillar',   'Finish 100 sessions in group rooms', 600,  54)
on conflict (id) do nothing;

-- ============ sync function ============
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
  update public.user_rewards ur set growth_points = greatest(0, v_sessions - ur.planted_at_sessions)
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

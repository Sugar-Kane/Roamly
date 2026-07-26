-- Release 16: the garden becomes its own place.
--
-- Plants and trees are no longer one-at-a-time — the app now lets you plant as
-- many as you own — so growth has to be per-plant rather than "whatever the
-- single active plant is". Two pieces:
--   1. planted_at_sessions records your session count at the moment a reward is
--      planted; growth_points becomes (sessions since then).
--   2. A trigger stamps that baseline server-side, because clients may only
--      update is_active (see the release_11 column grant) and must not be
--      trusted to backdate their own growth.

alter table public.user_rewards
  add column if not exists planted_at_sessions int not null default 0;

-- Stamp the baseline whenever a reward is newly planted (false -> true).
create or replace function public.stamp_planted_baseline()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_active and not coalesce(old.is_active, false) then
    new.planted_at_sessions := coalesce(
      (select gs.sessions_completed from public.gamification_state gs where gs.user_id = new.user_id), 0);
  end if;
  return new;
end;
$$;

drop trigger if exists user_rewards_stamp_planted on public.user_rewards;
create trigger user_rewards_stamp_planted
  before update of is_active on public.user_rewards
  for each row execute function public.stamp_planted_baseline();

-- ============ sync: same body, per-plant growth ============
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

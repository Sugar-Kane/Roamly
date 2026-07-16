-- Theme preference persistence: the chosen theme previously lived only in
-- component state, so it reverted to the default on every page load. Guests
-- now keep it in localStorage; signed-in users also save it to their profile
-- so the pick follows them across devices.
--
-- theme is non-sensitive and validated client-side against the THEMES list,
-- so unlike display_name it can safely join the small set of directly
-- client-writable profile columns (daily_goal_minutes, exam_date, exam_name).
-- The length check bounds junk writes; unknown ids simply fall back to the
-- default at render time.

alter table public.profiles
  add column if not exists theme text
  check (theme is null or char_length(theme) between 1 and 24);

grant update (theme) on public.profiles to authenticated;

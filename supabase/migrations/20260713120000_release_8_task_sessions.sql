-- Release 8 — task session estimates
--
-- New tasks default to 1 focus session (done in a single Pomodoro); users opt
-- in to multi-session estimates per task. The client also sends est explicitly
-- on insert, so this default only matters for inserts from older clients.
alter table public.tasks alter column est set default 1;

-- Adds user-controlled task ordering, used by the Tasks page reorder arrows.
-- Run once in Supabase Dashboard → SQL Editor → New query (or applied via MCP).
--
-- The app is resilient to this column being absent (it falls back to
-- session-only ordering), so this can be applied before or after the code
-- deploy — but ordering only persists once it exists.

alter table public.tasks add column if not exists sort_order int;

-- Initialize existing rows to their current visual order (oldest first).
update public.tasks t set sort_order = sub.rn
  from (select id, row_number() over (partition by user_id order by created_at) as rn
          from public.tasks) sub
 where t.id = sub.id and t.sort_order is null;

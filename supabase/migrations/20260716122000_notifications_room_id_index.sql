-- Index notifications.room_id (2026-07-16).
--
-- notifications.room_id references rooms(id) ON DELETE SET NULL, but the table
-- was indexed only on (user_id, created_at). Rooms are reaped aggressively —
-- reap_stale_rooms() runs via pg_cron every minute plus best-effort on lobby
-- loads — and each room deletion has to null out room_id on matching
-- notification rows. Without this index that's a sequential scan of the whole
-- notifications table on every reap, growing costlier as the table does.
-- Partial (room_id is not null) since the column is null for most rows.

create index if not exists notifications_room_id_idx
  on public.notifications (room_id)
  where room_id is not null;

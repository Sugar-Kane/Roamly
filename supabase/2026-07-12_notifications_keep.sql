-- ============================================================================
-- 2026-07-12 — Room notifications survive room deletion (applied to prod)
--
-- notifications.room_id cascaded on room delete, so when a hosted room was
-- reaped (~60s after emptying) every room_invite/room_joined notification for
-- it was silently deleted — invitees "never received" invites. Keep the
-- notification, null the room reference instead.
-- ============================================================================

alter table public.notifications
  drop constraint if exists notifications_room_id_fkey;
alter table public.notifications
  add constraint notifications_room_id_fkey
  foreign key (room_id) references public.rooms(id) on delete set null;

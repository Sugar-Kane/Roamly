create policy "room_voice_read"
on realtime.messages
for select
to authenticated
using (
  extension in ('presence', 'broadcast')
  and (select realtime.topic()) ~ '^room-voice:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (select public.can_access_room(split_part((select realtime.topic()), ':', 2)::uuid))
);

create policy "room_voice_write"
on realtime.messages
for insert
to authenticated
with check (
  extension in ('presence', 'broadcast')
  and (select realtime.topic()) ~ '^room-voice:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and (select public.can_access_room(split_part((select realtime.topic()), ':', 2)::uuid))
);

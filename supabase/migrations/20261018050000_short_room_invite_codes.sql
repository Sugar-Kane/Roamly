-- Private-room invite codes: 6 characters instead of 10, so they're easy to
-- read out and type on a phone.
--
-- Alphabet: A-Z and 2-9 without the look-alikes 0/O and 1/I (32 symbols), so
-- a code read aloud or copied by hand can't be mistyped into another one.
-- 32^6 ≈ 1.07 billion codes keeps a private room unguessable (6 plain digits
-- would be only a million). Randomness comes from gen_random_uuid() (122
-- random bits from the CSPRNG), one byte per character; 256 is a multiple of
-- 32, so `byte % 32` is unbiased.
--
-- Codes stay unique (rooms_invite_code_uidx); on the rare collision we draw
-- again. Existing rooms keep their current codes, so codes already shared
-- keep working; join_room_by_code matches whatever is stored.

create or replace function public.generate_room_invite_code()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  raw bytea;
  code text;
begin
  loop
    raw := uuid_send(gen_random_uuid());
    code := '';
    for i in 0..5 loop
      code := code || substr(alphabet, (get_byte(raw, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.rooms where invite_code = code);
  end loop;
  return code;
end;
$$;

revoke execute on function public.generate_room_invite_code() from public, anon, authenticated;

create or replace function public.prepare_room_access()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.visibility = 'private' and new.invite_code is null then
    new.invite_code := public.generate_room_invite_code();
  elsif new.visibility = 'public' then
    new.invite_code := null;
  end if;
  return new;
end;
$$;

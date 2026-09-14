-- Group recurring endpoint failures into ONE incident instead of one per route.
--
-- sh_fingerprint hashed p_route into the identity of every incident. For a
-- network_error the failing endpoint IS the identity — the title already names
-- it — so hashing the route in as well split a single recurring failure of
-- /rest/v1/rpc/room_occupancy into separate incidents on /focus, /tasks and
-- /admin. That produced five incidents for one cause between 2026-07-28 and
-- 2026-09-14, each diagnosed from scratch, and hid the fact that it was
-- recurring at all.
--
-- Only network_error changes. Every other kind keeps route in the fingerprint,
-- where it genuinely is part of the identity (a dead click or an empty render
-- on /focus is a different bug from the same symptom on /admin).
--
-- Idempotent: create-or-replace, safe to re-run.
--
-- Note on effect: fingerprints for network_error change, so currently-open
-- incidents of that kind will not match new events and one fresh incident per
-- endpoint will open. That is a one-time re-baseline, not data loss — the old
-- rows keep their history. No index depends on this function (checked: the
-- unique index sh_incidents_open_fingerprint is on the stored column, not on
-- a call to sh_fingerprint), so replacing it cannot corrupt an index.

create or replace function public.sh_fingerprint(
  p_kind text, p_message text, p_route text, p_component text
) returns text
language sql
immutable
set search_path to 'public'
as $function$
  select md5(
    coalesce(p_kind,'') || chr(31) ||
    public.sh_normalise(p_message) || chr(31) ||
    case when p_kind = 'network_error' then '' else coalesce(p_route,'') end || chr(31) ||
    coalesce(p_component,'')
  );
$function$;

-- Account settings overhaul: let a user edit their own display name.
--
-- display_name is deliberately excluded from the authenticated UPDATE grant on
-- public.profiles (see schema.sql: only daily_goal_minutes/exam_date/exam_name
-- are client-writable). Until now it was only ever set as a side effect of
-- set_username(). The new Account panel needs a first-class way to change the
-- display name without changing the username, so we add a validating,
-- SECURITY DEFINER RPC — the same sanctioned-window pattern used by
-- set_username() and set_stats_public().
--
-- Validation: 1–40 characters after trimming, and no control characters. The
-- client trims before sending; we trim again here so the stored value is
-- always clean regardless of caller. An empty result is rejected rather than
-- silently clearing the name.

create or replace function public.set_display_name(p_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean text := btrim(coalesce(p_name, ''));
begin
  -- Reject control characters (newlines, tabs, etc.) outright.
  if v_clean ~ '[\x00-\x1f\x7f]' then
    raise exception 'invalid_display_name';
  end if;
  if char_length(v_clean) < 1 or char_length(v_clean) > 40 then
    raise exception 'invalid_display_name';
  end if;
  update public.profiles
     set display_name = v_clean,
         updated_at = now()
   where id = (select auth.uid());
  return v_clean;
end;
$$;

revoke execute on function public.set_display_name(text) from public, anon;
grant execute on function public.set_display_name(text) to authenticated;

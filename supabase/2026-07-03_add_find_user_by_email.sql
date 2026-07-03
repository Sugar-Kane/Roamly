-- Adds exact-email friend lookup, used by the Friends modal ("add by email").
-- Run once in Supabase Dashboard → SQL Editor → New query.
--
-- Privacy: signed-in users only; exact (case-insensitive) match on a fully
-- typed email — no partial/prefix search, so the address book can't be
-- enumerated; returns only the public fields (id/username/display_name),
-- never the email itself.

create or replace function public.find_user_by_email(p_email text)
returns table (id uuid, username text, display_name text)
language sql
security definer
set search_path = public
as $$
  select id, username, display_name
    from public.profiles
   where auth.uid() is not null
     and id <> auth.uid()
     and lower(email) = lower(trim(p_email));
$$;

revoke execute on function public.find_user_by_email(text) from public, anon;
grant execute on function public.find_user_by_email(text) to authenticated;

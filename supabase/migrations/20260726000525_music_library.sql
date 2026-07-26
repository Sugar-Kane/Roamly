-- Focus-music library: a real catalog, admin-managed (2026-07-25).
--
-- Until now the only real recordings were 43 MP3s committed under
-- public/audio/lofi with a hand-edited manifest.json, split across two of the
-- seven channels. That meant ~500MB in git, a redeploy to add a single track,
-- and no way for an admin to see or change what's playing.
--
-- This moves the catalog into the database:
--   * `music_tracks` — one row per track, keyed to a channel id that matches
--     FocusSoundId in src/focusSounds.ts. `url` is either a repo-relative path
--     (the existing bundled tracks, still served by Vercel) or an absolute
--     Storage URL (anything uploaded from here on), so both live side by side
--     and the player doesn't care which is which.
--   * `focus-music` bucket — public READ (an <audio> element streams it
--     directly, same as the bundled files already are), admin-only WRITE.
--
-- Security: reads are open to anon+authenticated but only for active rows —
-- the catalog is not secret, it's what every visitor's player fetches. Every
-- write goes through a SECURITY DEFINER, is_admin()-gated RPC, matching the
-- pattern used by the rest of the admin surface.

create table if not exists public.music_tracks (
  id uuid primary key default gen_random_uuid(),
  -- Matches FocusSoundId. Not a FK — the channel list lives in the frontend,
  -- and a check constraint keeps typos out without a second table to sync.
  channel text not null check (channel in ('melody','lofi','calm','beats','piano','ambient','rain')),
  title text not null check (char_length(title) between 1 and 200),
  artist text not null default 'Unknown' check (char_length(artist) <= 200),
  -- "/audio/lofi/x.mp3" for bundled, or an absolute https:// Storage URL.
  url text not null check (char_length(url) between 1 and 1000),
  license text not null default 'All rights reserved' check (char_length(license) <= 200),
  -- 'bundled' = shipped in the repo, 'upload' = admin-uploaded to Storage.
  -- Deleting an 'upload' row also removes its Storage object; 'bundled' rows
  -- have no object to remove.
  source text not null default 'upload' check (source in ('bundled','upload')),
  duration_seconds int check (duration_seconds is null or duration_seconds > 0),
  -- Soft disable: hide a track from the player without losing the row or the
  -- file, so a bad upload can be pulled instantly and restored later.
  active boolean not null default true,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The player's hot query is "all active tracks for one channel".
create index if not exists music_tracks_channel_active_idx
  on public.music_tracks (channel) where active;

-- One row per file per channel: makes the seed below and the fetch-music
-- workflow safely re-runnable instead of duplicating the catalog each time.
create unique index if not exists music_tracks_channel_url_key
  on public.music_tracks (channel, url);

alter table public.music_tracks enable row level security;

-- Public read of the ACTIVE catalog only. Inactive rows are admin-only and
-- reachable through admin_list_music_tracks.
drop policy if exists "music_tracks_read_active" on public.music_tracks;
create policy "music_tracks_read_active"
on public.music_tracks for select to anon, authenticated
using (active);

-- No client writes at all — the admin RPCs below are the only way in.
revoke insert, update, delete on table public.music_tracks from anon, authenticated;
grant select on table public.music_tracks to anon, authenticated;
grant select, insert, update, delete on table public.music_tracks to service_role;

-- ---------------------------------------------------------------------------
-- Storage bucket
-- ---------------------------------------------------------------------------
-- Public read so <audio src> works without signing (the bundled tracks are
-- already public static files; this keeps behaviour identical). 60MB ceiling
-- and an audio-only MIME allowlist so the upload form can't be used to serve
-- arbitrary files from our origin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'focus-music',
  'focus-music',
  true,
  62914560,
  array['audio/mpeg','audio/mp3','audio/ogg','audio/wav','audio/x-wav','audio/mp4','audio/aac','audio/webm']
)
on conflict (id) do update set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Only admins may add or remove audio. Reads are covered by the bucket being
-- public, so there's no select policy to write here.
drop policy if exists "focus_music_admin_insert" on storage.objects;
drop policy if exists "focus_music_admin_update" on storage.objects;
drop policy if exists "focus_music_admin_delete" on storage.objects;

create policy "focus_music_admin_insert"
on storage.objects for insert to authenticated
with check (bucket_id = 'focus-music' and public.is_admin());

create policy "focus_music_admin_update"
on storage.objects for update to authenticated
using (bucket_id = 'focus-music' and public.is_admin())
with check (bucket_id = 'focus-music' and public.is_admin());

create policy "focus_music_admin_delete"
on storage.objects for delete to authenticated
using (bucket_id = 'focus-music' and public.is_admin());

-- Restrictive guard: ANDed with every permissive policy, so a legacy or
-- future dashboard policy can't accidentally open writes to this bucket.
-- Other buckets are unaffected.
drop policy if exists "focus_music_restrict_write" on storage.objects;
create policy "focus_music_restrict_write"
on storage.objects as restrictive for insert to authenticated
with check (bucket_id <> 'focus-music' or public.is_admin());

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------

-- Full catalog including inactive rows, plus a per-channel count the admin UI
-- uses for its channel headers.
create or replace function public.admin_list_music_tracks()
returns table (
  id uuid, channel text, title text, artist text, url text, license text,
  source text, duration_seconds int, active boolean, created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select t.id, t.channel, t.title, t.artist, t.url, t.license,
         t.source, t.duration_seconds, t.active, t.created_at
  from public.music_tracks t
  where public.is_admin()
  order by t.channel, t.created_at desc;
$$;

create or replace function public.admin_add_music_track(
  p_channel text,
  p_title text,
  p_url text,
  p_artist text default 'Unknown',
  p_license text default 'All rights reserved',
  p_source text default 'upload',
  p_duration_seconds int default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  insert into public.music_tracks (channel, title, url, artist, license, source, duration_seconds, uploaded_by)
  values (p_channel, p_title, p_url, coalesce(p_artist, 'Unknown'),
          coalesce(p_license, 'All rights reserved'), coalesce(p_source, 'upload'),
          p_duration_seconds, auth.uid())
  -- Re-uploading the same URL to the same channel refreshes the metadata and
  -- re-activates it rather than failing on the unique index.
  on conflict (channel, url) do update set
    title = excluded.title,
    artist = excluded.artist,
    license = excluded.license,
    duration_seconds = coalesce(excluded.duration_seconds, public.music_tracks.duration_seconds),
    active = true
  returning id into v_id;

  return v_id;
end;
$$;

-- Rename / re-credit / move channel / enable-disable in one call. Null means
-- "leave alone", so the UI can send just the field that changed.
create or replace function public.admin_update_music_track(
  p_id uuid,
  p_title text default null,
  p_artist text default null,
  p_channel text default null,
  p_active boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  update public.music_tracks set
    title = coalesce(p_title, title),
    artist = coalesce(p_artist, artist),
    channel = coalesce(p_channel, channel),
    active = coalesce(p_active, active)
  where id = p_id;
end;
$$;

-- Returns the Storage object path to delete (null for bundled tracks), so the
-- client can clean up the file after the row is gone. Doing the object delete
-- client-side keeps this function free of the storage extension dependency.
create or replace function public.admin_delete_music_track(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_source text;
begin
  if not public.is_admin() then
    raise exception 'not authorized';
  end if;

  delete from public.music_tracks where id = p_id
  returning url, source into v_url, v_source;

  -- `is distinct from` (not <>) so a no-op delete, where v_source comes back
  -- null, returns null instead of null-propagating into the substring below.
  if v_source is distinct from 'upload' then
    return null;
  end if;

  -- Everything after ".../focus-music/" is the object path.
  return substring(v_url from '/focus-music/(.*)$');
end;
$$;

revoke all on function public.admin_list_music_tracks() from public, anon;
revoke all on function public.admin_add_music_track(text, text, text, text, text, text, int) from public, anon;
revoke all on function public.admin_update_music_track(uuid, text, text, text, boolean) from public, anon;
revoke all on function public.admin_delete_music_track(uuid) from public, anon;

grant execute on function public.admin_list_music_tracks() to authenticated;
grant execute on function public.admin_add_music_track(text, text, text, text, text, text, int) to authenticated;
grant execute on function public.admin_update_music_track(uuid, text, text, text, boolean) to authenticated;
grant execute on function public.admin_delete_music_track(uuid) to authenticated;

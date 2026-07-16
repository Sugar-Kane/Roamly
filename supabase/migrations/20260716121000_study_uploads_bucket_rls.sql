-- Lock down the study-uploads bucket (2026-07-16).
--
-- Clients upload lecture material directly with the anon key, and
-- api/generate-tasks re-checks that the path is under `${auth.uid()}/` before
-- signing it — but that server check only protects the read it performs. The
-- direct-upload/read surface is governed entirely by storage RLS, and that
-- config lived only in the dashboard, never in the repo. This commits it:
-- the bucket is PRIVATE and every object op is owner-folder scoped, so one
-- user can't read or write another user's uploaded notes with the client key.
--
-- The bucket already exists in production, so ON CONFLICT only forces the
-- security-critical `public = false` and leaves any intentional prod tuning of
-- size/mime in place; a fresh project gets sensible defaults matching the
-- server-side validation in api/generate-tasks.ts (12MB, same media types).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'study-uploads',
  'study-uploads',
  false,
  12582912,
  array[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'text/plain', 'text/markdown', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do update set public = false;

-- Owner-folder-scoped object policies. Dropped first so this migration is
-- idempotent whether or not equivalent dashboard policies already exist.
drop policy if exists "study_uploads_insert_own" on storage.objects;
drop policy if exists "study_uploads_select_own" on storage.objects;
drop policy if exists "study_uploads_update_own" on storage.objects;
drop policy if exists "study_uploads_delete_own" on storage.objects;

create policy "study_uploads_insert_own"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'study-uploads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "study_uploads_select_own"
on storage.objects for select to authenticated
using (
  bucket_id = 'study-uploads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "study_uploads_update_own"
on storage.objects for update to authenticated
using (
  bucket_id = 'study-uploads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'study-uploads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "study_uploads_delete_own"
on storage.objects for delete to authenticated
using (
  bucket_id = 'study-uploads'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

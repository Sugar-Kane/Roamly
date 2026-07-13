-- Release 7: advertiser submissions.
--   Non-premium users see a break-time prompt to advertise on Roamly (TikTok
--   shorts, Instagram reels, business videos, or image billboards). Submissions
--   land in this table and surface in the admin portal for review. Advertisers
--   provide a URL to their creative (that's how those assets already exist), so
--   no storage bucket is needed. Email notification is deferred (admin portal is
--   the notification surface for now).
-- Safe to run more than once.

create table if not exists public.ad_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  ad_type text not null check (ad_type in ('tiktok', 'reel', 'business_video', 'image_billboard')),
  business_name text not null check (char_length(business_name) between 1 and 120),
  target_url text not null check (char_length(target_url) between 5 and 600),
  contact_email text not null check (char_length(contact_email) between 3 and 160),
  plan text not null check (plan in ('image_weekly', 'short_video_weekly', 'business_video_weekly')),
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'approved', 'rejected', 'live', 'ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_submissions_created on public.ad_submissions (created_at desc);
create index if not exists ad_submissions_status on public.ad_submissions (status);

alter table public.ad_submissions enable row level security;

-- Insert-own only. Like feedback, clients can never read anyone's rows (admins
-- read through the SECURITY DEFINER reader below); no select/update/delete
-- policy is granted to authenticated.
drop policy if exists "ad_submissions_insert_own" on public.ad_submissions;
create policy "ad_submissions_insert_own"
  on public.ad_submissions for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Abuse guard: silently drop (not error) past 10 submissions per user per day.
create or replace function public.enforce_ad_submission_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.ad_submissions s
       where s.user_id = new.user_id
         and s.created_at > now() - interval '1 day') >= 10 then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists ad_submissions_limit on public.ad_submissions;
create trigger ad_submissions_limit
  before insert on public.ad_submissions
  for each row execute function public.enforce_ad_submission_limit();

-- ============ admin readers / actions (is_admin()-gated) ============
create or replace function public.admin_list_ad_submissions(p_limit int default 100)
returns table (
  id uuid, email text, username text, ad_type text, business_name text,
  target_url text, contact_email text, plan text, note text, status text,
  created_at timestamptz, updated_at timestamptz
)
language sql
security definer
set search_path = ''
stable
as $$
  select s.id, p.email, p.username, s.ad_type, s.business_name, s.target_url,
         s.contact_email, s.plan, s.note, s.status, s.created_at, s.updated_at
    from public.ad_submissions s
    left join public.profiles p on p.id = s.user_id
   where public.is_admin()
   order by s.created_at desc
   limit greatest(1, least(p_limit, 300));
$$;

create or replace function public.admin_set_ad_submission_status(p_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized';
  end if;
  if p_status not in ('new', 'reviewing', 'approved', 'rejected', 'live', 'ended') then
    raise exception 'invalid_status';
  end if;
  update public.ad_submissions
     set status = p_status, updated_at = now()
   where id = p_id;
end;
$$;

create or replace function public.admin_delete_ad_submission(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'not_authorized';
  end if;
  delete from public.ad_submissions where id = p_id;
end;
$$;

revoke execute on function public.admin_list_ad_submissions(int) from public, anon;
revoke execute on function public.admin_set_ad_submission_status(uuid, text) from public, anon;
revoke execute on function public.admin_delete_ad_submission(uuid) from public, anon;
grant execute on function public.admin_list_ad_submissions(int) to authenticated;
grant execute on function public.admin_set_ad_submission_status(uuid, text) to authenticated;
grant execute on function public.admin_delete_ad_submission(uuid) to authenticated;

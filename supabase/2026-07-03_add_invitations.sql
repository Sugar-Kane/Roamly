-- Email invitations: audit + rate-limit table for the "invite by email" flow.
-- Run once in Supabase Dashboard → SQL Editor → New query.
--
-- Only the api/invite serverless function (service role) writes here; no client
-- RLS policies are added, so clients can't read or write it directly.

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references auth.users (id) on delete cascade,
  email text not null,
  invited_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists invitations_inviter_created
  on public.invitations (inviter_id, created_at desc);

alter table public.invitations enable row level security;

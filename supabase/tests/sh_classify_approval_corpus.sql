-- Corpus test for public.sh_classify_approval().
--
-- This is the single most important control in the self-healing platform: it
-- decides whether a machine-authored change may be auto-deployed, may open a
-- pull request, or must be written/reviewed by an engineer. Everything else —
-- the trigger, the CI gate, the dashboard banner — is downstream of it.
--
-- Run it in the SQL editor after ANY change to the classifier, and after
-- adding a new money/auth/data surface to the codebase. It prints one row per
-- case; every `result` must read PASS.
--
--   psql> \i supabase/tests/sh_classify_approval_corpus.sql
--
-- The first run of this corpus earned its keep immediately: it caught that a
-- diff changing premium GATING classified as pr_only rather than manual. The
-- keyword list covered the payment rails but not entitlement logic, so
-- automation could have opened a mergeable PR that gave the product away.
--
-- When adding a case, prefer realistic diffs over synthetic ones, and always
-- add a negative case alongside a positive one — a classifier that returns
-- 'manual' for everything passes every positive test and is useless.

with corpus(label, expected, files, diff) as (values
  -- --- Level 3: must never be merged by automation ------------------------
  ('stripe webhook',            'manual',  '["api/stripe-webhook.ts"]'::jsonb, 'if (event.type === "invoice.paid") grantPremium();'),
  ('RLS policy',                'manual',  '["supabase/migrations/x.sql"]'::jsonb, 'create policy "p" on tasks for select using (auth.uid() = user_id);'),
  ('auth component',            'manual',  '["src/Auth.tsx"]'::jsonb, 'const s = await supabase.auth.signIn();'),
  ('premium gating',            'manual',  '["src/LockedFeaturePreview.tsx"]'::jsonb, 'if (profile.is_premium) return children;'),
  ('ai credits quota',          'manual',  '["src/UploadTasks.tsx"]'::jsonb, 'if (profile.ai_credits > 0) allow();'),
  ('account deletion',          'manual',  '["api/delete-account.ts"]'::jsonb, 'await admin.auth.admin.deleteUser(id);'),
  ('admin endpoint',            'manual',  '["api/admin-revenue.ts"]'::jsonb, 'const rows = await admin.from("profiles").select();'),
  ('email sending',             'manual',  '["api/invite.ts"]'::jsonb, 'await resend.emails.send({ to });'),
  -- The file looks innocuous; the DIFF is what gives it away.
  ('stripe hidden in diff',     'manual',  '["src/App.tsx"]'::jsonb, '+ const p = STRIPE_PRICE_ID;'),
  -- Any attached migration forces manual regardless of content.
  ('schema migration attached', 'manual',  '["src/App.tsx"]'::jsonb, 'alter table tasks add column x int;'),

  -- --- Level 2: functional frontend, PR for a human to merge ---------------
  ('ordinary frontend logic',   'pr_only', '["src/FocusMode.tsx"]'::jsonb, 'const onClick = () => setRunning(true);'),
  ('garden render fix',         'pr_only', '["src/GardenBed.tsx"]'::jsonb, 'for (let i = 0; i < rows; i++) draw(i);'),
  -- A cosmetic FILE with a code-shaped diff is not cosmetic.
  ('css file, JS-ish diff',     'pr_only', '["src/index.css"]'::jsonb, '+ const x = () => 1;'),
  -- Negative control: 'gate' is a substring of navigate/aggregate. If this
  -- ever returns 'manual', someone has added an over-broad keyword and most
  -- routine work is now blocked on human review.
  ('navigate is not gate',      'pr_only', '["src/App.tsx"]'::jsonb, 'navigate("/focus"); aggregate(rows);'),

  -- --- Level 1: cosmetic only, may self-deploy -----------------------------
  ('css only',                  'auto',    '["src/index.css"]'::jsonb, '+ .task-row { padding: 8px; }'),
  ('image asset',               'auto',    '["public/hero.png"]'::jsonb, 'binary')
)
select
  label,
  expected,
  public.sh_classify_approval(files, diff)::text as actual,
  case when public.sh_classify_approval(files, diff)::text = expected
       then 'PASS' else '*** FAIL ***' end as result
from corpus
order by case expected when 'manual' then 1 when 'pr_only' then 2 else 3 end, label;

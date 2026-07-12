-- ============================================================================
-- 2026-07-10 — Named exams for the countdown (PANCE, EOR, USMLE, COMLEX, …)
-- Idempotent: safe to run more than once.
-- ============================================================================

alter table public.profiles
  add column if not exists exam_name text
    check (exam_name is null or char_length(exam_name) <= 60);

-- Users may update their own exam name alongside the existing editable fields.
grant update (daily_goal_minutes, exam_date, exam_name) on public.profiles to authenticated;

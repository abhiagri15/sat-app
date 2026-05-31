-- 20260531000000_sat_save_failures.sql
-- Diagnostics for the "Couldn't save this attempt" bug.
--
-- The save path (sat.save_attempt via the saveAttempt server action) is a
-- one-shot call whose failure message was previously only console.error'd in
-- the browser — so when a student lost a completed test we had no durable,
-- queryable record of WHY. This table captures every failed save attempt so
-- the root-cause trigger can be confirmed from the data.
--
-- Written best-effort by the saveAttempt server action via the service-role
-- client (so it records even the "not authenticated" failure mode, where the
-- caller has no usable session). RLS is enabled with NO policy: the
-- anon/authenticated role can neither read nor write it directly — same
-- posture as sat.question_flags. Admins query it through the service role.

create table if not exists sat.save_failures (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid,            -- null when auth.uid() was unavailable (the failure itself)
  error_message text,
  error_code    text,            -- coarse classification: see classifyError() in app/lib/persistence/retry.ts
  retryable     boolean,
  attempt_no    int,             -- which retry produced this failure (1 = first try)
  context       jsonb            -- { testLength, totalQuestions, attemptUuid, userAgent }
);

create index if not exists save_failures_created_at_idx
  on sat.save_failures (created_at desc);

alter table sat.save_failures enable row level security;
-- Deliberately policy-less: only the service role (BYPASSRLS) touches it.

-- service_role BYPASSRLS skips row-level security but still needs table privileges
-- (see migration 20260521040000 — the same reason draw_questions writes needed a grant).
grant insert, select on sat.save_failures to service_role;

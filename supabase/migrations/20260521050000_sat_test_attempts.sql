-- Persistence sub-project — submitted-test history + per-question detail.

-- ---- sat.test_attempts: one row per submitted test ----------------------
create table if not exists sat.test_attempts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  created_at        timestamptz not null default now(),
  student_name      text not null,
  test_length       text not null check (test_length in ('short','full')),
  total_correct     int  not null check (total_correct >= 0),
  total_questions   int  not null check (total_questions > 0),
  scaled_score      int  not null check (scaled_score between 400 and 1600),
  section_breakdown jsonb not null   -- [{ name, correct, total }, ...]
);
create index if not exists test_attempts_user_created_idx
  on sat.test_attempts (user_id, created_at desc);

alter table sat.test_attempts enable row level security;

-- A user may read only their own attempts. There is intentionally NO write
-- policy: even though Supabase grants table privileges to `authenticated` on
-- exposed-schema tables, RLS with no write policy denies all writes. The only
-- write path is the save_attempt RPC (security definer -> bypasses RLS).
create policy "test_attempts_select_own" on sat.test_attempts
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---- sat.attempt_responses: one row per question in an attempt ----------
-- Each row snapshots the question AS PRESENTED (choices are shuffled per test;
-- chosen_index is meaningless against the original sat.questions row).
create table if not exists sat.attempt_responses (
  id            uuid primary key default gen_random_uuid(),
  attempt_id    uuid not null references sat.test_attempts (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  section_key   text not null check (section_key in ('rw','math')),
  section_name  text not null,
  position      int  not null check (position >= 0),   -- 0-indexed within section
  question_id   text not null,                         -- original sat.questions / BANK id
  skill         text not null,
  source        text not null check (source in ('seed','ai')),
  passage       text,
  prompt        text not null,
  choices       jsonb not null,                        -- string[] AS PRESENTED
  answer_index  int  not null check (answer_index >= 0),
  explanation   text not null,                         -- snapshot — see spec D4
  chosen_index  int  check (chosen_index >= 0),         -- null = skipped
  is_correct    boolean not null
);
-- (attempt_id, position) serves both the getAttempt filter and its ORDER BY.
create index if not exists attempt_responses_attempt_idx
  on sat.attempt_responses (attempt_id, position);
-- user_id index supports the RLS `using` clause.
create index if not exists attempt_responses_user_idx
  on sat.attempt_responses (user_id);

alter table sat.attempt_responses enable row level security;

create policy "attempt_responses_select_own" on sat.attempt_responses
  for select to authenticated using ((select auth.uid()) = user_id);

-- ---- sat.save_attempt: transactional insert of an attempt + its responses
-- security definer: the tables have no write policy, so this controlled path
-- is the only writer. It sets user_id := auth.uid() itself — the client never
-- supplies it. A plpgsql function is one transaction: the attempt and every
-- response row commit together or not at all (no orphan attempt).
create or replace function sat.save_attempt(p_attempt jsonb, p_responses jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id   uuid;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  -- Defensive: the server action's zod schema already requires a non-empty
  -- responses array; this keeps the RPC safe regardless of its caller.
  if jsonb_array_length(p_responses) = 0 then
    raise exception 'no responses';
  end if;

  insert into sat.test_attempts (
    user_id, student_name, test_length,
    total_correct, total_questions, scaled_score, section_breakdown
  ) values (
    v_user,
    p_attempt ->> 'studentName',
    p_attempt ->> 'testLength',
    (p_attempt ->> 'totalCorrect')::int,
    (p_attempt ->> 'totalQuestions')::int,
    (p_attempt ->> 'scaledScore')::int,
    p_attempt -> 'sectionBreakdown'
  )
  returning id into v_id;

  insert into sat.attempt_responses (
    attempt_id, user_id, section_key, section_name, position,
    question_id, skill, source, passage, prompt, choices,
    answer_index, explanation, chosen_index, is_correct
  )
  select
    v_id, v_user,
    r ->> 'sectionKey',
    r ->> 'sectionName',
    (r ->> 'position')::int,
    r ->> 'questionId',
    r ->> 'skill',
    r ->> 'source',
    r ->> 'passage',
    r ->> 'prompt',
    r -> 'choices',
    (r ->> 'answerIndex')::int,
    r ->> 'explanation',
    (r ->> 'chosenIndex')::int,        -- JSON null -> SQL NULL
    (r ->> 'isCorrect')::boolean
  from jsonb_array_elements(p_responses) as r;

  return v_id;
end;
$$;

-- Authenticated users read their own rows directly (listAttempts / getAttempt),
-- so an explicit SELECT grant is required for the select policies to function
-- (unlike sat.questions, which authenticated reads only through draw_questions).
-- RLS still scopes every read to the user. No INSERT/UPDATE/DELETE grant — the
-- save_attempt RPC (security definer) is the only writer.
grant select on sat.test_attempts to authenticated;
grant select on sat.attempt_responses to authenticated;
grant execute on function sat.save_attempt(jsonb, jsonb) to authenticated;

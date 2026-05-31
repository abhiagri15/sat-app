-- 20260531010000_sat_save_attempt_idempotent.sql
-- Make sat.save_attempt idempotent on a client-supplied attempt_uuid.
--
-- The save path now keeps a localStorage backup and auto-resaves it on next
-- load (see 20260531000000 + the persistence gotchas in CLAUDE.md). That
-- introduced an at-least-once hazard: if the server COMMITS but the success
-- response is lost (network drop after commit), the client never clears the
-- backup and the resave would create a SECOND test_attempts row for the same
-- finished test. This migration closes that gap: the client sends a stable
-- attempt_uuid (generated once per finished test, carried in the backup and
-- every retry/resave), and save_attempt treats a repeat as a no-op that
-- returns the original id — no duplicate row, no daily-limit charge.
--
-- attempt_uuid is nullable + the unique index is partial, so a missing key
-- (older client, or crypto.randomUUID unavailable) falls back to the prior
-- always-insert behaviour.

alter table sat.test_attempts
  add column if not exists attempt_uuid uuid;

-- Per-user uniqueness. v4 uuids are globally unique in practice, but scoping by
-- user_id means a client that replays someone else's uuid can't even read back
-- that row's id. Partial (not-null) so multiple legacy null-keyed rows coexist.
create unique index if not exists test_attempts_user_attempt_uuid_key
  on sat.test_attempts (user_id, attempt_uuid)
  where attempt_uuid is not null;

-- Recreated from 20260525050000 (adaptive) with: (1) an early idempotency
-- short-circuit BEFORE the daily-limit check, (2) attempt_uuid written on
-- insert, (3) a unique_violation handler that makes a concurrent same-uuid
-- race resolve to the winner's id instead of erroring.
create or replace function sat.save_attempt(p_attempt jsonb, p_responses jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id   uuid;
  v_existing uuid;
  v_attempt_uuid uuid;
  v_today_count int;
  v_daily_limit int;
  v_test_length text;
  v_breakdown    jsonb;
  v_scaled_score int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if jsonb_array_length(p_responses) = 0 then
    raise exception 'no responses';
  end if;

  -- Idempotency short-circuit: if this attempt was already stored, return its
  -- id without re-inserting or counting against the daily limit. Runs BEFORE
  -- the limit check so a resave never trips 'daily attempt limit reached'.
  v_attempt_uuid := nullif(p_attempt ->> 'attemptUuid', '')::uuid;
  if v_attempt_uuid is not null then
    select id into v_existing
    from sat.test_attempts
    where user_id = v_user and attempt_uuid = v_attempt_uuid;
    if v_existing is not null then
      return v_existing;
    end if;
  end if;

  select daily_attempt_limit into v_daily_limit from sat.app_config limit 1;
  if v_daily_limit is null then v_daily_limit := 5; end if;
  select count(*) into v_today_count
  from sat.test_attempts
  where user_id = v_user
    and created_at >= date_trunc('day', now() at time zone 'UTC');
  if v_today_count >= v_daily_limit then
    raise exception 'daily attempt limit reached';
  end if;

  v_test_length := p_attempt ->> 'testLength';

  v_breakdown := (
    select jsonb_agg(
      jsonb_build_object(
        'name',         e ->> 'name',
        'sectionKey',   e ->> 'sectionKey',
        'correct',      (e ->> 'correct')::int,
        'total',        (e ->> 'total')::int,
        'module2Path',  e ->> 'module2Path',
        'scaled',       sat.scale_section(
                          e ->> 'sectionKey',
                          (e ->> 'correct')::int,
                          (e ->> 'total')::int,
                          v_test_length,
                          e ->> 'module2Path'
                        )
      )
      order by ord
    )
    from jsonb_array_elements(p_attempt -> 'sectionBreakdown')
      with ordinality as t(e, ord)
  );

  v_scaled_score := (
    select coalesce(sum((e ->> 'scaled')::int), 0)
    from jsonb_array_elements(v_breakdown) e
  );

  insert into sat.test_attempts (
    user_id, student_name, test_length,
    total_correct, total_questions, scaled_score, section_breakdown,
    attempt_uuid
  ) values (
    v_user,
    p_attempt ->> 'studentName',
    v_test_length,
    (p_attempt ->> 'totalCorrect')::int,
    (p_attempt ->> 'totalQuestions')::int,
    v_scaled_score,
    v_breakdown,
    v_attempt_uuid
  )
  returning id into v_id;

  insert into sat.attempt_responses (
    attempt_id, user_id, section_key, section_name, position,
    question_id, skill, source, passage, prompt, choices,
    answer_index, explanation, chosen_index, is_correct,
    response_format, entered_value, correct_answer, answer_tolerance,
    module_index
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
    nullif(r ->> 'chosenIndex', '')::int,
    case
      when coalesce(r ->> 'responseFormat', 'mcq') = 'spr' then
        sat.spr_is_correct(r ->> 'enteredValue', q.correct_answer, q.answer_tolerance)
      else
        (r ->> 'isCorrect')::boolean
    end,
    coalesce(r ->> 'responseFormat', 'mcq'),
    r ->> 'enteredValue',
    q.correct_answer,
    q.answer_tolerance,
    nullif(r ->> 'moduleIndex', '')::int
  from jsonb_array_elements(p_responses) as r
  left join sat.questions q on q.id = r ->> 'questionId';

  return v_id;

exception
  -- A concurrent save with the same (user_id, attempt_uuid) committed first
  -- (e.g. the original call's response was lost and a resave raced it). The
  -- partial unique index rejected our insert; resolve to the winner's id so
  -- the caller still sees success and clears its backup. Re-raise anything we
  -- can't attribute to the idempotency key.
  when unique_violation then
    if v_attempt_uuid is null then
      raise;
    end if;
    select id into v_existing
    from sat.test_attempts
    where user_id = v_user and attempt_uuid = v_attempt_uuid;
    if v_existing is null then
      raise;
    end if;
    return v_existing;
end;
$$;

grant execute on function sat.save_attempt(jsonb, jsonb) to authenticated;

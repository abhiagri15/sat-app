-- 20260531020000_sat_attempt_breaks_used.sql
-- Full-test pause ("Allow breaks"): record whether an attempt used breaks.
-- Informational only — NEVER read by sat.scale_section or any scoring path.
-- Recreated from 20260531010000 with one extra column write; the idempotency
-- short-circuit and unique_violation handler are preserved verbatim.

alter table sat.test_attempts
  add column if not exists breaks_used boolean not null default false;

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
  v_breaks_used boolean;
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
  v_breaks_used := coalesce((p_attempt ->> 'breaksUsed')::boolean, false);

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
    attempt_uuid, breaks_used
  ) values (
    v_user,
    p_attempt ->> 'studentName',
    v_test_length,
    (p_attempt ->> 'totalCorrect')::int,
    (p_attempt ->> 'totalQuestions')::int,
    v_scaled_score,
    v_breakdown,
    v_attempt_uuid,
    v_breaks_used
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

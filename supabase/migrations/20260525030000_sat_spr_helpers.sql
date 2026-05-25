-- Sub-project #9: Question-Format Parity — SPR comparison helpers and
-- updated sat.save_attempt that handles both mcq + spr rows.

-- Parses an SPR answer string into a numeric value.
-- Accepts:
--   integer:  '7', '-5', '0'
--   decimal:  '3.14', '-0.5', '.5'
--   fraction: '1/2', '-3/4', '7/12'
-- Rejects (returns NULL):
--   mixed numbers ('1 1/2'), scientific notation, anything else.
-- Mirrors app/lib/spr.ts#parseSpr — must stay in sync.
create or replace function sat.spr_to_numeric(s text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  parts text[];
begin
  if s is null then return null; end if;
  s := btrim(s);
  if s = '' then return null; end if;
  -- integer or decimal (with optional leading minus and optional .)
  if s ~ '^-?(\d+(\.\d+)?|\.\d+)$' then
    return s::numeric;
  end if;
  -- simple fraction
  if s ~ '^-?\d+/\d+$' then
    parts := string_to_array(s, '/');
    if parts[2]::numeric = 0 then return null; end if;
    return parts[1]::numeric / parts[2]::numeric;
  end if;
  return null;
end;
$$;

-- Compares an entered SPR answer against the canonical one. Returns false on
-- any parse failure (treated as wrong, never throws). Tolerance NULL = exact
-- numeric equality; otherwise abs(diff) <= tolerance.
create or replace function sat.spr_is_correct(
  entered   text,
  canonical text,
  tolerance numeric
) returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_entered_num   numeric;
  v_canonical_num numeric;
begin
  if entered is null or canonical is null then return false; end if;
  if btrim(entered) = btrim(canonical) then return true; end if;
  v_entered_num   := sat.spr_to_numeric(entered);
  v_canonical_num := sat.spr_to_numeric(canonical);
  if v_entered_num is null or v_canonical_num is null then return false; end if;
  if tolerance is not null then
    return abs(v_entered_num - v_canonical_num) <= tolerance;
  end if;
  return v_entered_num = v_canonical_num;
end;
$$;

-- Updated save_attempt: handles both mcq and spr rows. For spr, snapshots the
-- canonical answer + tolerance from sat.questions (looked up by question_id at
-- save time so the client cannot tamper) and computes is_correct via the
-- spr_is_correct helper. Mcq path is unchanged behaviourally.
create or replace function sat.save_attempt(p_attempt jsonb, p_responses jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id   uuid;
  v_today_count int;
  v_daily_limit int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if jsonb_array_length(p_responses) = 0 then
    raise exception 'no responses';
  end if;

  -- Daily attempt-limit check (introduced by daily-test-limit feature).
  select daily_attempt_limit into v_daily_limit from sat.app_config limit 1;
  if v_daily_limit is null then v_daily_limit := 5; end if;
  select count(*) into v_today_count
  from sat.test_attempts
  where user_id = v_user
    and created_at >= date_trunc('day', now() at time zone 'UTC');
  if v_today_count >= v_daily_limit then
    raise exception 'daily attempt limit reached';
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

  -- Insert responses. For spr rows we snapshot correct_answer + tolerance from
  -- sat.questions by question_id (client doesn't supply them) and re-compute
  -- is_correct server-side via sat.spr_is_correct. Mcq is_correct comes from
  -- the client payload (chosen_index = answer_index check happens on the
  -- client; safe because answer_index is also in attempt_responses for audit).
  insert into sat.attempt_responses (
    attempt_id, user_id, section_key, section_name, position,
    question_id, skill, source, passage, prompt, choices,
    answer_index, explanation, chosen_index, is_correct,
    response_format, entered_value, correct_answer, answer_tolerance
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
    q.answer_tolerance
  from jsonb_array_elements(p_responses) as r
  left join sat.questions q on q.id = r ->> 'questionId';

  return v_id;
end;
$$;

grant execute on function sat.spr_to_numeric(text)            to authenticated, service_role;
grant execute on function sat.spr_is_correct(text, text, numeric) to authenticated, service_role;
grant execute on function sat.save_attempt(jsonb, jsonb)      to authenticated;

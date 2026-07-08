-- Integrity Hardening Pack (#20), Task T2 — save_attempt v3: server-recomputed
-- correctness (audit finding B1).
--
-- See docs/superpowers/specs/2026-07-08-integrity-hardening-design.md § "T2.
-- save_attempt v3" and docs/superpowers/reviews/2026-07-08-audit-findings.md § B1.
--
-- WHAT CHANGES (and only this):
--   * Per response row, is_correct is recomputed SERVER-SIDE:
--       - spr: keep the existing join to sat.questions + sat.spr_is_correct
--         (already server-computed) — but now the result is AGGREGATED into the
--         per-section correct-count (previously the spr per-row value was
--         recomputed yet the section counts came from the client).
--       - mcq: join sat.questions by question_id; canonical correct TEXT =
--         q.choices ->> q.answer_index (choices is jsonb string[], 0-based ->>
--         int indexing — the text[] 1-based trap does NOT apply). The row is
--         correct when the SNAPSHOTTED presented choice text
--         (r -> 'choices' ->> chosenIndex) trim-equals the canonical text (the
--         client shuffle permutes order; the text is invariant). Fallback when
--         the question row is missing/deleted: the current client behavior
--         (answer_index = chosen_index) — a response must NEVER fail to save
--         because its question was deleted.
--   * Per-section `correct` AND `total` are recomputed from the response rows
--     (group by sectionKey) and used for scale_section, the STORED
--     section_breakdown[].correct/total, total_correct, and total_questions.
--   * The stored response rows carry the recomputed is_correct (mcq rows used
--     to store the client value).
--   * Client-supplied `correct` / `total` / `totalCorrect` / `totalQuestions` /
--     `scaledScore` stay in the wire shape for back-compat but are IGNORED as
--     authoritative. (scaledScore was already ignored — #10; total_correct and
--     the section counts were not — that is the B1 gap this closes.)
--
-- PRESERVED byte-for-byte in behavior (verified against the 8th/latest revision,
-- the 20260707040000_sat_parity.sql body):
--   * the attempt_uuid idempotency short-circuit BEFORE the daily-limit check,
--   * the unique_violation race handler,
--   * the daily-limit check,
--   * the module2_path validation/raise (via scale_section),
--   * time_ms + figure snapshotting, breaks_used, miss_reason (untouched).
--
-- SAME SIGNATURE (jsonb, jsonb) → CREATE OR REPLACE (body-only) PRESERVES the
-- existing ACL (grant execute to authenticated). The OVERLOAD RULE does NOT
-- apply and the function is NOT dropped. The trailing grant is retained for
-- parity with the source migration and is a harmless no-op.

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
  v_section_counts jsonb;
  v_total_correct   int;
  v_total_questions int;
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

  -- ---------------------------------------------------------------------------
  -- PRE-PASS: recompute per-row is_correct server-side and aggregate to
  -- per-section (correct, total), keyed by sectionKey. This runs BEFORE the
  -- v_breakdown build (which needs the section counts) and mirrors the exact
  -- per-row correctness expression the attempt_responses insert uses below.
  --
  -- Correctness expression (kept identical to the insert's CASE):
  --   spr: sat.spr_is_correct(enteredValue, q.correct_answer, q.answer_tolerance)
  --   mcq + question row present: trim(presented choice text at chosenIndex) =
  --        trim(canonical text = q.choices ->> q.answer_index)
  --   mcq + question row missing (deleted): client answer_index = chosen_index.
  -- ---------------------------------------------------------------------------
  v_section_counts := (
    select coalesce(
      jsonb_object_agg(
        s.section_key,
        jsonb_build_object('correct', s.correct, 'total', s.total)
      ),
      '{}'::jsonb
    )
    from (
      select
        r ->> 'sectionKey' as section_key,
        count(*)           as total,
        count(*) filter (
          where
            case
              when coalesce(r ->> 'responseFormat', 'mcq') = 'spr' then
                coalesce(
                  sat.spr_is_correct(
                    r ->> 'enteredValue', q.correct_answer, q.answer_tolerance
                  ),
                  false
                )
              when q.id is null then
                -- Question deleted: fall back to the client-snapshotted compare.
                nullif(r ->> 'chosenIndex', '')::int is not null
                and nullif(r ->> 'chosenIndex', '')::int
                    = nullif(r ->> 'answerIndex', '')::int
              else
                -- Canonical correct text vs the presented (shuffled) choice the
                -- student picked. Trim-compare; NULL chosenIndex (skipped) →
                -- the presented text is NULL → not correct.
                nullif(r ->> 'chosenIndex', '')::int is not null
                and btrim((r -> 'choices') ->> (nullif(r ->> 'chosenIndex', '')::int))
                    = btrim(q.choices ->> q.answer_index)
            end
        ) as correct
      from jsonb_array_elements(p_responses) as r
      left join sat.questions q on q.id = r ->> 'questionId'
      group by r ->> 'sectionKey'
    ) s
  );

  -- Server-trusted totals from the recomputed per-section counts.
  v_total_correct := (
    select coalesce(sum((e.value ->> 'correct')::int), 0)
    from jsonb_each(v_section_counts) e
  );
  v_total_questions := (
    select coalesce(sum((e.value ->> 'total')::int), 0)
    from jsonb_each(v_section_counts) e
  );

  -- Breakdown: name/sectionKey/module2Path from the client shape, but correct +
  -- total come from the server recompute (v_section_counts), and scaled is
  -- computed here via sat.scale_section (full-test module2Path validation still
  -- raises for a NULL path on a full test — unchanged).
  v_breakdown := (
    select jsonb_agg(
      jsonb_build_object(
        'name',         e ->> 'name',
        'sectionKey',   e ->> 'sectionKey',
        'correct',      coalesce((v_section_counts -> (e ->> 'sectionKey') ->> 'correct')::int, 0),
        'total',        coalesce((v_section_counts -> (e ->> 'sectionKey') ->> 'total')::int, 0),
        'module2Path',  e ->> 'module2Path',
        'scaled',       sat.scale_section(
                          e ->> 'sectionKey',
                          coalesce((v_section_counts -> (e ->> 'sectionKey') ->> 'correct')::int, 0),
                          coalesce((v_section_counts -> (e ->> 'sectionKey') ->> 'total')::int, 0),
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
    v_total_correct,
    v_total_questions,
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
    module_index, time_ms, figure
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
    -- Recomputed server-side (identical expression to the pre-pass above).
    case
      when coalesce(r ->> 'responseFormat', 'mcq') = 'spr' then
        coalesce(
          sat.spr_is_correct(r ->> 'enteredValue', q.correct_answer, q.answer_tolerance),
          false
        )
      when q.id is null then
        nullif(r ->> 'chosenIndex', '')::int is not null
        and nullif(r ->> 'chosenIndex', '')::int
            = nullif(r ->> 'answerIndex', '')::int
      else
        nullif(r ->> 'chosenIndex', '')::int is not null
        and btrim((r -> 'choices') ->> (nullif(r ->> 'chosenIndex', '')::int))
            = btrim(q.choices ->> q.answer_index)
    end,
    coalesce(r ->> 'responseFormat', 'mcq'),
    r ->> 'enteredValue',
    q.correct_answer,
    q.answer_tolerance,
    nullif(r ->> 'moduleIndex', '')::int,
    nullif(r ->> 'timeMs', '')::int,
    r -> 'figure'
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

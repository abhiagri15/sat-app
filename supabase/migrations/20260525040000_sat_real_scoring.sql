-- 20260525040000_sat_real_scoring.sql
--
-- Sub-project #10 — Score Validity.
--
--   1. Adds sat.scale_section(section, correct, total, length) — the
--      Postgres mirror of app/lib/scoring.ts (RW_CURVE / MATH_CURVE).
--   2. Recreates sat.save_attempt to compute scaled_score AND attach a
--      `scaled` field to each section_breakdown entry server-side.
--      The client's payload.scaledScore field is read by the upstream
--      zod schema but its value is no longer trusted as authoritative.
--   3. One-shot backfill UPDATE: recomputes scaled_score and adds
--      sectionKey + scaled to every existing row's section_breakdown.
--      Idempotent (recomputes from correct/total/test_length which it
--      does not mutate).
--
-- See docs/superpowers/specs/2026-05-25-score-validity-design.md for
-- design rationale.

-- ---------------- 1) sat.scale_section ----------------
--
-- Array literals MIRROR RW_CURVE / MATH_CURVE in app/lib/scoring.ts
-- byte-for-byte. Update both together; scripts/check-scoring.ts plus
-- the per-row SQL parity check in this migration's deploy notes
-- catch drift.

create or replace function sat.scale_section(
  p_section text,
  p_correct integer,
  p_total integer,
  p_test_length text   -- 'short' | 'full'
) returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_curve integer[];
  v_full_count integer;
  v_raw integer;
begin
  if p_section = 'rw' then
    v_curve := array[
      200, 200, 220, 250, 290, 330, 360, 390, 410, 430,
      450, 470, 490, 510, 530, 550, 570, 590, 610, 630,
      660, 680, 700, 720, 740, 760, 780, 800
    ];
  elsif p_section = 'math' then
    v_curve := array[
      200, 210, 250, 290, 330, 370, 420, 460, 500, 530,
      550, 570, 590, 610, 630, 650, 680, 700, 720, 740,
      760, 780, 800
    ];
  else
    raise exception 'sat.scale_section: unknown section %', p_section;
  end if;

  v_full_count := array_length(v_curve, 1) - 1;

  if p_test_length = 'short' then
    -- floor(x + 0.5) matches JS Math.round for non-negative inputs.
    -- (Postgres `round(numeric)` is banker's rounding — round-half-to-even —
    -- which disagrees with JS on half-steps where floor(x) is even.)
    v_raw := floor((p_correct::numeric / nullif(p_total, 0) * v_full_count) + 0.5);
  else
    v_raw := p_correct;
  end if;

  -- Clamp to [0, fullCount]; PL/pgSQL arrays are 1-indexed.
  v_raw := greatest(0, least(v_full_count, coalesce(v_raw, 0)));
  return v_curve[v_raw + 1];
end;
$$;

grant execute on function sat.scale_section(text, integer, integer, text)
  to authenticated, service_role;

-- ---------------- 2) sat.save_attempt recreation ----------------
--
-- Diff from the SPR-helpers version (20260525030000):
--   • The test_attempts insert no longer reads scaledScore from the
--     payload; it computes it from a server-built section_breakdown.
--   • section_breakdown is rebuilt: each entry gains `sectionKey`
--     and `scaled` (the latter via sat.scale_section).
--   • attempt_responses insert is unchanged from the SPR-helpers
--     version.

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

  v_test_length := p_attempt ->> 'testLength';

  -- Server-build section_breakdown with sectionKey + scaled.
  v_breakdown := (
    select jsonb_agg(
      jsonb_build_object(
        'name',       e ->> 'name',
        'sectionKey', e ->> 'sectionKey',
        'correct',    (e ->> 'correct')::int,
        'total',      (e ->> 'total')::int,
        'scaled',     sat.scale_section(
                        e ->> 'sectionKey',
                        (e ->> 'correct')::int,
                        (e ->> 'total')::int,
                        v_test_length
                      )
      )
      order by ord
    )
    from jsonb_array_elements(p_attempt -> 'sectionBreakdown')
      with ordinality as t(e, ord)
  );

  -- Composite is the sum of per-section scaled (real SAT does it
  -- the same way: 200-800 + 200-800 → 400-1600).
  v_scaled_score := (
    select coalesce(sum((e ->> 'scaled')::int), 0)
    from jsonb_array_elements(v_breakdown) e
  );

  insert into sat.test_attempts (
    user_id, student_name, test_length,
    total_correct, total_questions, scaled_score, section_breakdown
  ) values (
    v_user,
    p_attempt ->> 'studentName',
    v_test_length,
    (p_attempt ->> 'totalCorrect')::int,
    (p_attempt ->> 'totalQuestions')::int,
    v_scaled_score,
    v_breakdown
  )
  returning id into v_id;

  -- attempt_responses insert (unchanged from the SPR-helpers version).
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

grant execute on function sat.save_attempt(jsonb, jsonb) to authenticated;

-- ---------------- 3) Backfill ----------------
--
-- Skips a row entirely if ANY entry in its section_breakdown has a
-- name we don't recognise — that prevents a NULL routing key from
-- hitting scale_section's exception branch and aborting the update
-- mid-flight. The skipped row keeps its old linear scaled_score.
-- After-run check: `where exists` of the inverse filter; implementer
-- triages any survivors manually (step 6 of Task 5).

update sat.test_attempts ta
set
  section_breakdown = (
    select jsonb_agg(
      jsonb_build_object(
        'name',       e ->> 'name',
        'sectionKey', case e ->> 'name'
                        when 'Reading & Writing' then 'rw'
                        when 'Math' then 'math'
                      end,
        'correct',    (e ->> 'correct')::int,
        'total',      (e ->> 'total')::int,
        'scaled',     sat.scale_section(
                        case e ->> 'name'
                          when 'Reading & Writing' then 'rw'
                          when 'Math' then 'math'
                        end,
                        (e ->> 'correct')::int,
                        (e ->> 'total')::int,
                        ta.test_length
                      )
      )
      order by ord
    )
    from jsonb_array_elements(ta.section_breakdown) with ordinality as t(e, ord)
  ),
  scaled_score = (
    select coalesce(sum(sat.scale_section(
      case e ->> 'name'
        when 'Reading & Writing' then 'rw'
        when 'Math' then 'math'
      end,
      (e ->> 'correct')::int,
      (e ->> 'total')::int,
      ta.test_length
    )), 0)
    from jsonb_array_elements(ta.section_breakdown) e
  )
where not exists (
  -- Skip rows containing ANY entry with an unrecognised name (or null).
  select 1 from jsonb_array_elements(ta.section_breakdown) e
  where e ->> 'name' is null
     or e ->> 'name' not in ('Reading & Writing', 'Math')
);

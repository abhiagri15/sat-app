-- 20260525050000_sat_adaptive_schema.sql
-- Sub-project #11 — Adaptive Test Structure.
--
-- Schema and scoring changes:
--   1. sat.questions: difficulty + classified_at columns
--   2. sat.attempt_responses: module_index column
--   3. sat.app_config: module2_threshold_pct column
--   4. sat.draw_questions: extended with p_skill + p_difficulty
--      (preserves fresh→recycle→track served_at write loop)
--   5. sat.scale_section: extended with p_module2_path; 4 new curves
--   6. sat.save_attempt: recreated to read module2Path + moduleIndex
--
-- See docs/superpowers/specs/2026-05-25-adaptive-test-structure-design.md

-- ---------------- 1) sat.questions: difficulty + classified_at ----------------
alter table sat.questions
  add column if not exists difficulty text not null default 'medium'
    check (difficulty in ('easy','medium','hard'));

alter table sat.questions
  add column if not exists classified_at timestamptz;

create index if not exists questions_section_skill_difficulty_enabled_idx
  on sat.questions (section, skill, difficulty)
  where enabled;

-- ---------------- 2) sat.attempt_responses.module_index ----------------
alter table sat.attempt_responses
  add column if not exists module_index int;   -- 0 = Module 1, 1 = Module 2, null = short

-- ---------------- 3) sat.app_config.module2_threshold_pct ----------------
alter table sat.app_config
  add column if not exists module2_threshold_pct int not null default 60
    check (module2_threshold_pct between 0 and 100);

-- ---------------- 4) sat.draw_questions rewrite (drop + recreate) ----------------
--
-- PRESERVES: fresh draw → recycle path (if fresh < count) → INSERT INTO
--            sat.served_questions to track served_at → return rows.
-- ADDS:      p_skill and p_difficulty filters that apply to both the fresh
--            and recycle queries.

drop function if exists sat.draw_questions(text, int);
drop function if exists sat.draw_questions(text, text, int);
drop function if exists sat.draw_questions(text, text, text, int);

create or replace function sat.draw_questions(
  p_section    text,
  p_skill      text default null,
  p_difficulty text default null,
  p_count      int  default 1
) returns setof sat.questions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_count int  := least(greatest(coalesce(p_count, 0), 0), 60);
  v_ids   text[];
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  -- Fresh: unserved questions matching the (section, skill?, difficulty?) filters.
  select coalesce(array_agg(id), array[]::text[]) into v_ids from (
    select q.id from sat.questions q
    where q.section = p_section
      and q.enabled
      and (p_skill is null or q.skill = p_skill)
      and (p_difficulty is null or q.difficulty = p_difficulty)
      and not exists (
        select 1 from sat.served_questions s
        where s.user_id = v_user and s.question_id = q.id)
    order by random()
    limit v_count
  ) fresh;

  -- Recycle: least-recently-served matching questions if fresh pool was thin.
  if coalesce(array_length(v_ids, 1), 0) < v_count then
    select v_ids || coalesce(array_agg(id), array[]::text[]) into v_ids from (
      select q.id
      from sat.questions q
      join sat.served_questions s
        on s.question_id = q.id and s.user_id = v_user
      where q.section = p_section
        and q.enabled
        and (p_skill is null or q.skill = p_skill)
        and (p_difficulty is null or q.difficulty = p_difficulty)
        and not (q.id = any(v_ids))
      order by s.served_at asc
      limit v_count - coalesce(array_length(v_ids, 1), 0)
    ) recycled;
  end if;

  -- Track served (upsert served_at = now).
  insert into sat.served_questions (user_id, question_id, served_at)
  select v_user, unnest(v_ids), now()
  on conflict (user_id, question_id) do update set served_at = excluded.served_at;

  return query select * from sat.questions q where q.id = any(v_ids);
end;
$$;

grant execute on function sat.draw_questions(text, text, text, int)
  to authenticated, service_role;

-- ---------------- 5) sat.scale_section recreation ----------------
--
-- Adds p_module2_path. Short branch: identical to the #10 body. Full
-- branch: dispatch on (section, path) → 1 of 4 new array literals.
-- Rejects (full, NULL) with an explicit raise (no silent fallthrough).
--
-- MIRROR DISCIPLINE: array[...] literals must stay byte-for-byte equal
-- to RW_FULL_EASIER_CURVE / RW_FULL_HARDER_CURVE / MATH_FULL_EASIER_CURVE
-- / MATH_FULL_HARDER_CURVE in app/lib/scoring.ts.

create or replace function sat.scale_section(
  p_section text,
  p_correct integer,
  p_total integer,
  p_test_length text,
  p_module2_path text default null
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
  if p_test_length = 'short' then
    -- Verbatim from sub-project #10's short-test scoring body.
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
    v_raw := floor((p_correct::numeric / nullif(p_total, 0) * v_full_count) + 0.5);
    v_raw := greatest(0, least(v_full_count, coalesce(v_raw, 0)));
    return v_curve[v_raw + 1];

  elsif p_test_length = 'full' then
    if p_module2_path is null then
      raise exception 'sat.scale_section: full-test scoring requires p_module2_path (got NULL)';
    end if;

    if p_section = 'rw' and p_module2_path = 'easier' then
      v_curve := array[
        200, 200, 200, 210, 220, 230, 240, 260, 280, 300,
        320, 340, 360, 370, 380, 390, 400, 410, 420, 430,
        440, 450, 460, 470, 480, 490, 500, 510, 510, 520,
        520, 530, 530, 540, 540, 550, 550, 560, 560, 570,
        570, 580, 580, 580, 580, 590, 590, 590, 590, 600,
        600, 600, 600, 600, 600
      ];
    elsif p_section = 'rw' and p_module2_path = 'harder' then
      v_curve := array[
        430, 430, 440, 450, 460, 470, 480, 490, 500, 510,
        520, 530, 540, 550, 560, 570, 580, 590, 600, 610,
        620, 630, 640, 650, 660, 670, 680, 690, 700, 705,
        710, 715, 720, 725, 730, 735, 740, 745, 750, 755,
        760, 765, 770, 775, 780, 785, 790, 793, 795, 797,
        798, 799, 800, 800, 800
      ];
    elsif p_section = 'math' and p_module2_path = 'easier' then
      v_curve := array[
        200, 200, 210, 220, 240, 260, 280, 300, 320, 340,
        360, 380, 400, 410, 420, 430, 440, 450, 460, 470,
        480, 490, 500, 510, 520, 530, 540, 545, 550, 555,
        560, 565, 570, 575, 580, 585, 585, 590, 590, 595,
        595, 600, 600, 600, 600
      ];
    elsif p_section = 'math' and p_module2_path = 'harder' then
      v_curve := array[
        430, 440, 450, 460, 470, 480, 490, 500, 510, 520,
        530, 540, 550, 560, 570, 580, 590, 600, 610, 620,
        630, 640, 650, 660, 670, 680, 690, 700, 710, 720,
        725, 730, 735, 740, 745, 750, 755, 760, 765, 770,
        775, 780, 790, 795, 800
      ];
    else
      raise exception 'sat.scale_section: unknown (section,path) (%, %)',
        p_section, p_module2_path;
    end if;

    v_raw := greatest(0, least(array_length(v_curve, 1) - 1, p_correct));
    return v_curve[v_raw + 1];

  else
    raise exception 'sat.scale_section: unknown p_test_length (%)', p_test_length;
  end if;
end;
$$;

grant execute on function sat.scale_section(text, integer, integer, text, text)
  to authenticated, service_role;

-- ---------------- 6) sat.save_attempt recreation ----------------
--
-- Diff from sub-project #10:
--   • section_breakdown adds module2Path per entry
--   • scale_section call gains the 5th arg
--   • attempt_responses INSERT adds module_index from the payload

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
end;
$$;

grant execute on function sat.save_attempt(jsonb, jsonb) to authenticated;

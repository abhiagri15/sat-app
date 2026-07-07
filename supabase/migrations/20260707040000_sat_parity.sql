-- Competitive Parity Pack (#15): per-question timing + math figures + empirical
-- difficulty calibration + per-question pacing analytics + the coach follow-up
-- rate-cap table, plus the two save-RPC revisions that persist timing/figure.
--
-- See docs/superpowers/specs/2026-07-07-competitive-parity-design.md
-- (sections A [DB half], C, and Security invariants) and
-- docs/superpowers/plans/2026-07-07-competitive-parity-plan.md (Task 1).
--
-- House style follows 20260707020000_sat_dynamic_practice.sql: RLS select-only
-- (or policy-less) tables, writes via the service-role client in server code,
-- security-definer only where the read/write must escape RLS, security-invoker
-- for read-only aggregates over RLS-scoped tables, and an explicit
-- `grant execute` for every function (the sat schema is deny-by-default for
-- functions — 20260521000000 revokes all on functions from
-- anon/authenticated/public via default privileges).
--
-- Security invariants (from the spec):
--   * The two new tables are policy-less RLS + service-role-only. No write
--     policy anywhere.
--   * calibrate_difficulty is grant-execute to service_role ONLY (students must
--     not trigger relabeling). user_pacing is authenticated-only.
--   * time_ms and figure are client-reported and display/analytics-only — they
--     never feed scoring or the daily-limit path (same posture as breaks_used).

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

-- Per-question active-display milliseconds (nullable — old clients send
-- nothing) and the snapshotted figure as presented, on both response tables.
alter table sat.attempt_responses
  add column if not exists time_ms int,
  add column if not exists figure  jsonb;

alter table sat.practice_responses
  add column if not exists time_ms int,
  add column if not exists figure  jsonb;

-- The live figure spec on the question, and the provenance of its difficulty
-- label (model-assigned vs empirically calibrated).
alter table sat.questions
  add column if not exists figure jsonb,
  add column if not exists difficulty_source text not null default 'model'
    check (difficulty_source in ('model','empirical'));

-- ---------------------------------------------------------------------------
-- Tables (both policy-less RLS, service-role only — the audit / rate-cap trail).
-- Same posture as sat.question_flags / sat.save_failures / sat.practice_topups:
-- RLS on with NO policy means the anon/authenticated role can neither read nor
-- write; only the service role (BYPASSRLS) touches them.
-- ---------------------------------------------------------------------------

-- C. sat.difficulty_calibrations — audit trail of empirical relabels.
create table sat.difficulty_calibrations (
  id             uuid primary key default gen_random_uuid(),
  question_id    text not null,
  old_difficulty text,
  new_difficulty text,
  sample_n       int,
  p_value        numeric,
  calibrated_at  timestamptz not null default now()
);

create index difficulty_calibrations_question_idx
  on sat.difficulty_calibrations (question_id);

alter table sat.difficulty_calibrations enable row level security;

grant all on sat.difficulty_calibrations to service_role;

-- E. sat.coach_explains — per-user "Explain my mistake" log (daily rate-cap trail).
create table sat.coach_explains (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  question_id text not null,
  created_at  timestamptz not null default now()
);

create index coach_explains_user_created_idx
  on sat.coach_explains (user_id, created_at desc);

alter table sat.coach_explains enable row level security;

grant all on sat.coach_explains to service_role;

-- ---------------------------------------------------------------------------
-- C. sat.calibrate_difficulty — empirical p-value overrides the model label.
-- security DEFINER, service-role/cron use only: for every ENABLED question with
-- >= p_min_n graded responses across BOTH response tables, p = correct-rate;
-- map p >= 0.75 -> easy, 0.40 <= p < 0.75 -> medium, p < 0.40 -> hard. Where the
-- mapped label differs from the current one, update difficulty +
-- difficulty_source='empirical' and log an audit row. Returns the relabel count.
-- Idempotent — a rerun with unchanged data relabels nothing new.
--
-- grant execute to service_role ONLY (not authenticated — students must never
-- trigger relabeling; the daily cron calls it via the service-role client).
-- ---------------------------------------------------------------------------

create or replace function sat.calibrate_difficulty(p_min_n int default 10)
returns int
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_relabeled int := 0;
  r record;
  v_new_difficulty text;
begin
  -- Per-question graded counts, unioned across both response tables. A NULL
  -- min-sample falls back to the default of 10.
  for r in
    select
      s.question_id,
      count(*)                                as total,
      count(*) filter (where s.is_correct)    as correct,
      q.difficulty                            as old_difficulty
    from (
      select ar.question_id, ar.is_correct
      from sat.attempt_responses ar
      union all
      select pr.question_id, pr.is_correct
      from sat.practice_responses pr
    ) s
    join sat.questions q on q.id = s.question_id
    where q.enabled
    group by s.question_id, q.difficulty
    having count(*) >= coalesce(p_min_n, 10)
  loop
    -- p-value cuts: >= 0.75 easy, 0.40 <= p < 0.75 medium, < 0.40 hard.
    if (r.correct::numeric / r.total) >= 0.75 then
      v_new_difficulty := 'easy';
    elsif (r.correct::numeric / r.total) >= 0.40 then
      v_new_difficulty := 'medium';
    else
      v_new_difficulty := 'hard';
    end if;

    if v_new_difficulty is distinct from r.old_difficulty then
      update sat.questions
        set difficulty = v_new_difficulty,
            difficulty_source = 'empirical'
        where id = r.question_id;

      insert into sat.difficulty_calibrations
        (question_id, old_difficulty, new_difficulty, sample_n, p_value)
      values
        (r.question_id, r.old_difficulty, v_new_difficulty, r.total,
         round(r.correct::numeric / r.total, 4));

      v_relabeled := v_relabeled + 1;
    end if;
  end loop;

  return v_relabeled;
end;
$$;

-- ---------------------------------------------------------------------------
-- A. sat.user_pacing — per-skill/section timing aggregate for the signed-in
-- user, across both response tables. security INVOKER (the user_analytics /
-- practice_skill_stats precedent): it reads only RLS-scoped tables, so RLS
-- confines it to the caller; it keeps an explicit auth.uid() filter as a
-- clarity backstop. avg over non-null time_ms only.
--
-- Section source is PINNED per spec A: the test side reads
-- attempt_responses.section_key directly; the practice side has no section_key
-- on the response row, so it joins sat.practice_sessions (session_id -> section).
-- No sat.questions join needed.
-- ---------------------------------------------------------------------------

create or replace function sat.user_pacing()
returns table (
  skill     text,
  section   text,
  responses bigint,
  timed     bigint,
  avg_ms    numeric
)
language sql
security invoker
set search_path to ''
as $$
  select
    e.skill,
    e.section,
    count(*)                                             as responses,
    count(*) filter (where e.time_ms is not null)        as timed,
    avg(e.time_ms) filter (where e.time_ms is not null)  as avg_ms
  from (
    select
      ar.skill,
      ar.section_key as section,
      ar.time_ms
    from sat.attempt_responses ar
    where ar.user_id = (select auth.uid())
    union all
    select
      pr.skill,
      ps.section as section,
      pr.time_ms
    from sat.practice_responses pr
    join sat.practice_sessions ps on ps.id = pr.session_id
    where pr.user_id = (select auth.uid())
  ) e
  group by e.skill, e.section
$$;

-- ---------------------------------------------------------------------------
-- Revised sat.save_attempt — current live definition is
-- 20260531020000_sat_attempt_breaks_used.sql (a CREATE OR REPLACE that took the
-- 20260531010000 idempotency body and added breaks_used). Reconstructed here
-- verbatim from that definition, with the ONLY additions being time_ms
-- (null-safe (r ->> 'timeMs')::int) and figure (r -> 'figure') in the
-- attempt_responses insert. Everything else — the attempt_uuid short-circuit
-- BEFORE the daily-limit check, the unique_violation handler, scale_section
-- usage, breaks_used — is preserved byte-for-byte.
--
-- CREATE OR REPLACE preserves the existing ACL (grant execute to authenticated
-- from 20260521050000 / re-granted in 20260531020000) — no re-grant is needed
-- here; the trailing grant is retained for parity with the source migration and
-- is a harmless no-op.
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- Revised sat.save_practice — base is 20260707000000_sat_practice.sql (the live
-- definition; 20260707020000 only re-created draw_drill, not save_practice).
-- Reconstructed verbatim, with the ONLY additions being time_ms
-- (null-safe (r ->> 'timeMs')::int) and figure (r -> 'figure') in the
-- practice_responses insert (column list + values). Idempotency on
-- (user_id, session_uuid) and the server-side correctness re-verification are
-- preserved byte-for-byte otherwise.
--
-- CREATE OR REPLACE preserves the existing ACL (grant execute to authenticated
-- from 20260707000000) — no re-grant is needed; the trailing grant is retained
-- for parity with the source migration and is a harmless no-op.
-- ---------------------------------------------------------------------------

create or replace function sat.save_practice(p_session jsonb, p_responses jsonb)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user         uuid := (select auth.uid());
  v_session_uuid uuid;
  v_section      text;
  v_skill        text;
  v_existing     uuid;
  v_id           uuid;
  v_total        int := 0;
  v_correct      int := 0;
  r              jsonb;
  v_format       text;
  v_chosen       int;
  v_is_correct   boolean;
  v_canonical    text;
  v_tolerance    numeric;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  v_session_uuid := (p_session ->> 'sessionUuid')::uuid;
  v_section      := p_session ->> 'section';
  v_skill        := p_session ->> 'skill';
  if v_session_uuid is null then
    raise exception 'sessionUuid required';
  end if;
  if v_section is null or v_skill is null then
    raise exception 'section and skill required';
  end if;
  if p_responses is null or jsonb_typeof(p_responses) <> 'array'
     or jsonb_array_length(p_responses) = 0 then
    raise exception 'no responses';
  end if;

  select ps.id into v_existing
  from sat.practice_sessions ps
  where ps.user_id = v_user and ps.session_uuid = v_session_uuid;
  if v_existing is not null then
    return v_existing;
  end if;

  begin
    insert into sat.practice_sessions
      (user_id, session_uuid, section, skill, total, correct)
    values (v_user, v_session_uuid, v_section, v_skill, 0, 0)
    returning id into v_id;
  exception when unique_violation then
    select ps.id into v_existing
    from sat.practice_sessions ps
    where ps.user_id = v_user and ps.session_uuid = v_session_uuid;
    return v_existing;
  end;

  for r in select * from jsonb_array_elements(p_responses) loop
    v_format := coalesce(r ->> 'responseFormat', 'mcq');
    v_chosen := coalesce((r ->> 'chosenIndex')::int, -1);

    if v_format = 'spr' then
      -- Canonical comes from sat.questions — never from the client.
      select q.correct_answer, q.answer_tolerance
        into v_canonical, v_tolerance
        from sat.questions q
        where q.id = r ->> 'questionId';
      v_is_correct := coalesce(
        sat.spr_is_correct(r ->> 'enteredValue', v_canonical, v_tolerance),
        false);
    else
      v_is_correct := v_chosen >= 0
        and v_chosen = coalesce((r ->> 'answerIndex')::int, -2);
      v_canonical := null;
      v_tolerance := null;
    end if;

    insert into sat.practice_responses
      (session_id, user_id, position, question_id, skill, source, passage,
       prompt, choices, answer_index, explanation, chosen_index, is_correct,
       response_format, entered_value, correct_answer, answer_tolerance,
       time_ms, figure)
    values
      (v_id, v_user,
       coalesce((r ->> 'position')::int, v_total),
       r ->> 'questionId',
       coalesce(r ->> 'skill', v_skill),
       coalesce(r ->> 'source', 'ai'),
       r ->> 'passage',
       r ->> 'prompt',
       coalesce(r -> 'choices', '[]'::jsonb),
       coalesce((r ->> 'answerIndex')::int, 0),
       coalesce(r ->> 'explanation', ''),
       v_chosen,
       v_is_correct,
       v_format,
       r ->> 'enteredValue',
       case when v_format = 'spr' then v_canonical else null end,
       case when v_format = 'spr' then v_tolerance else null end,
       nullif(r ->> 'timeMs', '')::int,
       r -> 'figure');

    v_total := v_total + 1;
    if v_is_correct then v_correct := v_correct + 1; end if;
  end loop;

  update sat.practice_sessions ps
    set total = v_total, correct = v_correct
    where ps.id = v_id;

  return v_id;
end;
$$;

grant execute on function sat.save_practice(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants. The sat schema is deny-by-default for functions (20260521000000
-- revokes all on functions from anon/authenticated/public via default
-- privileges) — every new function needs an explicit execute grant.
--
-- calibrate_difficulty: service_role ONLY (students must not trigger it).
-- user_pacing: authenticated (a per-user read).
-- ---------------------------------------------------------------------------

grant execute on function sat.calibrate_difficulty(int) to service_role;
grant execute on function sat.user_pacing() to authenticated;

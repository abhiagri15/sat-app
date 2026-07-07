-- Study Planner + Miss-Reason Tagging (#18): a `miss_reason` tag on both
-- response tables (definer write RPC with silent-no-op semantics), a
-- security-INVOKER per-skill reason-mix aggregate, the `sat.study_plans` table
-- with a bounds-checked definer upsert, and skill_evidence v3 (DROP + recreate
-- with the new `miss_reason` column + a re-issued execute grant).
--
-- See docs/superpowers/specs/2026-07-07-study-planner-design.md (sections A and
-- B [Data]) and docs/superpowers/plans/2026-07-07-gaps-closure-plan.md (Task 5).
--
-- House style follows 20260707040000_sat_parity.sql: RLS select-only (or
-- policy-less) tables, writes via security-definer RPCs setting/checking
-- auth.uid() (no write policies anywhere), security-invoker for read-only
-- aggregates over RLS-scoped tables, and an explicit `grant execute` for every
-- function (the sat schema is deny-by-default for functions — 20260521000000
-- revokes all on functions from anon/authenticated/public via default
-- privileges).
--
-- Security invariants (from the spec):
--   * Both new write paths are definer RPCs setting/checking auth.uid(); no
--     write policy anywhere. study_plans numbers are bounds-checked in SQL.
--   * Miss reasons are a closed enum (CHECK constraint + zod-side literal
--     union). A stale/foreign/correct row is a SILENT no-op (return false),
--     never a raise.
--   * DROP loses a function's ACL — skill_evidence's recreate MUST re-issue its
--     execute grant and keep security invoker + set search_path to ''.

-- ---------------------------------------------------------------------------
-- Columns: miss_reason on both response tables (nullable — old rows and
-- untagged rows carry null). The closed set matches the MISS_REASONS const in
-- app/lib/practice/miss-reasons.ts (the SQL CHECK is the only duplicate of the
-- enum — note beside the SKILLS two-places gotcha).
-- ---------------------------------------------------------------------------

alter table sat.attempt_responses
  add column if not exists miss_reason text
    check (miss_reason in ('concept','careless','time_pressure','misread','setup','vocab'));

alter table sat.practice_responses
  add column if not exists miss_reason text
    check (miss_reason in ('concept','careless','time_pressure','misread','setup','vocab'));

-- ---------------------------------------------------------------------------
-- sat.tag_miss_reason — the write path for miss-reason tags. security DEFINER:
-- the two response tables are RLS select-only (no write policy), so the tag is
-- applied via a definer RPC that guards on auth.uid() itself — the same posture
-- as save_attempt / save_practice.
--
-- p_origin picks the table ('test' → attempt_responses, 'practice' →
-- practice_responses); any other value raises. p_reason is null (clears the
-- tag, re-taggable) or one of the closed set (raise otherwise; the column CHECK
-- is the backstop). The UPDATE is guarded `where id = p_response_id and
-- user_id = auth.uid() and is_correct = false` — a non-matching id (stale,
-- foreign, or correct row) is a SILENT no-op returning false, never a raise, so
-- a stale client id cannot 500. Returns FOUND.
-- ---------------------------------------------------------------------------

create or replace function sat.tag_miss_reason(
  p_origin      text,
  p_response_id uuid,
  p_reason      text
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_origin not in ('test', 'practice') then
    raise exception 'invalid p_origin: %', p_origin;
  end if;
  if p_reason is not null
     and p_reason not in ('concept','careless','time_pressure','misread','setup','vocab') then
    raise exception 'invalid p_reason: %', p_reason;
  end if;

  if p_origin = 'test' then
    update sat.attempt_responses
      set miss_reason = p_reason
      where id = p_response_id
        and user_id = v_user
        and is_correct = false;
  else
    update sat.practice_responses
      set miss_reason = p_reason
      where id = p_response_id
        and user_id = v_user
        and is_correct = false;
  end if;

  return found;
end;
$$;

grant execute on function sat.tag_miss_reason(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- sat.study_plans — one plan row per user. RLS select-own; NO write policy —
-- the only writer is the sat.upsert_study_plan definer RPC below. Grants:
-- select for authenticated, all for service_role (house style).
-- ---------------------------------------------------------------------------

create table sat.study_plans (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  target_score     int not null check (target_score between 400 and 1600),
  test_date        date,
  sessions_per_week int not null default 4 check (sessions_per_week between 2 and 7),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table sat.study_plans enable row level security;

create policy study_plans_select_own on sat.study_plans
  for select to authenticated using (user_id = (select auth.uid()));

grant select on sat.study_plans to authenticated;
grant all on sat.study_plans to service_role;

-- ---------------------------------------------------------------------------
-- sat.upsert_study_plan — the write path for a study plan. security DEFINER:
-- sat.study_plans is RLS select-only (no write policy), so the upsert runs
-- through a definer RPC that sets user_id := auth.uid() itself and validates
-- the bounds (raise on violation — the column CHECKs are the backstop). Upsert
-- on the user_id pk with updated_at = now().
-- ---------------------------------------------------------------------------

create or replace function sat.upsert_study_plan(
  p_target    int,
  p_test_date date,
  p_sessions  int
)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_target is null or p_target < 400 or p_target > 1600 then
    raise exception 'target_score out of range: %', p_target;
  end if;
  if p_sessions is null or p_sessions < 2 or p_sessions > 7 then
    raise exception 'sessions_per_week out of range: %', p_sessions;
  end if;

  insert into sat.study_plans (user_id, target_score, test_date, sessions_per_week)
  values (v_user, p_target, p_test_date, p_sessions)
  on conflict (user_id) do update set
    target_score      = excluded.target_score,
    test_date         = excluded.test_date,
    sessions_per_week = excluded.sessions_per_week,
    updated_at        = now();
end;
$$;

grant execute on function sat.upsert_study_plan(int, date, int) to authenticated;

-- ---------------------------------------------------------------------------
-- sat.miss_reason_mix — per-skill miss-reason counts across both response
-- tables. security INVOKER (the user_analytics / practice_skill_stats
-- precedent): it reads only RLS-scoped tables, so RLS confines it to the
-- caller; it keeps explicit auth.uid() backstops. Only tagged incorrect
-- responses (is_correct = false AND miss_reason is not null) are grouped, by
-- (skill, miss_reason).
-- ---------------------------------------------------------------------------

create or replace function sat.miss_reason_mix()
returns table (
  skill       text,
  miss_reason text,
  cnt         bigint
)
language sql
security invoker
set search_path to ''
as $$
  select m.skill, m.miss_reason, count(*) as cnt
  from (
    select ar.skill, ar.miss_reason
    from sat.attempt_responses ar
    where ar.user_id = (select auth.uid())
      and ar.is_correct = false
      and ar.miss_reason is not null
    union all
    select pr.skill, pr.miss_reason
    from sat.practice_responses pr
    where pr.user_id = (select auth.uid())
      and pr.is_correct = false
      and pr.miss_reason is not null
  ) m
  group by m.skill, m.miss_reason;
$$;

grant execute on function sat.miss_reason_mix() to authenticated;

-- ---------------------------------------------------------------------------
-- sat.skill_evidence v3 — adds `miss_reason` (the student's own read of why
-- they missed) to the evidence rows fed to the guidance prompt. Postgres
-- forbids CREATE OR REPLACE from changing a function's return type, so this
-- must DROP + recreate. **A DROP loses the ACL** — the recreate re-issues the
-- execute grant to authenticated (load-bearing) and keeps security invoker +
-- set search_path to ''.
--
-- The body is copied EXACTLY from 20260707020000_sat_dynamic_practice.sql (the
-- v2 skill_evidence) with the ONLY change being `miss_reason` added to both
-- union legs and to the RETURNS TABLE (positioned just before answered_at).
-- miss_reason reads straight off the response row (no new join; the questions
-- LEFT join stays).
-- ---------------------------------------------------------------------------

drop function sat.skill_evidence(text, int);

create or replace function sat.skill_evidence(p_skill text, p_limit int default 12)
returns table (
  prompt          text,
  choices         jsonb,
  chosen_index    int,
  entered_value   text,
  correct_answer  text,
  answer_index    int,
  is_correct      boolean,
  response_format text,
  difficulty      text,
  miss_reason     text,
  answered_at     timestamptz,
  origin          text
)
language sql
security invoker
set search_path to ''
as $$
  select
    e.prompt,
    e.choices,
    e.chosen_index,
    e.entered_value,
    e.correct_answer,
    e.answer_index,
    e.is_correct,
    e.response_format,
    q.difficulty,
    e.miss_reason,
    e.answered_at,
    e.origin
  from (
    select
      ar.prompt,
      ar.choices,
      ar.chosen_index,
      ar.entered_value,
      ar.correct_answer,
      ar.answer_index,
      ar.is_correct,
      ar.response_format,
      ar.miss_reason,
      ar.question_id,
      ta.created_at as answered_at,
      'test'::text  as origin
    from sat.attempt_responses ar
    join sat.test_attempts ta on ta.id = ar.attempt_id
    where ar.user_id = (select auth.uid())
      and ar.skill = p_skill
    union all
    select
      pr.prompt,
      pr.choices,
      pr.chosen_index,
      pr.entered_value,
      pr.correct_answer,
      pr.answer_index,
      pr.is_correct,
      pr.response_format,
      pr.miss_reason,
      pr.question_id,
      ps.created_at   as answered_at,
      'practice'::text as origin
    from sat.practice_responses pr
    join sat.practice_sessions ps on ps.id = pr.session_id
    where pr.user_id = (select auth.uid())
      and pr.skill = p_skill
  ) e
  left join sat.questions q on q.id = e.question_id
  order by e.answered_at desc
  limit least(coalesce(p_limit, 12), 25);
$$;

-- DROP lost the ACL — RE-ISSUE the execute grant (load-bearing; without this
-- the authenticated role gets "permission denied" on the recreated function).
grant execute on function sat.skill_evidence(text, int) to authenticated;

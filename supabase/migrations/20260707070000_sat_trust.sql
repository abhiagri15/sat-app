-- Trust & Coverage Pack (#19), Task 1 (T1): review-status gating (content trust
-- without starving assembly), strict scored draws, and planner timezone.
--
-- See docs/superpowers/specs/2026-07-07-trust-coverage-design.md (sections A and
-- B, and the Plan's T1).
--
-- House style follows 20260707060000_sat_planner.sql / 20260707050000_sat_fidelity.sql:
-- RLS select-only (or policy-less) tables, writes via security-definer RPCs
-- setting/checking auth.uid() (no write policies anywhere), security-invoker for
-- read-only aggregates over RLS-scoped tables, and an explicit `grant execute`
-- for every function (the sat schema is deny-by-default for functions —
-- 20260521000000 revokes all on functions from anon/authenticated/public via
-- default privileges).
--
-- Security invariants (from the spec):
--   * sat.flag_needs_review is security definer, grant execute to service_role
--     ONLY (the auto-flagger runs from the daily-cron service-role path; students
--     must never trigger relabeling). It NEVER touches 'approved' (admin judgment
--     outranks the heuristic) and NEVER reverses (only an admin clears).
--   * The strict draw filter never WIDENS student access — it only EXCLUDES
--     needs_review items from scored test draws when p_strict is true.
--   * admin_review_queue v2 re-grants to service_role ONLY (never authenticated —
--     students must not enumerate suspect items).
--   * study_plans.timezone is length-checked in the column CHECK and shape-checked
--     at the RPC; it is used only inside Intl.DateTimeFormat in app code.
--
-- OVERLOAD-SAFETY (the load-bearing reason each of the three functions is
-- DROP+recreate, NOT create-or-replace):
--   * Adding a DEFAULTED parameter creates a NEW OVERLOAD, not a replacement. If
--     the old signature survives, PostgREST cannot disambiguate a named-argument
--     call that matches both candidates (PGRST203) and every call fails. So
--     draw_questions and upsert_study_plan are each dropped by their OLD exact
--     signature, then recreated with the new defaulted param appended, then
--     RE-GRANTED (a DROP loses the ACL).
--   * admin_review_queue v2 changes its RETURNS TABLE (adds review_status), which
--     CREATE OR REPLACE forbids — DROP + recreate + re-grant.

-- ---------------------------------------------------------------------------
-- A.1 sat.questions.review_status — the content-trust gate. Orthogonal to
-- `enabled` (which stays the kill switch). 'active' (default) = drawable
-- everywhere; 'approved' = admin-blessed, drawable everywhere; 'needs_review' =
-- EXCLUDED from scored test draws (strict), still served by drills.
--
-- The partial index covers only non-'active' rows: review_status is a
-- low-cardinality column and only the small suspect/approved tail is ever
-- filtered on (the strict draw filter and the admin views).
-- ---------------------------------------------------------------------------

alter table sat.questions
  add column if not exists review_status text not null default 'active'
    check (review_status in ('active','approved','needs_review'));

create index if not exists sat_questions_review_status_idx
  on sat.questions (review_status)
  where review_status <> 'active';

-- ---------------------------------------------------------------------------
-- A.2 sat.flag_needs_review — the auto-flagger. security DEFINER, grant execute
-- to service_role ONLY (runs from the daily-cron service-role path beside
-- calibrate_difficulty; students must never trigger relabeling).
--
-- Sets review_status 'active' -> 'needs_review' for ENABLED questions that match
-- the admin_review_queue criteria:
--   * open_flags >= 2 (via sat.question_flags status='open'), OR
--   * n >= 10 AND p < 0.15, OR
--   * n >= 10 AND p > 0.97
-- where n/p come from the calibration union-aggregate shape (attempt_responses
-- UNION ALL practice_responses, grouped by question_id, p = correct-rate) — the
-- same shape admin_review_queue uses.
--
-- NEVER touches 'approved' (the WHERE guard is `review_status = 'active'`, so an
-- admin-blessed item is immune to the heuristic) and NEVER reverses (it only
-- moves active -> needs_review; clearing back to active is an admin action).
-- Idempotent: a second run finds no 'active' rows still matching that it already
-- moved, so it returns 0. Returns the count updated.
-- ---------------------------------------------------------------------------

create or replace function sat.flag_needs_review()
returns int
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_count int;
begin
  with graded as (
    -- per-question graded counts across BOTH response tables (the
    -- calibration union-aggregate shape).
    select
      s.question_id,
      count(*)                             as n,
      count(*) filter (where s.is_correct) as correct
    from (
      select ar.question_id, ar.is_correct
      from sat.attempt_responses ar
      union all
      select pr.question_id, pr.is_correct
      from sat.practice_responses pr
    ) s
    group by s.question_id
  ),
  flags as (
    -- open-flag counts per question.
    select f.question_id, count(*) as open_flags
    from sat.question_flags f
    where f.status = 'open'
    group by f.question_id
  ),
  suspect as (
    select q.id
    from sat.questions q
    left join graded g on g.question_id = q.id
    left join flags  fl on fl.question_id = q.id
    where q.enabled
      and q.review_status = 'active'
      and (
        coalesce(fl.open_flags, 0) >= 2
        or (coalesce(g.n, 0) >= 10 and (g.correct::numeric / nullif(g.n, 0)) < 0.15)
        or (coalesce(g.n, 0) >= 10 and (g.correct::numeric / nullif(g.n, 0)) > 0.97)
      )
  )
  update sat.questions q
    set review_status = 'needs_review'
    where q.id in (select id from suspect);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- flag_needs_review: service_role ONLY (called from the daily-cron service-role
-- path; students must never trigger relabeling).
grant execute on function sat.flag_needs_review() to service_role;

-- ---------------------------------------------------------------------------
-- A.3 sat.draw_questions v3 — adds p_strict (default false). Because a defaulted
-- param is a NEW OVERLOAD (not a replacement), the old 5-arg version MUST be
-- dropped or PostgREST cannot disambiguate pool.ts's named-arg call (PGRST203).
-- DROP + recreate (full prior body from 20260615010000 — verified latest) with
-- exactly two added predicates: `and (not p_strict or q.review_status <>
-- 'needs_review')` in BOTH the fresh and recycled branches. Then RE-GRANT to the
-- ORIGINAL grantees `to authenticated, service_role` (a DROP loses the ACL).
--
-- Deploy-safety comes from the default: the not-yet-updated 5-named-arg client
-- resolves unambiguously to the single 6-arg function (p_strict defaults false).
-- ---------------------------------------------------------------------------

drop function sat.draw_questions(text, text, text[], text, int);

create or replace function sat.draw_questions(
  p_section    text,
  p_skill      text default null,
  p_skills     text[] default null,
  p_difficulty text default null,
  p_count      int  default 1,
  p_strict     boolean default false
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

  -- Fresh: unserved questions matching (section, skill?, skills?, difficulty?).
  select coalesce(array_agg(id), array[]::text[]) into v_ids from (
    select q.id from sat.questions q
    where q.section = p_section
      and q.enabled
      and (not p_strict or q.review_status <> 'needs_review')
      and (p_skill is null or q.skill = p_skill)
      and (p_skills is null or q.skill = any(p_skills))
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
        and (not p_strict or q.review_status <> 'needs_review')
        and (p_skill is null or q.skill = p_skill)
        and (p_skills is null or q.skill = any(p_skills))
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

-- DROP lost the ACL — RE-ISSUE the execute grant to the ORIGINAL grantees
-- (20260615010000 granted to authenticated, service_role).
grant execute on function sat.draw_questions(text, text, text[], text, int, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A.4 sat.admin_review_queue v2 — adds review_status to the output so the admin
-- queue/detail can show it. A RETURNS TABLE change forbids CREATE OR REPLACE, so
-- DROP + recreate + re-grant. review_status is added in BOTH places (the RETURNS
-- TABLE clause and the select projection `q.review_status`) or the recreate fails
-- to compile. Body otherwise verbatim from 20260707050000 (the v1).
--
-- Re-grant to service_role ONLY (never authenticated — students must never be
-- able to enumerate item-quality anomalies).
-- ---------------------------------------------------------------------------

drop function sat.admin_review_queue(int);

create or replace function sat.admin_review_queue(p_limit int default 50)
returns table (
  question_id   text,
  section       text,
  skill         text,
  difficulty    text,
  review_status text,
  n             bigint,
  p_value       numeric,
  open_flags    bigint,
  reasons       text[]
)
language sql
security definer
set search_path to ''
as $$
  with graded as (
    -- (a) per-question graded counts across BOTH response tables (the
    -- calibration union-aggregate shape).
    select
      s.question_id,
      count(*)                             as n,
      count(*) filter (where s.is_correct) as correct
    from (
      select ar.question_id, ar.is_correct
      from sat.attempt_responses ar
      union all
      select pr.question_id, pr.is_correct
      from sat.practice_responses pr
    ) s
    group by s.question_id
  ),
  flags as (
    -- (b) open-flag counts per question.
    select f.question_id, count(*) as open_flags
    from sat.question_flags f
    where f.status = 'open'
    group by f.question_id
  )
  select
    q.id                                        as question_id,
    q.section,
    q.skill,
    q.difficulty,
    q.review_status,
    coalesce(g.n, 0)                            as n,
    case
      when coalesce(g.n, 0) > 0
        then round(g.correct::numeric / g.n, 4)
      else null
    end                                         as p_value,
    coalesce(fl.open_flags, 0)                  as open_flags,
    array_remove(array[
      case when coalesce(fl.open_flags, 0) >= 2 then 'flagged' end,
      case
        when coalesce(g.n, 0) >= 10
          and (g.correct::numeric / nullif(g.n, 0)) < 0.15 then 'very-hard-suspect'
      end,
      case
        when coalesce(g.n, 0) >= 10
          and (g.correct::numeric / nullif(g.n, 0)) > 0.97 then 'too-easy'
      end
    ], null)                                    as reasons
  from sat.questions q
  left join graded g on g.question_id = q.id
  left join flags  fl on fl.question_id = q.id
  where q.enabled
    and (
      coalesce(fl.open_flags, 0) >= 2
      or (coalesce(g.n, 0) >= 10 and (g.correct::numeric / nullif(g.n, 0)) < 0.15)
      or (coalesce(g.n, 0) >= 10 and (g.correct::numeric / nullif(g.n, 0)) > 0.97)
    )
  order by coalesce(fl.open_flags, 0) desc, coalesce(g.n, 0) desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200);
$$;

-- admin_review_queue: service_role ONLY (never authenticated — students must
-- never be able to enumerate item-quality anomalies).
grant execute on function sat.admin_review_queue(int) to service_role;

-- ---------------------------------------------------------------------------
-- B.1 sat.study_plans.timezone — nullable IANA zone name, length-checked <= 64.
-- Captured from the browser (Intl.DateTimeFormat().resolvedOptions().timeZone)
-- so "this week" boundaries are computed in the student's own zone (Vercel
-- servers run UTC).
-- ---------------------------------------------------------------------------

alter table sat.study_plans
  add column if not exists timezone text
    check (timezone is null or length(timezone) <= 64);

-- ---------------------------------------------------------------------------
-- B.2 sat.upsert_study_plan v2 — adds p_timezone (default null). Adding a
-- defaulted param is a NEW OVERLOAD, so the old 3-arg version MUST be dropped or
-- PostgREST cannot disambiguate the named-arg call (PGRST203). DROP + recreate +
-- re-grant (a DROP loses the ACL). Body verbatim from 20260707060000 (the v1)
-- plus: validate p_timezone (null, or a plausible IANA shape <= 64 chars; raise
-- on violation) and insert/update the timezone column.
-- ---------------------------------------------------------------------------

drop function sat.upsert_study_plan(int, date, int);

create or replace function sat.upsert_study_plan(
  p_target    int,
  p_test_date date,
  p_sessions  int,
  p_timezone  text default null
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
  if p_timezone is not null
     and not (length(p_timezone) <= 64
              and p_timezone ~ '^[A-Za-z_]+(/[A-Za-z_+-]+)+$|^UTC$') then
    raise exception 'invalid timezone: %', p_timezone;
  end if;

  insert into sat.study_plans (user_id, target_score, test_date, sessions_per_week, timezone)
  values (v_user, p_target, p_test_date, p_sessions, p_timezone)
  on conflict (user_id) do update set
    target_score      = excluded.target_score,
    test_date         = excluded.test_date,
    sessions_per_week = excluded.sessions_per_week,
    timezone          = excluded.timezone,
    updated_at        = now();
end;
$$;

-- DROP lost the ACL — RE-ISSUE the execute grant to authenticated (the original
-- grantee in 20260707060000).
grant execute on function sat.upsert_study_plan(int, date, int, text) to authenticated;

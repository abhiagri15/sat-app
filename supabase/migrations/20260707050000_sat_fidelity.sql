-- Fidelity & Resilience Pack (#17), Migration A: the explanation cache
-- (sat.mistake_explanations) + the admin needs-review queue RPC
-- (sat.admin_review_queue).
--
-- See docs/superpowers/specs/2026-07-07-fidelity-resilience-design.md
-- (sections C and D) and docs/superpowers/plans/2026-07-07-gaps-closure-plan.md
-- (Task 1).
--
-- House style follows 20260707040000_sat_parity.sql: RLS select-only (or
-- policy-less) tables, writes via the service-role client in server code,
-- security-definer only where the read/write must escape RLS, and an explicit
-- `grant execute` for every function (the sat schema is deny-by-default for
-- functions — 20260521000000 revokes all on functions from
-- anon/authenticated/public via default privileges).
--
-- Security invariants (from the spec):
--   * sat.mistake_explanations is shared content: RLS select-for-authenticated
--     (the sat.skill_lessons posture), NO write policy — the only writer is the
--     service-role client in app/lib/practice/generation.ts.
--   * admin_review_queue is grant-execute to service_role ONLY — it is called
--     via the service client from admin code and must not be callable by
--     students at all. It is a computed queue: no lifecycle columns, no gating
--     of draws (the full approved_for_scored_tests gate stays deferred).

-- ---------------------------------------------------------------------------
-- C. sat.mistake_explanations — cached "Explain my mistake" analyses.
-- One row per (question_id, chosen_key): chosen_key is a content-stable
-- normalization of the student's specific wrong answer (mcq → the chosen
-- choice TEXT trimmed/lowercased/ws-collapsed; spr → the parseSpr canonical or
-- trimmed raw), computed by the mistakeKey helper in
-- app/lib/ai/explanation-schema.ts. The PK is what keeps identical wrong-answer
-- text on DIFFERENT questions separate; the content-stable key is what makes a
-- hit survive per-test choice shuffles.
--
-- RLS: select-for-authenticated (using (true)) — the content is shared, not
-- per-user (the sat.skill_lessons posture). NO write policy: the only writer is
-- the service-role client in explainForUser (writes only trusted-live inputs).
-- ---------------------------------------------------------------------------

create table sat.mistake_explanations (
  question_id text not null,
  chosen_key  text not null,
  explanation text not null,
  takeaway    text not null,
  model       text not null,
  created_at  timestamptz not null default now(),
  primary key (question_id, chosen_key)
);

alter table sat.mistake_explanations enable row level security;

create policy mistake_explanations_select_auth on sat.mistake_explanations
  for select to authenticated using (true);

grant select on sat.mistake_explanations to authenticated;
grant all on sat.mistake_explanations to service_role;

-- ---------------------------------------------------------------------------
-- D. sat.admin_review_queue — the computed needs-review queue for admins.
-- security DEFINER, grant execute to service_role ONLY (called via the service
-- client from admin code; not callable by students at all). It is NOT a
-- lifecycle state machine — no new columns, no gating of draws — the queue is
-- computed on read.
--
-- Returns one row per ENABLED question that qualifies on ANY of:
--   * open_flags >= 2
--   * n >= 10 AND p < 0.15  → reason 'very-hard-suspect'
--   * n >= 10 AND p > 0.97  → reason 'too-easy'
-- ordered by open_flags desc, then n desc.
--
-- Shape note (from the spec): this is NOT one grouped scan. It COMBINES
--   (a) "questions with >= 1 graded response" — the calibration union-aggregate
--       shape (attempt_responses UNION ALL practice_responses, grouped by
--       question_id, p = correct-rate), a LEFT join so a flag-only question with
--       n = 0 still appears, and
--   (b) "questions with >= 1 open flag" — a LEFT-joined open-flags-count
--       subquery.
-- A question can qualify on flags alone with n = 0 (its p_value is then null).
-- reasons is assembled with array_remove(array[...], null) so only the reasons
-- that actually fired are present. The having-clause is the OR of the three
-- qualifying predicates.
-- ---------------------------------------------------------------------------

create or replace function sat.admin_review_queue(p_limit int default 50)
returns table (
  question_id text,
  section     text,
  skill       text,
  difficulty  text,
  n           bigint,
  p_value     numeric,
  open_flags  bigint,
  reasons     text[]
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

-- ---------------------------------------------------------------------------
-- Grants. The sat schema is deny-by-default for functions (20260521000000
-- revokes all on functions from anon/authenticated/public via default
-- privileges) — every new function needs an explicit execute grant.
--
-- admin_review_queue: service_role ONLY (called via the service client from
-- admin code; students must never be able to enumerate item-quality anomalies).
-- ---------------------------------------------------------------------------

grant execute on function sat.admin_review_queue(int) to service_role;

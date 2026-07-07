-- Dynamic Practice sub-project (#14): AI base lessons (shared, cached),
-- per-student "Coach's update" guidance, post-drill targeted top-up, and an
-- adaptive-difficulty draw_drill v2. Extends #13 (20260707000000_sat_practice).
--
-- See docs/superpowers/specs/2026-07-07-dynamic-practice-design.md (sections
-- A–D) and docs/superpowers/plans/2026-07-07-dynamic-practice-plan.md (Task 1).
--
-- House style follows 20260707000000_sat_practice.sql: RLS select-only, writes
-- via the service-role client in server code, security-definer only where the
-- read needs to escape RLS (served_questions), security-invoker elsewhere, and
-- an explicit `grant execute` for every function (the sat schema is
-- deny-by-default for functions — 20260521000000 revokes all on functions from
-- anon/authenticated/public via default privileges).

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A. sat.skill_lessons — one AI-generated lesson per skill, shared and cached.
-- Content is shared (not per-user), so the select policy is any-authenticated
-- (using (true)); there is intentionally NO write policy — the only writer is
-- the service-role client in app/lib/practice/generation.ts.
create table sat.skill_lessons (
  skill        text primary key,
  content      jsonb not null,                 -- exact Lesson shape (app/lib/lessons/types.ts)
  model        text not null,
  generated_at timestamptz not null default now()
);

alter table sat.skill_lessons enable row level security;

create policy skill_lessons_select_auth on sat.skill_lessons
  for select to authenticated using (true);

grant select on sat.skill_lessons to authenticated;
grant all on sat.skill_lessons to service_role;

-- B. sat.skill_guidance — per-student "Coach's update", one row per (user, skill).
-- based_on_latest is the watermark: the timestamp of the newest response the
-- generation saw. RLS: select-own; writes service-role only (no write policy).
create table sat.skill_guidance (
  user_id         uuid not null references auth.users (id) on delete cascade,
  skill           text not null,
  content         jsonb not null,
  model           text not null,
  based_on_latest timestamptz not null,
  generated_at    timestamptz not null default now(),
  primary key (user_id, skill)
);

alter table sat.skill_guidance enable row level security;

create policy skill_guidance_select_own on sat.skill_guidance
  for select to authenticated using (user_id = (select auth.uid()));

grant select on sat.skill_guidance to authenticated;
grant all on sat.skill_guidance to service_role;

-- C. sat.practice_topups — service-role-only log of top-up runs (rate-cap trail).
-- RLS on, NO policies at all: with RLS on and no policy, the anon/authenticated
-- role can neither read nor write it; only the service role (BYPASSRLS) touches
-- it, from app/lib/practice/generation.ts. Same posture as sat.question_flags.
create table sat.practice_topups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  skill      text not null,
  created_at timestamptz not null default now(),
  inserted   int  not null default 0
);

create index practice_topups_user_skill_created_idx
  on sat.practice_topups (user_id, skill, created_at desc);

alter table sat.practice_topups enable row level security;

grant all on sat.practice_topups to service_role;

-- ---------------------------------------------------------------------------
-- sat.unseen_count_for_skill — enabled questions of a skill the caller has not
-- been served. security DEFINER: it must read sat.served_questions across the
-- caller's rows and needs to escape the served_select_own RLS scoping to count
-- accurately (mirrors the draw RPCs' definer posture). Sets user_id itself via
-- auth.uid() — the client never supplies it.
-- ---------------------------------------------------------------------------

create or replace function sat.unseen_count_for_skill(p_skill text)
returns int
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_n    int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_skill is null then
    raise exception 'p_skill required';
  end if;

  select count(*)::int into v_n
  from sat.questions q
  where q.skill = p_skill
    and q.enabled
    and not exists (
      select 1 from sat.served_questions s
      where s.user_id = v_user and s.question_id = q.id);

  return coalesce(v_n, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- sat.skill_latest_response — the newest response timestamp for the signed-in
-- user in a skill, across both response tables. security INVOKER (the
-- user_analytics / practice_skill_stats precedent): it reads only RLS-scoped
-- tables, so RLS confines it to the caller; it keeps the explicit
-- user_id = auth.uid() filter as a clarity backstop. Neither response table
-- stores a per-row timestamp, so the parent row's created_at is used (the same
-- union-with-parent-timestamp shape draw_drill Tier 1 uses).
-- ---------------------------------------------------------------------------

create or replace function sat.skill_latest_response(p_skill text)
returns timestamptz
language sql
security invoker
set search_path to ''
as $$
  select max(answered_at)
  from (
    select ta.created_at as answered_at
    from sat.attempt_responses ar
    join sat.test_attempts ta on ta.id = ar.attempt_id
    where ar.user_id = (select auth.uid())
      and ar.skill = p_skill
    union all
    select ps.created_at as answered_at
    from sat.practice_responses pr
    join sat.practice_sessions ps on ps.id = pr.session_id
    where pr.user_id = (select auth.uid())
      and pr.skill = p_skill
  ) t;
$$;

-- ---------------------------------------------------------------------------
-- sat.skill_evidence — the caller's most recent responses for a skill across
-- both response tables, for the guidance prompt. security INVOKER (same
-- precedent as above): RLS on the response tables does the scoping; the
-- explicit user_id = auth.uid() filter is a clarity backstop.
--
-- Neither response table stores difficulty — it comes from a LEFT join to
-- sat.questions by question_id (sat.questions is select-for-authenticated, so
-- the join is fine under invoker). The join is LEFT because a response can
-- outlive its question row (question_id has no FK back to sat.questions), so
-- difficulty CAN be null here even though sat.questions.difficulty is
-- not-null — the guidance prompt simply omits the difficulty tag for such a
-- line. Timestamp comes from the parent row (test_attempts / practice_sessions
-- created_at). origin distinguishes 'test' vs 'practice'. Newest first, limit
-- least(p_limit, 25).
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- draw_drill v2 — adaptive difficulty. CREATE OR REPLACE, same signature as v1
-- (20260707000000_sat_practice). PRESERVED from v1 exactly: enabled-only,
-- de-dup via v_ids, the served_questions upsert, and array_position return
-- ordering (missed first). Tier 1 (currently-missed, capped at half) is
-- UNCHANGED and DIFFICULTY-AGNOSTIC — review is review; the student's actual
-- misses are drawn regardless of difficulty.
--
-- NEW in v2: rolling accuracy (last 20 responses for user+skill via the
-- union-with-parent-timestamp shape, computed ONCE up front) selects a
-- difficulty band. The band's easy/med/hard percentages are applied as
-- largest-remainder sub-quotas over v_rem (= v_count - Tier-1 fill). Tier 2
-- (fresh) fills each difficulty per its sub-quota, then Tier-2 remainder
-- any-difficulty; Tier 3 (recycled by served_at asc) then fills any remaining
-- slots. Tier 3 is kept DIFFICULTY-AGNOSTIC on purpose — the spec's
-- "sub-quotas over tiers 2/3 with free cross-difficulty fallback" allows it and
-- it is simpler; the sub-quotas shape the fresh draw where it matters most.
-- Never returns more than v_count; never double-selects an id.
-- ---------------------------------------------------------------------------

create or replace function sat.draw_drill(p_skill text, p_count int default 10)
returns setof sat.questions
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user       uuid := (select auth.uid());
  v_count      int  := least(greatest(coalesce(p_count, 0), 1), 30);
  v_missed_cap int;
  v_ids        text[];
  v_rem        int;
  -- rolling accuracy inputs
  v_total      int;
  v_correct    int;
  v_acc        numeric;   -- 0..100, null when < 5 responses of history
  -- band percentages (easy / med / hard), summing to 100
  v_pe         int;
  v_pm         int;
  v_ph         int;
  -- integer sub-quotas over v_rem
  v_qe         int;
  v_qm         int;
  v_qh         int;
  -- largest-remainder bookkeeping
  v_re         numeric;
  v_rm         numeric;
  v_rh         numeric;
  v_floor_sum  int;
  v_extra      int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_skill is null then
    raise exception 'p_skill required';
  end if;
  v_missed_cap := ceil(v_count / 2.0)::int;

  -- Tier 1: currently-missed (latest answer wrong), most recent miss first.
  -- Difficulty-agnostic — unchanged from v1.
  select coalesce(array_agg(id), array[]::text[]) into v_ids from (
    select q.id
    from sat.questions q
    join lateral (
      select r.is_correct, r.answered_at
      from (
        select ar.is_correct, ta.created_at as answered_at
        from sat.attempt_responses ar
        join sat.test_attempts ta on ta.id = ar.attempt_id
        where ar.user_id = v_user and ar.question_id = q.id
        union all
        select pr.is_correct, ps.created_at as answered_at
        from sat.practice_responses pr
        join sat.practice_sessions ps on ps.id = pr.session_id
        where pr.user_id = v_user and pr.question_id = q.id
      ) r
      order by r.answered_at desc
      limit 1
    ) latest on true
    where q.skill = p_skill
      and q.enabled
      and latest.is_correct = false
    order by latest.answered_at desc
    limit v_missed_cap
  ) missed;

  -- Rolling accuracy over the last 20 responses for (user, skill), across both
  -- response tables, ordered by the parent-row timestamp. Computed ONCE.
  select
    count(*)::int,
    count(*) filter (where w.is_correct)::int
    into v_total, v_correct
  from (
    select r.is_correct
    from (
      select ar.is_correct, ta.created_at as answered_at
      from sat.attempt_responses ar
      join sat.test_attempts ta on ta.id = ar.attempt_id
      where ar.user_id = v_user and ar.skill = p_skill
      union all
      select pr.is_correct, ps.created_at as answered_at
      from sat.practice_responses pr
      join sat.practice_sessions ps on ps.id = pr.session_id
      where pr.user_id = v_user and pr.skill = p_skill
    ) r
    order by r.answered_at desc
    limit 20
  ) w;

  -- Fewer than 5 responses of history → treat as the balanced band.
  if v_total < 5 then
    v_acc := null;
  else
    v_acc := (v_correct::numeric / v_total) * 100;
  end if;

  -- Bands (percentages over the REMAINING count after Tier 1):
  --   < 50%          → easy-leaning   50 / 35 / 15
  --   50–75% or none → balanced       25 / 50 / 25
  --   > 75%          → hard-leaning   10 / 35 / 55
  if v_acc is not null and v_acc < 50 then
    v_pe := 50; v_pm := 35; v_ph := 15;
  elsif v_acc is not null and v_acc > 75 then
    v_pe := 10; v_pm := 35; v_ph := 55;
  else
    v_pe := 25; v_pm := 50; v_ph := 25;
  end if;

  -- Remaining slots to fill after Tier 1.
  v_rem := v_count - coalesce(array_length(v_ids, 1), 0);
  if v_rem < 0 then v_rem := 0; end if;

  -- Largest-remainder split of v_rem into easy/med/hard sub-quotas. Each bucket
  -- gets floor(pct * v_rem / 100); the v_extra leftover slots (0..2, since the
  -- three percentages sum to 100) go one each to the buckets with the largest
  -- fractional remainders. v_re/v_rm/v_rh hold ONLY the fractional part; a bucket
  -- that wins a leftover has its remainder zeroed so it cannot win twice, and
  -- ties break deterministically in easy → med → hard order.
  v_qe := floor(v_pe::numeric * v_rem / 100)::int;
  v_qm := floor(v_pm::numeric * v_rem / 100)::int;
  v_qh := floor(v_ph::numeric * v_rem / 100)::int;
  v_re := (v_pe::numeric * v_rem / 100) - v_qe;
  v_rm := (v_pm::numeric * v_rem / 100) - v_qm;
  v_rh := (v_ph::numeric * v_rem / 100) - v_qh;
  v_floor_sum := v_qe + v_qm + v_qh;
  v_extra := v_rem - v_floor_sum;
  while v_extra > 0 loop
    if v_re >= v_rm and v_re >= v_rh then
      v_qe := v_qe + 1; v_re := -1;   -- zero out (any negative) so it can't win again
    elsif v_rm >= v_rh then
      v_qm := v_qm + 1; v_rm := -1;
    else
      v_qh := v_qh + 1; v_rh := -1;
    end if;
    v_extra := v_extra - 1;
  end loop;

  -- Tier 2 (fresh, never served): per-difficulty sub-quota, random within
  -- difficulty. Each difficulty capped so the running total never exceeds
  -- v_count and no id is double-selected.
  if coalesce(array_length(v_ids, 1), 0) < v_count and v_qe > 0 then
    select v_ids || coalesce(array_agg(id), array[]::text[]) into v_ids from (
      select q.id from sat.questions q
      where q.skill = p_skill
        and q.enabled
        and q.difficulty = 'easy'
        and not (q.id = any(v_ids))
        and not exists (
          select 1 from sat.served_questions s
          where s.user_id = v_user and s.question_id = q.id)
      order by random()
      limit least(v_qe, v_count - coalesce(array_length(v_ids, 1), 0))
    ) fe;
  end if;

  if coalesce(array_length(v_ids, 1), 0) < v_count and v_qm > 0 then
    select v_ids || coalesce(array_agg(id), array[]::text[]) into v_ids from (
      select q.id from sat.questions q
      where q.skill = p_skill
        and q.enabled
        and q.difficulty = 'medium'
        and not (q.id = any(v_ids))
        and not exists (
          select 1 from sat.served_questions s
          where s.user_id = v_user and s.question_id = q.id)
      order by random()
      limit least(v_qm, v_count - coalesce(array_length(v_ids, 1), 0))
    ) fm;
  end if;

  if coalesce(array_length(v_ids, 1), 0) < v_count and v_qh > 0 then
    select v_ids || coalesce(array_agg(id), array[]::text[]) into v_ids from (
      select q.id from sat.questions q
      where q.skill = p_skill
        and q.enabled
        and q.difficulty = 'hard'
        and not (q.id = any(v_ids))
        and not exists (
          select 1 from sat.served_questions s
          where s.user_id = v_user and s.question_id = q.id)
      order by random()
      limit least(v_qh, v_count - coalesce(array_length(v_ids, 1), 0))
    ) fh;
  end if;

  -- Tier 2 remainder: fresh, ANY difficulty — fills sub-quotas a difficulty
  -- cell couldn't (free cross-difficulty fallback).
  if coalesce(array_length(v_ids, 1), 0) < v_count then
    select v_ids || coalesce(array_agg(id), array[]::text[]) into v_ids from (
      select q.id from sat.questions q
      where q.skill = p_skill
        and q.enabled
        and not (q.id = any(v_ids))
        and not exists (
          select 1 from sat.served_questions s
          where s.user_id = v_user and s.question_id = q.id)
      order by random()
      limit v_count - coalesce(array_length(v_ids, 1), 0)
    ) fresh;
  end if;

  -- Tier 3: recycled — least recently served, ANY difficulty.
  if coalesce(array_length(v_ids, 1), 0) < v_count then
    select v_ids || coalesce(array_agg(id), array[]::text[]) into v_ids from (
      select q.id
      from sat.questions q
      join sat.served_questions s
        on s.question_id = q.id and s.user_id = v_user
      where q.skill = p_skill
        and q.enabled
        and not (q.id = any(v_ids))
      order by s.served_at asc
      limit v_count - coalesce(array_length(v_ids, 1), 0)
    ) recycled;
  end if;

  insert into sat.served_questions (user_id, question_id, served_at)
  select v_user, unnest(v_ids), now()
  on conflict (user_id, question_id) do update set served_at = excluded.served_at;

  return query
    select * from sat.questions q
    where q.id = any(v_ids)
    order by array_position(v_ids, q.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. The sat schema is deny-by-default for functions (20260521000000
-- revokes all on functions from anon/authenticated/public via default
-- privileges) — every new function needs an explicit execute grant or the app
-- gets "permission denied".
-- ---------------------------------------------------------------------------

grant execute on function sat.unseen_count_for_skill(text) to authenticated;
grant execute on function sat.skill_latest_response(text) to authenticated;
grant execute on function sat.skill_evidence(text, int) to authenticated;

-- draw_drill(text, int) is re-created via CREATE OR REPLACE, which PRESERVES
-- the existing ACLs from 20260707000000_sat_practice — so no re-grant is needed
-- here (it stays executable by authenticated). Left un-granted deliberately.

-- Practice sub-project (#13): drill sessions/responses, missed-first drill
-- draw, transactional save with server-side re-verification, per-skill stats.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table sat.practice_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  session_uuid uuid not null,
  section      text not null check (section in ('rw', 'math')),
  skill        text not null,
  total        int  not null check (total >= 0),
  correct      int  not null check (correct >= 0 and correct <= total),
  created_at   timestamptz not null default now(),
  unique (user_id, session_uuid)
);

create index practice_sessions_user_skill_idx
  on sat.practice_sessions (user_id, skill, created_at desc);

alter table sat.practice_sessions enable row level security;

create policy practice_sessions_select_own on sat.practice_sessions
  for select to authenticated using (user_id = (select auth.uid()));

-- Snapshot-as-presented, mirroring sat.attempt_responses (minus module/section
-- naming): the review must show what the student saw, shuffled order included.
create table sat.practice_responses (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references sat.practice_sessions (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  position         int  not null,
  question_id      text not null,
  skill            text not null,
  source           text not null,
  passage          text,
  prompt           text not null,
  choices          jsonb not null default '[]'::jsonb,
  answer_index     int  not null,
  explanation      text not null,
  chosen_index     int  not null,
  is_correct       boolean not null,
  response_format  text not null default 'mcq' check (response_format in ('mcq', 'spr')),
  entered_value    text,
  correct_answer   text,
  answer_tolerance numeric
);

create index practice_responses_user_q_idx
  on sat.practice_responses (user_id, question_id);
create index practice_responses_session_idx
  on sat.practice_responses (session_id, position);

alter table sat.practice_responses enable row level security;

create policy practice_responses_select_own on sat.practice_responses
  for select to authenticated using (user_id = (select auth.uid()));

-- Select for users; full access for the service role (Foundation grants
-- gotcha: BYPASSRLS does not confer schema/table privileges).
grant select on sat.practice_sessions, sat.practice_responses to authenticated;
grant all on sat.practice_sessions, sat.practice_responses to service_role;

-- ---------------------------------------------------------------------------
-- draw_drill: missed-first drill draw. Tier 1 = currently-missed (the user's
-- LATEST recorded answer for the question was wrong, across tests and
-- practice), capped at half the drill. Tier 2 = fresh (never served). Tier 3 =
-- recycled (least recently served). Everything returned is upserted into
-- served_questions so later tests never treat drilled material as unseen.
-- Return order is preserved (missed first) via array_position.
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
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_skill is null then
    raise exception 'p_skill required';
  end if;
  v_missed_cap := ceil(v_count / 2.0)::int;

  -- Tier 1: currently-missed (latest answer wrong), most recent miss first.
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

  -- Tier 2: fresh — never served to this user.
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

  -- Tier 3: recycled — least recently served.
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
-- save_practice: transactional save. Idempotent on (user_id, session_uuid) —
-- the short-circuit runs BEFORE any insert, and a concurrent same-uuid race is
-- resolved in the unique_violation handler (same discipline as save_attempt).
-- Correctness is recomputed server-side: mcq from the snapshotted
-- chosen/answer indexes; spr by re-joining sat.questions for the canonical
-- (client-claimed isCorrect is ignored).
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
       response_format, entered_value, correct_answer, answer_tolerance)
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
       case when v_format = 'spr' then v_tolerance else null end);

    v_total := v_total + 1;
    if v_is_correct then v_correct := v_correct + 1; end if;
  end loop;

  update sat.practice_sessions ps
    set total = v_total, correct = v_correct
    where ps.id = v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- practice_skill_stats: read-only per-skill aggregates for the signed-in user.
-- SECURITY INVOKER on purpose (the user_analytics precedent): it reads only
-- RLS-scoped tables, and keeps the explicit auth.uid() filter as a clarity
-- backstop. SQL-language, so no #variable_conflict concerns.
-- ---------------------------------------------------------------------------

create or replace function sat.practice_skill_stats()
returns table (
  skill          text,
  sessions       bigint,
  questions      bigint,
  correct        bigint,
  last_practiced timestamptz
)
language sql
security invoker
set search_path to ''
as $$
  select
    ps.skill,
    count(distinct ps.id)                          as sessions,
    count(pr.id)                                   as questions,
    count(pr.id) filter (where pr.is_correct)      as correct,
    max(ps.created_at)                             as last_practiced
  from sat.practice_sessions ps
  left join sat.practice_responses pr on pr.session_id = ps.id
  where ps.user_id = (select auth.uid())
  group by ps.skill
$$;

-- The sat schema is deny-by-default for functions (20260521000000 revokes all
-- on functions from anon/authenticated/public via default privileges) — every
-- RPC needs an explicit execute grant or the app gets "permission denied".
grant execute on function sat.draw_drill(text, int) to authenticated;
grant execute on function sat.save_practice(jsonb, jsonb) to authenticated;
grant execute on function sat.practice_skill_stats() to authenticated, service_role;

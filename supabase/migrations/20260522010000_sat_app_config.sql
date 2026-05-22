-- Daily-attempt-limit feature — app-wide config + save_attempt enforcement.

-- ---- sat.app_config: a single-row table of app-wide settings ------------
create table if not exists sat.app_config (
  id                  int  primary key default 1 check (id = 1),
  daily_attempt_limit int  not null default 5 check (daily_attempt_limit >= 0),
  updated_at          timestamptz not null default now()
);
insert into sat.app_config (id) values (1) on conflict (id) do nothing;

alter table sat.app_config enable row level security;

-- Readable by any signed-in user — the test screen must know the limit.
-- No write policy: admins update it through the service-role client. The
-- explicit grant is required for the select policy to function.
create policy "app_config_select" on sat.app_config
  for select to authenticated using (true);
grant select on sat.app_config to authenticated;

-- ---- save_attempt: enforce the per-user daily attempt limit -------------
-- Recreated verbatim from 20260521050000_sat_test_attempts.sql, with a daily
-- limit check added before the inserts. The UI Start screen is the primary
-- gate; this is the airtight backstop (e.g. against multi-tab races).
create or replace function sat.save_attempt(p_attempt jsonb, p_responses jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_id    uuid;
  v_limit int;
  v_today int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if jsonb_array_length(p_responses) = 0 then
    raise exception 'no responses';
  end if;

  -- per-user daily attempt limit (UTC calendar day)
  select daily_attempt_limit into v_limit from sat.app_config where id = 1;
  v_limit := coalesce(v_limit, 5);
  select count(*) into v_today
  from sat.test_attempts
  where user_id = v_user and created_at >= current_date;
  if v_today >= v_limit then
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

  insert into sat.attempt_responses (
    attempt_id, user_id, section_key, section_name, position,
    question_id, skill, source, passage, prompt, choices,
    answer_index, explanation, chosen_index, is_correct
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
    (r ->> 'chosenIndex')::int,
    (r ->> 'isCorrect')::boolean
  from jsonb_array_elements(p_responses) as r;

  return v_id;
end;
$$;

grant execute on function sat.save_attempt(jsonb, jsonb) to authenticated;

-- supabase/migrations/20260615010000_sat_draw_questions_skills.sql
--
-- Domain-weighted full-test assembly: extend sat.draw_questions with an
-- optional p_skills text[] filter so the client can draw a quota restricted to
-- a content domain's skills (the skill->domain map lives only in app code —
-- app/lib/questions.ts SKILL_DOMAIN — and is passed in as a skill list, so
-- there is no SQL-side domain copy to drift).
--
-- Drop+recreate (the adaptive migration set the precedent). p_skill is kept for
-- back-compat. Both the fresh and recycle queries gain the array filter.
--
-- DEPLOY-SAFE ORDERING: PostgREST resolves by named arguments, so the currently
-- deployed client (which omits p_skills) still matches this new signature
-- (p_skills defaults to null). Apply this migration first, deploy the code after.

drop function if exists sat.draw_questions(text, text, text, int);

create or replace function sat.draw_questions(
  p_section    text,
  p_skill      text default null,
  p_skills     text[] default null,
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

  -- Fresh: unserved questions matching (section, skill?, skills?, difficulty?).
  select coalesce(array_agg(id), array[]::text[]) into v_ids from (
    select q.id from sat.questions q
    where q.section = p_section
      and q.enabled
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

grant execute on function sat.draw_questions(text, text, text[], text, int)
  to authenticated, service_role;

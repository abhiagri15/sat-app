-- Analytics sub-project — per-user skill/section accuracy aggregation.
-- security invoker: runs as the caller, so RLS on attempt_responses scopes the
-- rows; the explicit user_id filter is a clarity backstop. Read-only.
create or replace function sat.user_analytics()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_skills jsonb;
  v_sections jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select coalesce(jsonb_agg(r order by r->>'section', r->>'skill'), '[]'::jsonb)
    into v_skills
  from (
    select jsonb_build_object(
      'section', section_key,
      'skill',   skill,
      'total',   count(*),
      'correct', count(*) filter (where is_correct)
    ) as r
    from sat.attempt_responses
    where user_id = v_user
    group by section_key, skill
  ) s;

  select coalesce(jsonb_agg(r order by r->>'section'), '[]'::jsonb)
    into v_sections
  from (
    select jsonb_build_object(
      'section', section_key,
      'total',   count(*),
      'correct', count(*) filter (where is_correct)
    ) as r
    from sat.attempt_responses
    where user_id = v_user
    group by section_key
  ) s;

  return jsonb_build_object('skills', v_skills, 'sections', v_sections);
end;
$$;

grant execute on function sat.user_analytics() to authenticated;

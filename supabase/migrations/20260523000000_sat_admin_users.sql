-- Admin-side user listing + per-user analytics.
--
-- Both functions are security-definer (so they can read across all users
-- regardless of RLS) and check internally that the caller's sat.profiles.role
-- is 'admin'. Non-admin callers get a "not authorized" exception. This means
-- the functions are safe to grant to authenticated and gate at the SQL layer,
-- in addition to the layout-level requireAdmin() gate already in place.

create or replace function sat.admin_users_summary()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
begin
  select role into v_caller_role from sat.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'not authorized';
  end if;

  return (
    select coalesce(
      jsonb_agg(
        r order by
          (r->>'last_activity') desc nulls last,
          (r->>'created_at') desc
      ),
      '[]'::jsonb
    )
    from (
      select jsonb_build_object(
        'id',               p.id,
        'email',            p.email,
        'full_name',        p.full_name,
        'role',             p.role,
        'created_at',       p.created_at,
        'tests_taken',      coalesce(s.tests_taken, 0),
        'avg_scaled_score', s.avg_scaled_score,
        'last_activity',    s.last_activity
      ) as r
      from sat.profiles p
      left join (
        select
          user_id,
          count(*)::int                     as tests_taken,
          round(avg(scaled_score))::int     as avg_scaled_score,
          max(created_at)                   as last_activity
        from sat.test_attempts
        group by user_id
      ) s on s.user_id = p.id
    ) x
  );
end;
$$;

create or replace function sat.admin_user_analytics(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
  v_skills jsonb;
  v_sections jsonb;
  v_trend jsonb;
begin
  select role into v_caller_role from sat.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'not authorized';
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
    where user_id = p_user_id
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
    where user_id = p_user_id
    group by section_key
  ) s;

  -- trend: oldest first for the chart's x-axis
  select coalesce(
    jsonb_agg(
      jsonb_build_object('date', created_at, 'score', scaled_score)
      order by created_at asc, id asc
    ),
    '[]'::jsonb
  )
    into v_trend
  from sat.test_attempts
  where user_id = p_user_id;

  return jsonb_build_object(
    'skills',   v_skills,
    'sections', v_sections,
    'trend',    v_trend
  );
end;
$$;

grant execute on function sat.admin_users_summary()        to authenticated;
grant execute on function sat.admin_user_analytics(uuid)   to authenticated;

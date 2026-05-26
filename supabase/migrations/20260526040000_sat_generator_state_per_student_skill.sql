-- Rewrite sat.generator_state() to surface PER-STUDENT, PER-SKILL unseen
-- counts. The floor now compares against worstStudentUnseen per skill, so the
-- generator replenishes a skill as soon as ANY active student's unseen count
-- for that skill drops below the floor.
--
-- Returned JSON shape:
--   minActiveUserUnseen: int | null    -- worst-off student's total unseen
--   neverServedFloor: int              -- admin-configurable per-skill floor
--   bufferTarget: int                  -- 100 (overall safety net)
--   skills: [{ section, skill, worstStudentUnseen }]
--   cells:  [{ section, skill, difficulty, worstStudentUnseen }]
--
-- worstStudentUnseen at the SKILL level is the min, across active students,
-- of that student's unseen count for the skill (across all difficulties).
-- At the CELL level it's the min across students of unseen count for that
-- exact (section, skill, difficulty).
--
-- "Active student" = sat.profiles row with >=1 sat.test_attempts row,
-- matching the long-standing sat.min_active_user_unseen() convention.
--
-- Only skills/cells that have at least one enabled question are listed;
-- consumers default missing cells to 0 against the canonical SKILLS x
-- difficulties cross product on their side.

create or replace function sat.generator_state()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with active as (
    select p.id as user_id
    from sat.profiles p
    where exists (select 1 from sat.test_attempts a where a.user_id = p.id)
  ),
  known_skills as (
    select distinct section, skill from sat.questions where enabled
  ),
  known_cells as (
    select distinct section, skill, difficulty from sat.questions where enabled
  ),
  user_total as (
    select a.user_id, (
      select count(*)::int
      from sat.questions q
      where q.enabled
        and not exists (
          select 1 from sat.served_questions s
          where s.user_id = a.user_id and s.question_id = q.id
        )
    ) as unseen
    from active a
  ),
  user_skill as (
    select a.user_id, ks.section, ks.skill, (
      select count(*)::int
      from sat.questions q
      where q.enabled
        and q.section = ks.section and q.skill = ks.skill
        and not exists (
          select 1 from sat.served_questions s
          where s.user_id = a.user_id and s.question_id = q.id
        )
    ) as unseen
    from active a
    cross join known_skills ks
  ),
  user_cell as (
    select a.user_id, kc.section, kc.skill, kc.difficulty, (
      select count(*)::int
      from sat.questions q
      where q.enabled
        and q.section = kc.section
        and q.skill = kc.skill
        and q.difficulty = kc.difficulty
        and not exists (
          select 1 from sat.served_questions s
          where s.user_id = a.user_id and s.question_id = q.id
        )
    ) as unseen
    from active a
    cross join known_cells kc
  )
  select jsonb_build_object(
    'minActiveUserUnseen', (select min(unseen) from user_total),
    'neverServedFloor', (select coalesce(never_served_floor, 5) from sat.app_config limit 1),
    'bufferTarget', 100,
    'skills', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'section', section,
        'skill', skill,
        'worstStudentUnseen', worst
      )), '[]'::jsonb)
      from (
        select section, skill, min(unseen)::int as worst
        from user_skill
        group by section, skill
      ) s
    ),
    'cells', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'section', section,
        'skill', skill,
        'difficulty', difficulty,
        'worstStudentUnseen', worst
      )), '[]'::jsonb)
      from (
        select section, skill, difficulty, min(unseen)::int as worst
        from user_cell
        group by section, skill, difficulty
      ) c
    )
  );
$$;

grant execute on function sat.generator_state() to authenticated, service_role;

-- Admin-configurable per-cell never-served floor. Replaces the hardcoded
-- SKILL_FLOOR=3 in the generators. When ANY (section, skill, difficulty) cell
-- drops below this threshold of *never-served* questions, the generator fires
-- and targets the thinnest cell.

alter table sat.app_config
  add column if not exists never_served_floor int not null default 5
    check (never_served_floor between 1 and 100);

-- Single RPC the generators call. Returns everything Plan Batches needs in
-- one round trip: per-user buffer, the configurable floor, and per-cell
-- never-served counts. Cells with zero never-served don't appear in the
-- array; consumers default missing cells to 0.
create or replace function sat.generator_state()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'minActiveUserUnseen', sat.min_active_user_unseen(),
    'neverServedFloor', (select coalesce(never_served_floor, 5) from sat.app_config limit 1),
    'bufferTarget', 100,
    'cells', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'section', section,
        'skill', skill,
        'difficulty', difficulty,
        'neverServed', cnt
      )), '[]'::jsonb)
      from (
        select q.section, q.skill, q.difficulty, count(*) as cnt
        from sat.questions q
        where q.enabled
          and not exists (
            select 1 from sat.served_questions s where s.question_id = q.id
          )
        group by q.section, q.skill, q.difficulty
      ) sub
    )
  );
$$;

grant execute on function sat.generator_state() to authenticated, service_role;

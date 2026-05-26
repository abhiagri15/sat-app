-- supabase/migrations/20260526160000_sat_public_pool_stats.sql
--
-- Returns aggregate, non-sensitive pool numbers safe for anonymous callers.
-- No per-skill detail, no worst-student data, no admin config — just headline
-- pool composition that the marketing /how-it-works page can quote.
--
-- Distinct from sat.generator_state(), which exposes operational metrics
-- (minActiveUserUnseen, per-skill worstStudentUnseen) that would leak how
-- many students are active.

create or replace function sat.public_pool_stats()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'totalEnabled',  (select count(*) from sat.questions where enabled),
    'rwCount',       (select count(*) from sat.questions where enabled and section = 'rw'),
    'mathCount',     (select count(*) from sat.questions where enabled and section = 'math'),
    'easyCount',     (select count(*) from sat.questions where enabled and difficulty = 'easy'),
    'mediumCount',   (select count(*) from sat.questions where enabled and difficulty = 'medium'),
    'hardCount',     (select count(*) from sat.questions where enabled and difficulty = 'hard'),
    'skillCount',    (select count(distinct (section, skill)) from sat.questions where enabled),
    'cells', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'section', section,
        'difficulty', difficulty,
        'count', cnt
      )), '[]'::jsonb)
      from (
        select section, difficulty, count(*) as cnt
        from sat.questions
        where enabled
        group by section, difficulty
      ) sub
    ),
    'lastRefreshed', (select max(created_at) from sat.questions where source = 'ai'),
    'asOf',          now()
  );
$$;

grant execute on function sat.public_pool_stats() to anon, authenticated, service_role;

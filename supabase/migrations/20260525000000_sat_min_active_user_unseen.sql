-- Per-user buffer gate for the question generator.
--
-- Returns the minimum "unseen enabled question count" across all active
-- students (those with ≥ 1 saved test attempt). Generation should fire
-- only when this number drops below the buffer target — that way new
-- students always get the full existing pool before the generator
-- produces more questions, and question utilization across the user
-- base is maximised.
--
-- Returns:
--   NULL  — no active students yet (no demand, caller should skip)
--   int   — the worst-off active student's unseen count
--
-- Security: definer (must aggregate across users; RLS on the underlying
-- tables would otherwise hide rows). Returns only a single integer, not
-- any per-user data — safe to grant to authenticated.

create or replace function sat.min_active_user_unseen()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min int;
begin
  select min(uncovered) into v_min
  from (
    select p.id, (
      select count(*)::int
      from sat.questions q
      where q.enabled
        and not exists (
          select 1
          from sat.served_questions s
          where s.user_id = p.id
            and s.question_id = q.id
        )
    ) as uncovered
    from sat.profiles p
    where exists (
      select 1 from sat.test_attempts a where a.user_id = p.id
    )
  ) active;
  return v_min;  -- NULL when no active users exist; caller treats NULL as "skip"
end;
$$;

grant execute on function sat.min_active_user_unseen() to authenticated, service_role;

-- Foundation sub-project — creates the `sat` schema with deny-by-default RLS.
-- Tables come with subsequent sub-projects:
--   sat.profiles          (Auth sub-project)
--   sat.questions         (AI sub-project)
--   sat.test_attempts     (Persistence sub-project)
--   sat.attempt_responses (Persistence sub-project)

create schema if not exists sat;

-- Deny-by-default for Supabase roles AND the implicit PUBLIC role,
-- so future SECURITY DEFINER functions don't inherit EXECUTE accidentally.
revoke all on schema sat from anon, authenticated, public;
grant usage on schema sat to anon, authenticated;

alter default privileges in schema sat
  revoke all on tables from anon, authenticated, public;
alter default privileges in schema sat
  revoke all on sequences from anon, authenticated, public;
alter default privileges in schema sat
  revoke all on functions from anon, authenticated, public;

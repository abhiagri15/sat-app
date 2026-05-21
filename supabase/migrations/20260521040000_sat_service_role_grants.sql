-- AI sub-project — grant the service_role access to the sat schema.
--
-- Foundation's sat-schema migration granted USAGE on `sat` to anon/authenticated
-- only. The service role — used server-side by the seed script and the question
-- generation endpoint to write sat.questions — also needs schema USAGE and table
-- privileges. The service_role's BYPASSRLS attribute bypasses row-level security
-- but does NOT grant schema/table privileges, so these grants are required.

grant usage on schema sat to service_role;
grant all on all tables in schema sat to service_role;
grant all on all sequences in schema sat to service_role;

alter default privileges in schema sat grant all on tables to service_role;
alter default privileges in schema sat grant all on sequences to service_role;

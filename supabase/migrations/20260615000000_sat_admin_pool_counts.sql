-- supabase/migrations/20260615000000_sat_admin_pool_counts.sql
--
-- Single-round-trip pool-count breakdown for the /admin Overview + Question
-- Pool headers. Mirrors sat.public_pool_stats(), but admin-scoped: it also
-- exposes total (incl. disabled), the disabled count, and the source (ai/seed)
-- split that the public marketing RPC deliberately omits.
--
-- Why this exists: the old getPoolCounts() fetched every row and tallied in JS.
-- PostgREST caps a plain select at `max-rows` (1000 by default), so once the
-- pool grew past 1000 the admin header silently showed Total=1000. A SQL
-- aggregate is exact regardless of pool size and is one round trip.
--
-- Not granted to anon (unlike public_pool_stats): disabled/ai/seed are internal
-- pool-composition figures. The /admin subtree is already requireAdmin()-gated;
-- this stays a non-sensitive aggregate (no per-user data), so it follows the
-- public_pool_stats shape rather than the role-checking admin_users_* RPCs.

create or replace function sat.admin_pool_counts()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'total',    count(*),
    'enabled',  count(*) filter (where enabled),
    'disabled', count(*) filter (where not enabled),
    'ai',       count(*) filter (where source = 'ai'),
    'seed',     count(*) filter (where source = 'seed'),
    'rw',       count(*) filter (where section = 'rw'),
    'math',     count(*) filter (where section = 'math')
  )
  from sat.questions;
$$;

grant execute on function sat.admin_pool_counts() to authenticated, service_role;

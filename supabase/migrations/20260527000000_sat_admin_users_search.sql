-- Admin Users at scale — search/filter/sort/paginate RPC + headline stats RPC.
--
-- Replaces sat.admin_users_summary() (single-shot, all rows) with
--   sat.admin_users_search(...)  — one page of rows + total_count (window agg)
--   sat.admin_users_stats()      — filter-independent headline numbers
--
-- Both functions are security-definer; both re-check the caller's role
-- ('admin') and raise 'not authorized' otherwise. Defense in depth on top of
-- the requireAdmin() gate in (app)/admin/layout.tsx.
--
-- pg_trgm is enabled here (first use in the project) to back substring
-- search via GIN indexes on lower(full_name) and lower(email).

create extension if not exists pg_trgm;

create index if not exists profiles_full_name_trgm
  on sat.profiles using gin (lower(full_name) gin_trgm_ops);

create index if not exists profiles_email_trgm
  on sat.profiles using gin (lower(email) gin_trgm_ops);

create index if not exists profiles_role_idx
  on sat.profiles (role);

create index if not exists profiles_role_created_at_idx
  on sat.profiles (role, created_at desc);

drop function if exists sat.admin_users_summary();

create or replace function sat.admin_users_search(
  p_q              text default '',
  p_role           text default 'all',
  p_activity       text default 'all',
  p_joined_days    int  default null,
  p_score_min      int  default null,
  p_score_max      int  default null,
  p_sort           text default 'last_active',
  p_dir            text default 'desc',
  p_offset         int  default 0,
  p_limit          int  default 25
)
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  created_at timestamptz,
  tests_taken int,
  avg_scaled_score int,
  last_activity timestamptz,
  total_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
  v_q text := lower(coalesce(p_q, ''));
  v_now timestamptz := now();
begin
  select role into v_caller_role from sat.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'not authorized';
  end if;

  if p_limit  is null or p_limit  < 1 or p_limit  > 100 then p_limit  := 25; end if;
  if p_offset is null or p_offset < 0                  then p_offset := 0;  end if;
  if p_dir not in ('asc','desc') then p_dir := 'desc'; end if;

  return query
  with agg as (
    select
      p.id,
      p.email,
      p.full_name,
      p.role,
      p.created_at,
      coalesce(t.tests_taken, 0)::int       as tests_taken,
      t.avg_scaled_score::int               as avg_scaled_score,
      t.last_activity                       as last_activity
    from sat.profiles p
    left join (
      select
        user_id,
        count(*)::int                       as tests_taken,
        round(avg(scaled_score))::int       as avg_scaled_score,
        max(created_at)                     as last_activity
      from sat.test_attempts
      group by user_id
    ) t on t.user_id = p.id
  ),
  filtered as (
    -- Substring search uses ILIKE (lower(col) like '%q%'). Users with a null
    -- email are silently excluded when a search term is present (lower(null)
    -- is null, null like ... is unknown); they appear normally otherwise.
    select *
    from agg a
    where
      (v_q = '' or lower(a.full_name) like '%'||v_q||'%' or lower(a.email) like '%'||v_q||'%')
      and (p_role = 'all' or a.role = p_role)
      and (
        p_activity = 'all'
        or (p_activity = 'active'   and a.last_activity >= v_now - interval '30 days')
        or (p_activity = 'inactive' and a.tests_taken >= 1 and a.last_activity < v_now - interval '30 days')
        or (p_activity = 'never'    and a.tests_taken = 0)
      )
      and (p_joined_days is null or a.created_at >= v_now - make_interval(days => p_joined_days))
      and (p_score_min is null or coalesce(a.avg_scaled_score, -1) >= p_score_min)
      and (p_score_max is null or coalesce(a.avg_scaled_score, 99999) <= p_score_max)
  )
  select
    f.id, f.email, f.full_name, f.role, f.created_at,
    f.tests_taken, f.avg_scaled_score, f.last_activity,
    count(*) over () as total_count
  from filtered f
  order by
    case when p_sort = 'name'        and p_dir = 'asc'  then lower(f.full_name) end asc nulls last,
    case when p_sort = 'name'        and p_dir = 'desc' then lower(f.full_name) end desc nulls last,
    case when p_sort = 'email'       and p_dir = 'asc'  then lower(f.email)     end asc nulls last,
    case when p_sort = 'email'       and p_dir = 'desc' then lower(f.email)     end desc nulls last,
    case when p_sort = 'role'        and p_dir = 'asc'  then f.role             end asc,
    case when p_sort = 'role'        and p_dir = 'desc' then f.role             end desc,
    case when p_sort = 'tests'       and p_dir = 'asc'  then f.tests_taken      end asc,
    case when p_sort = 'tests'       and p_dir = 'desc' then f.tests_taken      end desc,
    case when p_sort = 'avg_score'   and p_dir = 'asc'  then f.avg_scaled_score end asc nulls last,
    case when p_sort = 'avg_score'   and p_dir = 'desc' then f.avg_scaled_score end desc nulls last,
    case when p_sort = 'last_active' and p_dir = 'asc'  then f.last_activity    end asc nulls last,
    case when p_sort = 'last_active' and p_dir = 'desc' then f.last_activity    end desc nulls last,
    case when p_sort = 'joined'      and p_dir = 'asc'  then f.created_at       end asc,
    case when p_sort = 'joined'      and p_dir = 'desc' then f.created_at       end desc,
    f.id
  offset p_offset
  limit  p_limit;
end;
$$;

grant execute on function sat.admin_users_search(
  text, text, text, int, int, int, text, text, int, int
) to authenticated;

create or replace function sat.admin_users_stats()
returns table (
  total     int,
  students  int,
  admins    int,
  active    int,
  active_7d int
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller_role text;
  v_now timestamptz := now();
begin
  select role into v_caller_role from sat.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'not authorized';
  end if;

  return query
  with last_act as (
    select user_id, max(created_at) as last_activity
    from sat.test_attempts
    group by user_id
  )
  select
    count(*)::int                                                                  as total,
    count(*) filter (where p.role = 'student')::int                                as students,
    count(*) filter (where p.role = 'admin')::int                                  as admins,
    count(*) filter (where la.last_activity >= v_now - interval '30 days')::int    as active,
    count(*) filter (where la.last_activity >= v_now - interval '7 days')::int     as active_7d
  from sat.profiles p
  left join last_act la on la.user_id = p.id;
end;
$$;

grant execute on function sat.admin_users_stats() to authenticated;

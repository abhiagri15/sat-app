# SAT Prep — Admin Users Scalability Design

**Date:** 2026-05-27
**Status:** Approved for plan-writing
**Sub-project:** Admin Users — Scalability
**Builds on:** Admin (#6), Analytics (#5), Auth (#3)

---

## 1. Context

The Admin sub-project (#6) added `/admin/users`, a flat card list backed by the
`sat.admin_users_summary()` RPC. The RPC returns *all* users with their
aggregated stats; the page renders them at `max-w-3xl` with one fixed sort
(most-recently-active first) and no search, filter, or pagination. This works
at the current scale (tens of users) but degrades fast: every page load fetches
the whole table, every scan-and-find is manual, and there is no way to triage
"active vs. inactive vs. never-started" without eyeballing every row.

This sub-project makes the page scale gracefully to thousands of users by
pushing search, filter, sort, and pagination into a parameterized SQL RPC and
adding a thin client-side toolbar that drives the URL. The card row component
itself is unchanged — visual change is minimal; the new capability is in the
header strip and the data layer.

## 2. Scope

### In scope

- A new **`sat.admin_users_search(...)`** RPC that takes search/filter/sort/page
  parameters and returns one page of rows + a `total_count` (window aggregate).
  Replaces `sat.admin_users_summary()`.
- A new **`sat.admin_users_stats()`** RPC that returns the filter-independent
  headline numbers (total, students, admins, active, active_7d). Separate from
  the search RPC so the headline strip does not change as the user types.
- **Substring search** on `full_name` and `email` (`ILIKE %q%`), backed by
  trigram indexes (`pg_trgm`).
- **Four filter dimensions:** role, activity, signup recency, average-score band.
- **Sortable columns** via a server-side whitelist: name, email, role, tests,
  avg score, last active, joined.
- **Server-side pagination**: 25 per page, Prev/Next + page indicator.
- **URL-driven state**: every toolbar control writes to query params so views
  are bookmarkable and back/forward works.
- **Headline stats strip** with the new "active in last 7d" datum alongside
  total / students / admins / active.
- A small new `'use client'` `UsersToolbar` component; everything else stays
  server-rendered.
- Two composite indexes on `sat.profiles` to cover the common filter+sort paths.

### Out of scope

- Promote / demote actions. The `profiles_protect_role` trigger (see CLAUDE.md
  auth gotchas) blocks API-role writes to `role`; adding inline role management
  needs a trigger change + a dedicated server action + confirmation UI, and is
  best handled as its own sub-project.
- Bulk selection / bulk actions.
- CSV export.
- Saved filter views or "favorites".
- Signup-trend chart or per-user mini-spark-lines.
- Column customization (which fields show in the row).
- Infinite scroll.
- Any change to the per-user drill-through page `/admin/users/[id]` or to
  `sat.admin_user_analytics`.

### Acceptance criteria

1. `pnpm type-check`, `pnpm lint`, `pnpm build` succeed.
2. `sat.admin_users_search(...)` and `sat.admin_users_stats()` exist, are
   `security definer`, and raise `'not authorized'` for non-admin callers
   (matches the existing pattern in `admin_users_summary` and
   `admin_user_analytics`). `sat.admin_users_summary` is dropped in the same
   migration.
3. `/admin/users` renders with the new toolbar; entering text in the search
   input updates the URL (debounced 250ms) and the list re-renders to match.
4. Each filter pill (role, activity, joined, score) and sort dropdown updates
   the URL and the list.
5. With > 25 matching users, pagination controls appear; Prev/Next change the
   page and the row range indicator updates ("Showing 26–50 of 1,247").
6. A non-admin visiting `/admin/users` still gets a 404 (layout's
   `requireAdmin()`).
7. With an empty search result set, the page shows an empty state with a
   "Clear filters" link that strips all query params.
8. Invalid query params (`sort=DROP TABLE`, `page=abc`) fall back to defaults
   silently — no errors surfaced to the user, no string interpolation into SQL.
9. With ~1,000 rows in `sat.profiles` (test data), a page load returns in
   under 250ms on the dev DB, verified via `EXPLAIN ANALYZE` against the
   default-params query and the substring-search query.

## 3. Architecture decisions

| # | Decision | Rationale |
|---|---|---|
| A1 | **Server-side everything (search, filter, sort, page) from day one — no client-side variant.** | The user explicitly chose "build for flex" — pay the modest extra complexity now to avoid a later migration. Also: keeping the page a pure server component preserves the existing security posture (`requireAdmin()` gates the layout; the RPC re-checks). A client-side variant would force shipping all rows to the browser. |
| A2 | **One RPC that returns both the page rows AND the total count via `count(*) OVER ()`** rather than two RPCs (one for the page, one for the total). | Single round-trip; the total is needed for the "Showing X–Y of N" indicator on every page render. The window aggregate is computed once per query — cheap compared to a separate count query. |
| A3 | **State lives in URL query params, not in React state.** | Bookmarkable filter views; back/forward Just Works; SSR-friendly (the server component reads `searchParams` directly). Cost: the toolbar must be `'use client'` to call `router.replace()`. Worth it. |
| A4 | **Card row stays.** The visual change is confined to the header strip + the page width (`max-w-3xl` → `max-w-5xl`). | The user prefers the card look. The `UserRow` component already truncates long names/emails and grids the stats; no change is needed there. Keeps the diff small and avoids re-themeing a working component. |
| A5 | **Sort and filter parameters are whitelisted (enum-narrowed) before they reach SQL.** | The `p_sort` arg is `text` for parameterization simplicity but the RPC's body maps known values to known columns via `CASE` (no `EXECUTE` / dynamic SQL). The page-level zod parse rejects unknown values and falls back to defaults. Defense in depth against query injection. |
| A6 | **Trigram indexes on `lower(full_name)` and `lower(email)`** (via `pg_trgm`, enabled by this migration) rather than `LIKE 'q%'` (prefix-only) or full-text. | The product need is substring search ("find anyone named jane" → `%jane%`). Trigram is the right tool for unanchored `ILIKE` at scale; full-text would require a tsvector + stemming and is overkill for short identity fields. |
| A7 | **One index on `sat.profiles (role)` and one composite on `sat.profiles (role, created_at DESC)`.** No index on `last_activity` because that value is derived from `sat.test_attempts` and is not a column on `profiles`. | The most common filter is role; the most common stable sort backed by an actual column is `created_at desc`. Sorts by `last_activity` fall back to a heap sort over the filtered set, which is fine at expected scale (a future optimization would be a materialized aggregate). |
| A8 | **Page size = 25 cards.** | Cards are taller than table rows. 25 fills roughly two scroll-heights on a typical laptop, balances "scan in bulk" against "load nothing wasted". No user preference for changing it. |
| A9 | **Read-only — no write actions in this sub-project.** | The user explicitly chose read-only. Role management is the obvious next step but is gated by the protect_profile_role trigger and warrants its own design. |

## 4. Data model

No schema changes to `sat.profiles` (already has `id`, `email`, `full_name`,
`role`, `created_at`). One RPC replaced; two indexes added.

### Migration

```sql
-- supabase/migrations/2026MMDDHHMMSS_sat_admin_users_search.sql

-- 1) Indexes for substring search and the role+joined sort path.
create extension if not exists pg_trgm;

create index if not exists profiles_full_name_trgm
  on sat.profiles using gin (lower(full_name) gin_trgm_ops);

create index if not exists profiles_email_trgm
  on sat.profiles using gin (lower(email) gin_trgm_ops);

create index if not exists profiles_role_idx
  on sat.profiles (role);

create index if not exists profiles_role_created_at_idx
  on sat.profiles (role, created_at desc);

-- 2) Drop the old single-shot RPC.
drop function if exists sat.admin_users_summary();

-- 3) The new parameterized search RPC.
--    search_path = '' (project convention); all references fully qualified.
create or replace function sat.admin_users_search(
  p_q              text default '',
  p_role           text default 'all',           -- 'all' | 'student' | 'admin'
  p_activity       text default 'all',           -- 'all' | 'active' | 'inactive' | 'never'
  p_joined_days    int  default null,            -- 7 | 30 | 90 | null
  p_score_min      int  default null,
  p_score_max      int  default null,
  p_sort           text default 'last_active',   -- whitelist (see below)
  p_dir            text default 'desc',          -- 'asc' | 'desc'
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
  -- 1) Re-check the caller is an admin (defense in depth).
  select role into v_caller_role from sat.profiles where id = auth.uid();
  if v_caller_role is null or v_caller_role <> 'admin' then
    raise exception 'not authorized';
  end if;

  -- 2) Clamp inputs.
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
    -- Each branch hard-codes the column and direction; no dynamic SQL.
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
    -- Default tie-breaker so paging is stable.
    f.id
  offset p_offset
  limit  p_limit;
end;
$$;

grant execute on function sat.admin_users_search(
  text, text, text, int, int, int, text, text, int, int
) to authenticated;

-- 4) The headline-stats RPC (filter-independent).
--    Definitions match the search RPC's predicates exactly:
--      active     = last_activity >= now() - interval '30 days'
--      active_7d  = last_activity >= now() - interval '7 days'
--      students   = role = 'student'
--      admins     = role = 'admin'
--    "Active" requires last_activity to be non-null, which already implies
--    tests_taken >= 1 (a user with 0 attempts has null last_activity).
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
    count(*)::int                                                        as total,
    count(*) filter (where p.role = 'student')::int                      as students,
    count(*) filter (where p.role = 'admin')::int                        as admins,
    count(*) filter (where la.last_activity >= v_now - interval '30 days')::int as active,
    count(*) filter (where la.last_activity >= v_now - interval '7 days')::int  as active_7d
  from sat.profiles p
  left join last_act la on la.user_id = p.id;
end;
$$;

grant execute on function sat.admin_users_stats() to authenticated;
```

### Definitions (UI ↔ filter values)

| UI label             | Param value                   | Predicate                                                                |
|----------------------|-------------------------------|--------------------------------------------------------------------------|
| Activity: Active     | `activity=active`             | `last_activity >= now() - interval '30 days'`                            |
| Activity: Inactive   | `activity=inactive`           | `tests_taken >= 1 AND last_activity < now() - interval '30 days'`        |
| Activity: Never started | `activity=never`           | `tests_taken = 0`                                                        |
| Joined: 7 / 30 / 90d | `joined=7` / `30` / `90`      | `created_at >= now() - interval 'N days'`                                |
| Score: <1000         | `score=lt-1000`               | `avg_scaled_score < 1000`                                                |
| Score: 1000–1200     | `score=1000-1200`             | `avg_scaled_score BETWEEN 1000 AND 1199`                                 |
| Score: 1200–1400     | `score=1200-1400`             | `avg_scaled_score BETWEEN 1200 AND 1399`                                 |
| Score: 1400+         | `score=gte-1400`              | `avg_scaled_score >= 1400`                                               |

The page-level parser maps each UI value to `(p_score_min, p_score_max)` and
`(p_joined_days)` before calling the RPC.

### Sort whitelist

```ts
const SORT_KEYS = ['name','email','role','tests','avg_score','last_active','joined'] as const;
const SORT_DIRS = ['asc','desc'] as const;
```

Anything outside these enums is rewritten to the defaults (`last_active`,
`desc`) by the zod parse in the page component.

## 5. Component & file layout

```
app/(app)/admin/users/page.tsx                  -- server; reads searchParams, calls RPC
app/components/admin/UsersToolbar.tsx           -- 'use client'; new
app/components/admin/UsersPagination.tsx        -- server; new
app/components/admin/UserRow.tsx                -- unchanged
app/lib/admin/users.ts                          -- adds searchUsers(params): { rows, total }
                                                   adds getUsersStats(): UsersStats
                                                   keeps getUserProfileForAdmin + getUserAnalyticsForAdmin
                                                   removes listUsersWithStats
app/lib/admin/users-search.ts                   -- new; zod schema + URL helpers
                                                   (parseUsersSearchParams, toQueryString, defaults)
supabase/migrations/2026MMDDHHMMSS_sat_admin_users_search.sql
```

### Page → toolbar → URL → page (data flow)

1. Browser navigates to `/admin/users?...`.
2. `page.tsx` (server) reads `searchParams`, parses through the zod schema in
   `users-search.ts`, calls `searchUsers(parsed)`, which calls
   `sat.admin_users_search(...)`.
3. `page.tsx` renders the headline stats, the `<UsersToolbar>` (passing
   the parsed params as defaults), the rows, and the `<UsersPagination>`.
4. `UsersToolbar` (client) reads the current params via `useSearchParams()`,
   debounces the search input (250ms), and on any change builds a new
   URLSearchParams + calls `router.replace(newUrl, { scroll: false })`.
5. Next.js re-runs `page.tsx` server-side with the new searchParams → loop.

### Headline stats

The stats strip needs five numbers that do not change with the current filter:
total, students, admins, active (last 30 days), and active in last 7 days. The
search RPC returns *filtered* counts via `total_count`; the strip uses
`sat.admin_users_stats()` instead (full body in §4) so the strip values stay
stable as the user types in the search box. Called once per page render
alongside `admin_users_search`.

## 6. Error & edge cases

- **No matches**: render "No users match these filters." with a
  `<Link href="/admin/users">Clear filters</Link>` (strips all query params).
- **RPC error**: log and render an inline error banner; do not throw — the
  layout's `requireAdmin()` already 404s non-admins, so a thrown error here
  would surface as a 500 to an admin (jarring).
- **`page` beyond range**: the RPC returns 0 rows; the empty state above
  handles it. A "back to page 1" CTA in the empty state covers the "you over-
  paginated" case.
- **Invalid query params** (`sort=DROP TABLE`, `page=abc`, `joined=999`): zod
  narrowing on the page falls back to defaults silently. Nothing reaches SQL
  un-narrowed; `p_sort` is then `'last_active'` and the `CASE` branches map it
  to the safe column.
- **Concurrent edits to filters** (rapid pill-clicking): `router.replace()` is
  fire-and-forget; the latest URL wins. The 250ms search debounce avoids one
  request per keystroke. No optimistic UI is needed — the page re-renders on
  each URL change.
- **Users with a null email** (`sat.profiles.email` is nullable): `lower(null)`
  is `null`, and `null like '%q%'` is `unknown` → such a user is silently
  filtered out when a search term is present. With no search term they appear
  normally. The `UserRow` already falls back to `full_name → email → User
  <id-prefix>` for display, so a null email is also visually safe.

## 7. Security

- **Layer 1** — `(app)/admin/layout.tsx` calls `requireAdmin()`; non-admins
  get a 404. Unchanged.
- **Layer 2** — `sat.admin_users_search` is `security definer` and re-checks
  `sat.profiles.role = 'admin'` inside the function, raising
  `'not authorized'` otherwise. Matches the existing pattern for
  `admin_user_analytics`.
- **Layer 3** — the `p_sort`, `p_dir`, `p_role`, `p_activity` arguments are
  used only inside the function's hard-coded `CASE` and equality clauses; no
  dynamic SQL, no `EXECUTE`, no string concatenation. Even if zod narrowing
  were bypassed, the RPC tolerates and ignores unknown values (the `CASE`
  branches never match → falls through to the `f.id` tie-breaker).
- **Layer 4** — `searchUsers()` in `app/lib/admin/users.ts` takes a typed
  object (not a raw record from the URL); the URL-to-object parse happens in
  the page through the zod schema in `users-search.ts`.

## 8. Performance

- **Default page** (no filters, sort by `last_active`, page 1): the trigram
  indexes are not used (no search term); the planner hits the `agg` CTE,
  builds the join with `sat.test_attempts`, sorts by `last_activity`, and
  slices the first 25. The `test_attempts` aggregate already runs in
  `admin_users_summary` today — same cost.
- **Search**: trigram GIN indexes on `lower(full_name)` and `lower(email)`
  serve `ILIKE %q%` cheaply.
- **Filter by role + sort by last_active**: the `(role)` index narrows the
  scan; the sort is a heap sort over the filtered rows. At 10k users with
  most filtered out by role, this is fast; if it ever isn't, add the
  composite `(role, last_activity DESC NULLS LAST)`.
- **`total_count` window**: O(filtered set) once per query; cheap at expected
  scale. If we later care, we can switch to a separate `count(*)` query and
  cache it per filter combo — but not until measured.
- **Acceptance benchmark**: with ~1,000 seeded users on the dev DB, the page
  should respond in < 250ms. Larger scale is a measurement target, not a
  pre-optimization target.

## 9. Migration & rollout

- One SQL migration:
  `supabase/migrations/2026MMDDHHMMSS_sat_admin_users_search.sql`.
  Creates the trigram extension (idempotent), the two composite indexes,
  drops `admin_users_summary`, and creates `admin_users_search` +
  `admin_users_stats`.
- One PR replacing the page, adding the two new components, the
  `users-search.ts` zod module, and updating `app/lib/admin/users.ts`.
- No data migration; `sat.profiles` columns are unchanged.
- Rollback: revert the PR + drop the new RPCs + recreate
  `admin_users_summary` from its prior definition (kept in the previous
  migration). Indexes can be left in place — they are harmless additions.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| The dropped `admin_users_summary` is silently called from elsewhere we forgot. | Grep `admin_users_summary` across the repo before the migration; verify only `app/lib/admin/users.ts` references it. The drop and the call-site change ship in the same PR. |
| Trigram index doesn't help below a threshold (Postgres prefers a heap scan for tiny tables). | At small scale the heap scan is fast anyway — this is fine. The index pays off as the table grows; no action needed. |
| `count(*) OVER ()` slows down at very large scale. | Premature to fix. Measure first; if it becomes the bottleneck, split into two RPCs and cache the count per filter combo. |
| URL gets long with many filters set. | Defaults are omitted; typical URLs stay under ~120 chars. Acceptable. |
| Users bookmark a URL with a now-invalid filter value (after a future schema change). | Zod parse falls back to defaults — the page still loads correctly. |
| The `admin_users_stats()` RPC duplicates definitions of "active". | One private SQL helper (`sat.is_user_active(last_activity)`) referenced from both RPCs would avoid drift; out of scope for this sub-project, but a follow-up if a third caller appears. |

## 11. Open questions

None at design time. All scope, layout, and data-layer decisions have been
made above.

## 12. Acceptance test plan (manual, in lieu of a test runner)

1. With ~50 seeded users (mix of students/admins, varied activity), load
   `/admin/users`. Expect: headline stats, toolbar, 25 cards.
2. Type "jane" in search → URL updates to `?q=jane`, list narrows.
3. Click "Admins" → URL adds `&role=admin`, list narrows to admins only.
4. Click "Inactive" → only users with attempts but no activity in 30d show.
5. Change sort to "Tests taken" desc → list re-orders, most-tests-first.
6. Click "Next" → URL adds `&page=2`, rows 26–50 show.
7. Apply a filter that matches no users → empty state + "Clear filters" link
   restores defaults.
8. Visit `/admin/users?sort=DROP+TABLE&page=banana` → page loads with
   defaults; no error, no SQL noise in logs.
9. Sign in as a non-admin → `/admin/users` 404s.
10. `pnpm type-check && pnpm lint && pnpm build` succeed.

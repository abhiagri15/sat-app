# Admin Users Scalability — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `/admin/users` scale to thousands of users with server-side search, filter, sort, and pagination, while keeping the existing card row look unchanged.

**Architecture:** Replace the single-shot `sat.admin_users_summary()` RPC with two parameterized RPCs — `sat.admin_users_search(...)` (page rows + total via window aggregate) and `sat.admin_users_stats()` (filter-independent headline numbers). State lives in URL query params; a small client toolbar pushes new params via `router.replace()`. Pagination links and the row list stay server-rendered.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript strict · pnpm · `@supabase/ssr` + `@supabase/supabase-js` · Postgres + `pg_trgm`.

**Spec:** [2026-05-27-admin-users-scalability-design.md](../specs/2026-05-27-admin-users-scalability-design.md)

**Verification:** `pnpm type-check` / `lint` / `build` + MCP SQL. No unit-test runner — manual SQL checks gate the migration; type/lint/build gate the app.

**Shell:** Windows / PowerShell. Use the **Bash tool with a `cat <<'EOF'` here-doc** for every commit. Run all `pnpm` from `C:/Users/AbishekPotlapalli/Desktop/Projects/Personal/satpracticereact/sat-app`.

**Migration application:** the implementer writes & commits the `.sql`; the **controller** applies it via `mcp__claude_ai_Supabase__apply_migration` and verifies with `execute_sql`.

**No new env vars.** `pg_trgm` is enabled by the migration itself.

---

## Plan-wide File Structure

```
supabase/migrations/20260527000000_sat_admin_users_search.sql  # CREATED (Task 1)
app/lib/admin/users-search.ts                                  # CREATED (Task 2) — zod schema + URL helpers + types
app/lib/admin/users.ts                                         # MODIFIED (Task 3) — drop listUsersWithStats; add searchUsers + getUsersStats
app/components/admin/UsersToolbar.tsx                          # CREATED (Task 4) — 'use client' toolbar
app/components/admin/UsersPagination.tsx                       # CREATED (Task 5) — server pagination controls
app/(app)/admin/users/page.tsx                                 # MODIFIED (Task 6) — new layout, server-side wire-up
CLAUDE.md                                                      # MODIFIED (Task 7) — add a "User search at scale" gotcha section
```

Each task ends with a commit. Task 1 ships standalone (the old RPC is dropped, so the page would be broken between Task 1 and Task 6 — but the page only matters once the new code is wired up). Apply order: Task 1 (SQL) → Tasks 2–6 (app) → Task 7 (docs). Lands 7 commits.

---

## Chunk 1: Data + lib

### Task 1: SQL migration

**Files:** Create `supabase/migrations/20260527000000_sat_admin_users_search.sql`

- [ ] **Step 1.1:** Create the file with EXACTLY:

```sql
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
```

- [ ] **Step 1.2:** Commit.

```bash
git add supabase/migrations/20260527000000_sat_admin_users_search.sql && git commit -F- <<'EOF'
feat(admin): admin_users_search + admin_users_stats RPCs

Replaces single-shot admin_users_summary() with a parameterized search RPC
(page rows + total_count window agg) and a filter-independent stats RPC for
the headline strip. Adds pg_trgm + GIN indexes on lower(full_name)/lower(email)
to back substring search at scale.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

- [ ] **Step 1.3 (controller):** Apply via `mcp__claude_ai_Supabase__apply_migration` (name `sat_admin_users_search`, project `falgykkspbtrwdcchayi`).

- [ ] **Step 1.4 (controller):** Verify with `mcp__claude_ai_Supabase__execute_sql`:

```sql
-- 1) extension + indexes exist
select extname from pg_extension where extname = 'pg_trgm';
select indexname from pg_indexes
where schemaname = 'sat' and tablename = 'profiles'
  and indexname in (
    'profiles_full_name_trgm','profiles_email_trgm',
    'profiles_role_idx','profiles_role_created_at_idx'
  )
order by indexname;

-- 2) old RPC is gone, new RPCs exist
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'sat'
  and proname in ('admin_users_summary','admin_users_search','admin_users_stats')
order by proname;

-- 3) stats RPC returns sane numbers
select * from sat.admin_users_stats();

-- 4) search RPC returns the same shape and roughly the same first row
--    (default = last_active desc) as the old summary used to produce.
select id, email, full_name, role, tests_taken, avg_scaled_score, last_activity, total_count
from sat.admin_users_search()
limit 3;
```

Expected:
- `pg_trgm` row returned; all four indexes returned.
- `admin_users_summary` absent; `admin_users_search` and `admin_users_stats` present.
- Stats row: `total` equals `select count(*) from sat.profiles`; `students + admins = total`; `active <= total`; `active_7d <= active`.
- Search returns up to 3 rows, each carrying an identical `total_count` equal to the stats RPC's `total`.

### Task 2: URL → params parser + types

**Files:** Create `app/lib/admin/users-search.ts`

- [ ] **Step 2.1:** Create the file with EXACTLY:

```ts
import { z } from 'zod';

// URL → typed params for /admin/users. All fields have defaults so a bare
// /admin/users URL is the canonical "first page, no filters, default sort"
// view. Defaults are intentionally omitted from outgoing URLs (see
// `paramsToQueryString` below) to keep bookmarks short.

export const ROLES        = ['all', 'student', 'admin'] as const;
export const ACTIVITIES   = ['all', 'active', 'inactive', 'never'] as const;
export const JOINED       = ['all', '7', '30', '90'] as const;
export const SCORE_BANDS  = ['all', 'lt-1000', '1000-1200', '1200-1400', 'gte-1400'] as const;
export const SORT_KEYS    = [
  'name', 'email', 'role', 'tests', 'avg_score', 'last_active', 'joined',
] as const;
export const SORT_DIRS    = ['asc', 'desc'] as const;

export type Role       = (typeof ROLES)[number];
export type Activity   = (typeof ACTIVITIES)[number];
export type Joined     = (typeof JOINED)[number];
export type ScoreBand  = (typeof SCORE_BANDS)[number];
export type SortKey    = (typeof SORT_KEYS)[number];
export type SortDir    = (typeof SORT_DIRS)[number];

export interface UsersSearchParams {
  q:        string;
  role:     Role;
  activity: Activity;
  joined:   Joined;
  score:    ScoreBand;
  sort:     SortKey;
  dir:      SortDir;
  page:     number;     // 1-indexed
}

export const PAGE_SIZE = 25;

export const DEFAULTS: UsersSearchParams = {
  q: '',
  role: 'all',
  activity: 'all',
  joined: 'all',
  score: 'all',
  sort: 'last_active',
  dir: 'desc',
  page: 1,
};

const rawSchema = z.object({
  q:        z.string().optional(),
  role:     z.enum(ROLES).optional(),
  activity: z.enum(ACTIVITIES).optional(),
  joined:   z.enum(JOINED).optional(),
  score:    z.enum(SCORE_BANDS).optional(),
  sort:     z.enum(SORT_KEYS).optional(),
  dir:      z.enum(SORT_DIRS).optional(),
  page:     z.coerce.number().int().positive().max(10_000).optional(),
});

// Coerces a Next.js `searchParams` object (values are string | string[] |
// undefined) into a fully populated UsersSearchParams. Invalid values fall
// back to DEFAULTS silently — never throws, so the page never 500s on a bad
// URL.
export function parseUsersSearchParams(
  raw: Record<string, string | string[] | undefined>,
): UsersSearchParams {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) flat[k] = v[0];
    else flat[k] = v;
  }
  const parsed = rawSchema.safeParse(flat);
  const v = parsed.success ? parsed.data : {};
  return {
    q:        (v.q ?? DEFAULTS.q).slice(0, 200),
    role:     v.role     ?? DEFAULTS.role,
    activity: v.activity ?? DEFAULTS.activity,
    joined:   v.joined   ?? DEFAULTS.joined,
    score:    v.score    ?? DEFAULTS.score,
    sort:     v.sort     ?? DEFAULTS.sort,
    dir:      v.dir      ?? DEFAULTS.dir,
    page:     v.page     ?? DEFAULTS.page,
  };
}

// Reverse: typed params → URLSearchParams. Default-valued fields are omitted
// so canonical URLs stay short and equality-comparable.
export function paramsToSearchParams(p: UsersSearchParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (p.q              !== DEFAULTS.q)        sp.set('q',        p.q);
  if (p.role           !== DEFAULTS.role)     sp.set('role',     p.role);
  if (p.activity       !== DEFAULTS.activity) sp.set('activity', p.activity);
  if (p.joined         !== DEFAULTS.joined)   sp.set('joined',   p.joined);
  if (p.score          !== DEFAULTS.score)    sp.set('score',    p.score);
  if (p.sort           !== DEFAULTS.sort)     sp.set('sort',     p.sort);
  if (p.dir            !== DEFAULTS.dir)      sp.set('dir',      p.dir);
  if (p.page           !== DEFAULTS.page)     sp.set('page',     String(p.page));
  return sp;
}

// "/admin/users?q=jane&role=student" or "/admin/users" for the canonical
// default view. Used by the toolbar (router.replace) and by the pagination
// links (<Link href>).
export function buildUsersHref(p: UsersSearchParams): string {
  const sp = paramsToSearchParams(p);
  const s = sp.toString();
  return s.length === 0 ? '/admin/users' : `/admin/users?${s}`;
}

// Translates a ScoreBand UI value to (min, max) inclusive integers, or
// (null, null) for 'all'. Mirrors the spec's table.
export function scoreBandToRange(b: ScoreBand): {
  min: number | null;
  max: number | null;
} {
  switch (b) {
    case 'all':       return { min: null, max: null };
    case 'lt-1000':   return { min: null, max: 999 };
    case '1000-1200': return { min: 1000, max: 1199 };
    case '1200-1400': return { min: 1200, max: 1399 };
    case 'gte-1400':  return { min: 1400, max: null };
  }
}

// Translates a Joined UI value to a day count (or null for 'all').
export function joinedToDays(j: Joined): number | null {
  return j === 'all' ? null : parseInt(j, 10);
}
```

- [ ] **Step 2.2:** Run `pnpm type-check` from the sat-app directory. Exit 0.
- [ ] **Step 2.3:** Commit.

```bash
git add app/lib/admin/users-search.ts && git commit -F- <<'EOF'
feat(admin): zod schema + URL helpers for /admin/users search params

UsersSearchParams type, enum constants, defaults, parseUsersSearchParams
(safe — never throws), paramsToSearchParams, buildUsersHref, plus
scoreBandToRange + joinedToDays converters that bridge the UI vocabulary
to the RPC's (min, max, days) args.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 3: Update `app/lib/admin/users.ts`

**Files:** Modify `app/lib/admin/users.ts`

- [ ] **Step 3.1:** Replace the entire file with EXACTLY:

```ts
import { createClient } from '@/app/lib/supabase/server';
import { createAdminClient } from '@/app/lib/supabase/admin';
import type {
  AnalyticsSummary,
  AnalyticsView,
  SectionStat,
  SkillStat,
  TrendPoint,
} from '@/app/lib/analytics/compute';
import {
  joinedToDays,
  scoreBandToRange,
  type UsersSearchParams,
} from '@/app/lib/admin/users-search';

// Just the profile fields, used by the detail page header.
export interface AdminUserProfile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: 'student' | 'admin';
  created_at: string;
}

// One row in the admin users list — profile + aggregated stats.
// `avg_scaled_score` and `last_activity` are null when the user has no
// submitted attempts.
export interface AdminUserRow extends AdminUserProfile {
  tests_taken: number;
  avg_scaled_score: number | null;
  last_activity: string | null;
}

export interface UsersSearchResult {
  rows: AdminUserRow[];
  total: number;
}

export interface UsersStats {
  total: number;
  students: number;
  admins: number;
  active: number;
  active_7d: number;
}

// Searches/filters/sorts/paginates users via the admin_users_search RPC.
// Defense in depth: the layout's requireAdmin() is the first gate; the RPC
// re-checks role = 'admin' inside and raises 'not authorized' otherwise.
export async function searchUsers(
  params: UsersSearchParams,
): Promise<UsersSearchResult> {
  const supabase = await createClient();
  const { min: scoreMin, max: scoreMax } = scoreBandToRange(params.score);
  const joinedDays = joinedToDays(params.joined);
  const { data, error } = await supabase
    .schema('sat')
    .rpc('admin_users_search', {
      p_q:           params.q,
      p_role:        params.role,
      p_activity:    params.activity,
      p_joined_days: joinedDays,
      p_score_min:   scoreMin,
      p_score_max:   scoreMax,
      p_sort:        params.sort,
      p_dir:         params.dir,
      p_offset:      (params.page - 1) * 25,
      p_limit:       25,
    });
  if (error) {
    console.error('[searchUsers] failed:', error);
    return { rows: [], total: 0 };
  }
  const rows = (data ?? []) as unknown as Array<AdminUserRow & { total_count: number | string }>;
  const total = rows.length === 0 ? 0 : Number(rows[0].total_count);
  // Strip total_count off the row shape before returning to the caller.
  const stripped: AdminUserRow[] = rows.map((r) => ({
    id:               r.id,
    email:            r.email,
    full_name:        r.full_name,
    role:             r.role,
    created_at:       r.created_at,
    tests_taken:      r.tests_taken,
    avg_scaled_score: r.avg_scaled_score,
    last_activity:    r.last_activity,
  }));
  return { rows: stripped, total };
}

// Headline numbers for the stats strip. Filter-independent on purpose, so
// the strip does not change as the user types in the search box.
export async function getUsersStats(): Promise<UsersStats> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .rpc('admin_users_stats');
  const empty: UsersStats = { total: 0, students: 0, admins: 0, active: 0, active_7d: 0 };
  if (error) {
    console.error('[getUsersStats] failed:', error);
    return empty;
  }
  // The RPC returns a single-row table; supabase-js exposes it as an array.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return empty;
  return {
    total:     Number(row.total ?? 0),
    students:  Number(row.students ?? 0),
    admins:    Number(row.admins ?? 0),
    active:    Number(row.active ?? 0),
    active_7d: Number(row.active_7d ?? 0),
  };
}

// One user's profile by id. Uses the service-role client to bypass RLS on
// sat.profiles (whose select policy is scoped to auth.uid()). The /admin
// layout's requireAdmin() already gates this path. Returns null when the
// user does not exist (the page should notFound() on that).
export async function getUserProfileForAdmin(
  id: string,
): Promise<AdminUserProfile | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema('sat')
    .from('profiles')
    .select('id, email, full_name, role, created_at')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    console.error('[getUserProfileForAdmin] failed:', error);
    return null;
  }
  return (data ?? null) as AdminUserProfile | null;
}

interface AdminUserAnalyticsRpc {
  skills: SkillStat[];
  sections: SectionStat[];
  trend: TrendPoint[];
}

// Analytics view for a specific user, assembled from the admin_user_analytics
// RPC. The RPC returns sections, skills, and the score trend in one call; the
// summary stats are computed here from the trend's scaled scores plus the
// per-skill totals (questions answered). Mirrors getAnalytics()'s shape so
// the existing ScoreTrend / SkillAccuracy components can render it as-is.
export async function getUserAnalyticsForAdmin(
  userId: string,
): Promise<AnalyticsView> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .rpc('admin_user_analytics', { p_user_id: userId });

  const empty: AnalyticsView = {
    summary: { testsTaken: 0, bestScore: 0, averageScore: 0, questionsAnswered: 0 },
    sections: [],
    skills: [],
    trend: [],
  };
  if (error) {
    console.error('[getUserAnalyticsForAdmin] failed:', error);
    return empty;
  }
  if (!data) return empty;

  const rpc = data as AdminUserAnalyticsRpc;
  const skills = rpc.skills ?? [];
  const sections = rpc.sections ?? [];
  const trend = rpc.trend ?? [];

  return {
    summary: summarizeFromTrend(trend, skills),
    sections,
    skills,
    trend,
  };
}

function summarizeFromTrend(
  trend: TrendPoint[],
  skills: SkillStat[],
): AnalyticsSummary {
  const scores = trend.map((t) => t.score);
  const testsTaken = trend.length;
  const bestScore = testsTaken === 0 ? 0 : Math.max(...scores);
  const averageScore =
    testsTaken === 0
      ? 0
      : Math.round(scores.reduce((s, n) => s + n, 0) / testsTaken);
  const questionsAnswered = skills.reduce((s, k) => s + k.total, 0);
  return { testsTaken, bestScore, averageScore, questionsAnswered };
}
```

- [ ] **Step 3.2:** Run `pnpm type-check`. Exit 0.

   If `type-check` fails on a missing `total_count` column on the typed return — that means supabase-js's generated typings don't include the new RPC. The `as unknown as` cast on the search RPC response is intentional: we don't have generated types for the new RPC yet, and the cast is the same pattern used by `listUsersWithStats` for the old RPC.

- [ ] **Step 3.3:** Commit.

```bash
git add app/lib/admin/users.ts && git commit -F- <<'EOF'
feat(admin): searchUsers + getUsersStats wrappers; drop listUsersWithStats

searchUsers translates a UsersSearchParams into admin_users_search args
(score band → (min,max); joined → days; page → offset). Reads total_count
off the first row and strips it from the returned AdminUserRow shape.
getUsersStats wraps admin_users_stats. Both fall back to safe empty values
on error (matches the existing pattern).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

---

## Chunk 2: UI components

### Task 4: `UsersToolbar` (client component)

**Files:** Create `app/components/admin/UsersToolbar.tsx`

- [ ] **Step 4.1:** Create the file with EXACTLY:

```tsx
'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ACTIVITIES,
  DEFAULTS,
  JOINED,
  ROLES,
  SCORE_BANDS,
  SORT_DIRS,
  SORT_KEYS,
  buildUsersHref,
  type Activity,
  type Joined,
  type Role,
  type ScoreBand,
  type SortDir,
  type SortKey,
  type UsersSearchParams,
} from '@/app/lib/admin/users-search';

interface Props {
  current: UsersSearchParams;
}

// Human-readable labels for each pill / dropdown value.
const ROLE_LABEL: Record<Role, string>           = { all: 'All', student: 'Students', admin: 'Admins' };
const ACT_LABEL:  Record<Activity, string>       = { all: 'All', active: 'Active', inactive: 'Inactive', never: 'Never started' };
const JOIN_LABEL: Record<Joined, string>         = { all: 'All', '7': 'Last 7d', '30': 'Last 30d', '90': 'Last 90d' };
const SCORE_LABEL: Record<ScoreBand, string>     = {
  all: 'All', 'lt-1000': '<1000', '1000-1200': '1000–1200',
  '1200-1400': '1200–1400', 'gte-1400': '1400+',
};
const SORT_LABEL: Record<SortKey, string>        = {
  name: 'Name', email: 'Email', role: 'Role', tests: 'Tests taken',
  avg_score: 'Avg score', last_active: 'Last active', joined: 'Joined',
};
const DIR_LABEL: Record<SortDir, string>         = { asc: 'Ascending', desc: 'Descending' };

export function UsersToolbar({ current }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(current.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the input in sync if the URL changes externally (Back/Forward).
  useEffect(() => {
    setQ(current.q);
  }, [current.q]);

  // Push a new URL. Any param change resets page to 1 (the previous page
  // number is meaningless against a different filter set).
  const push = (next: Partial<UsersSearchParams>) => {
    const merged: UsersSearchParams = { ...current, ...next, page: 1 };
    startTransition(() => router.replace(buildUsersHref(merged), { scroll: false }));
  };

  const onSearch = (value: string) => {
    setQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => push({ q: value }), 250);
  };

  // Cleanup the timer on unmount.
  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const showClear = useMemo(() => {
    return (
      current.q !== DEFAULTS.q ||
      current.role !== DEFAULTS.role ||
      current.activity !== DEFAULTS.activity ||
      current.joined !== DEFAULTS.joined ||
      current.score !== DEFAULTS.score ||
      current.sort !== DEFAULTS.sort ||
      current.dir !== DEFAULTS.dir
    );
  }, [current]);

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          inputMode="search"
          placeholder="Search name or email…"
          value={q}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm
                     placeholder:text-slate-400 focus:border-blue-400 focus:outline-none
                     focus:ring-1 focus:ring-blue-300"
        />
        {showClear && (
          <a
            href="/admin/users"
            className="text-xs font-medium text-blue-700 hover:underline"
          >
            Clear filters
          </a>
        )}
      </div>

      <PillRow
        label="Role"
        values={ROLES}
        labels={ROLE_LABEL}
        current={current.role}
        onPick={(v) => push({ role: v })}
      />
      <PillRow
        label="Activity"
        values={ACTIVITIES}
        labels={ACT_LABEL}
        current={current.activity}
        onPick={(v) => push({ activity: v })}
      />
      <PillRow
        label="Joined"
        values={JOINED}
        labels={JOIN_LABEL}
        current={current.joined}
        onPick={(v) => push({ joined: v })}
      />
      <PillRow
        label="Score"
        values={SCORE_BANDS}
        labels={SCORE_LABEL}
        current={current.score}
        onPick={(v) => push({ score: v })}
      />

      <div className="flex flex-wrap items-center gap-3 pt-1 text-sm text-slate-600">
        <label className="flex items-center gap-2">
          Sort by
          <select
            value={current.sort}
            onChange={(e) => push({ sort: e.target.value as SortKey })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            {SORT_KEYS.map((k) => (
              <option key={k} value={k}>{SORT_LABEL[k]}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          Order
          <select
            value={current.dir}
            onChange={(e) => push({ dir: e.target.value as SortDir })}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            {SORT_DIRS.map((d) => (
              <option key={d} value={d}>{DIR_LABEL[d]}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

// One labelled row of pill buttons. Generic over the enum it renders so
// every filter dimension uses the same visual.
function PillRow<T extends string>({
  label,
  values,
  labels,
  current,
  onPick,
}: {
  label: string;
  values: readonly T[];
  labels: Record<T, string>;
  current: T;
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-16 shrink-0 text-slate-500">{label}:</span>
      {values.map((v) => {
        const active = v === current;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onPick(v)}
            className={
              'rounded-full border px-3 py-1 text-xs transition ' +
              (active
                ? 'border-blue-500 bg-blue-50 text-blue-800'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')
            }
          >
            {labels[v]}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4.2:** Run `pnpm type-check`. Exit 0.
- [ ] **Step 4.3:** Commit.

```bash
git add app/components/admin/UsersToolbar.tsx && git commit -F- <<'EOF'
feat(admin): UsersToolbar — search + filter pills + sort dropdowns

Client component reading UsersSearchParams as a prop and pushing changes
via router.replace(buildUsersHref(...)). Debounced search (250ms); every
non-search change is immediate. Each change resets page to 1. "Clear
filters" link appears when any param deviates from defaults.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 5: `UsersPagination` (server component)

**Files:** Create `app/components/admin/UsersPagination.tsx`

- [ ] **Step 5.1:** Create the file with EXACTLY:

```tsx
import Link from 'next/link';
import {
  PAGE_SIZE,
  buildUsersHref,
  type UsersSearchParams,
} from '@/app/lib/admin/users-search';

interface Props {
  current: UsersSearchParams;
  total: number;
}

// Prev / Next / "Showing X–Y of N" indicator. Plain <Link>s — no JS, no
// client component needed. Hidden when total <= PAGE_SIZE (a single page
// of results doesn't need pagination chrome).
export function UsersPagination({ current, total }: Props) {
  if (total <= PAGE_SIZE) return null;

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, current.page), totalPages);
  const firstRow = (page - 1) * PAGE_SIZE + 1;
  const lastRow  = Math.min(page * PAGE_SIZE, total);

  const prevHref = buildUsersHref({ ...current, page: page - 1 });
  const nextHref = buildUsersHref({ ...current, page: page + 1 });

  return (
    <div className="mt-6 flex items-center justify-between text-sm text-slate-600">
      <div>
        Showing {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of{' '}
        {total.toLocaleString()}
      </div>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link
            href={prevHref}
            className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
          >
            ‹ Prev
          </Link>
        ) : (
          <span className="rounded border border-slate-200 px-3 py-1 text-slate-300">
            ‹ Prev
          </span>
        )}
        <span className="text-slate-500">
          Page {page} of {totalPages}
        </span>
        {page < totalPages ? (
          <Link
            href={nextHref}
            className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50"
          >
            Next ›
          </Link>
        ) : (
          <span className="rounded border border-slate-200 px-3 py-1 text-slate-300">
            Next ›
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5.2:** Run `pnpm type-check`. Exit 0.
- [ ] **Step 5.3:** Commit.

```bash
git add app/components/admin/UsersPagination.tsx && git commit -F- <<'EOF'
feat(admin): UsersPagination — server component Prev/Next + row range

Plain <Link>s preserve the rest of the query string via buildUsersHref;
hidden when total fits on one page. Disabled (greyed) state for the first
and last pages.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

---

## Chunk 3: Page wire-up + docs

### Task 6: Rewrite `/admin/users/page.tsx`

**Files:** Modify `app/(app)/admin/users/page.tsx`

- [ ] **Step 6.1:** Replace the entire file with EXACTLY:

```tsx
import Link from 'next/link';
import { searchUsers, getUsersStats } from '@/app/lib/admin/users';
import { parseUsersSearchParams } from '@/app/lib/admin/users-search';
import { UserRow } from '@/app/components/admin/UserRow';
import { UsersToolbar } from '@/app/components/admin/UsersToolbar';
import { UsersPagination } from '@/app/components/admin/UsersPagination';

interface PageProps {
  // Next.js 15: searchParams is a Promise.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const rawParams = await searchParams;
  const params = parseUsersSearchParams(rawParams);

  // Filter-independent headline numbers + filtered page rows in parallel.
  const [stats, { rows, total }] = await Promise.all([
    getUsersStats(),
    searchUsers(params),
  ]);

  const isFilteredOrSearching =
    params.q !== '' ||
    params.role !== 'all' ||
    params.activity !== 'all' ||
    params.joined !== 'all' ||
    params.score !== 'all';

  return (
    <main className="mx-auto max-w-5xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Users</h1>
      <p className="text-sm text-slate-500">
        {stats.total.toLocaleString()} total ·{' '}
        {stats.students.toLocaleString()} student{stats.students === 1 ? '' : 's'} ·{' '}
        {stats.admins.toLocaleString()} admin{stats.admins === 1 ? '' : 's'} ·{' '}
        {stats.active.toLocaleString()} active (30d) ·{' '}
        {stats.active_7d.toLocaleString()} active (7d)
      </p>

      <UsersToolbar current={params} />

      <div className="mt-6 space-y-2">
        {rows.length === 0 ? (
          isFilteredOrSearching ? (
            <p className="text-sm text-slate-500">
              No users match these filters.{' '}
              <Link href="/admin/users" className="font-medium text-blue-700 hover:underline">
                Clear filters
              </Link>
            </p>
          ) : (
            <p className="text-sm text-slate-500">No users yet.</p>
          )
        ) : (
          rows.map((u) => <UserRow key={u.id} user={u} />)
        )}
      </div>

      <UsersPagination current={params} total={total} />
    </main>
  );
}
```

- [ ] **Step 6.2:** Run `pnpm type-check`. Exit 0.

- [ ] **Step 6.3:** Run `pnpm lint`. Exit 0.

- [ ] **Step 6.4:** Run `pnpm build`. Exit 0.

- [ ] **Step 6.5 (manual smoke):** Start dev (`pnpm dev`) in a separate terminal; sign in as an admin; visit:

   1. `http://localhost:3000/admin/users` — expect: headline strip with five stats; toolbar; up to 25 cards; pagination only if > 25 users.
   2. Type "jane" in the search box — URL becomes `…?q=jane` after a brief debounce; list narrows.
   3. Click "Admins" under Role — URL adds `&role=admin`; list narrows; page resets to 1.
   4. Click "Next" (if more than 25 results) — URL adds `&page=2`; row range indicator updates.
   5. Visit `/admin/users?sort=DROP+TABLE&page=banana` — page loads with defaults; no error.
   6. Sign out and sign back in as a non-admin (or open an incognito window with a non-admin session). Visit `/admin/users` — 404.

   Kill dev when done.

- [ ] **Step 6.6:** Commit.

```bash
git add "app/(app)/admin/users/page.tsx" && git commit -F- <<'EOF'
feat(admin): rewrite /admin/users for scale — search/filter/sort/paginate

Parses searchParams via parseUsersSearchParams (safe, never throws). Fires
the filter-independent stats and the filtered page in parallel. Renders
the existing UserRow cards under a new toolbar and paginates server-side.
Empty state distinguishes "no users yet" from "no users match these filters"
(the latter gets a Clear filters link).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 7: Docs sync (CLAUDE.md)

**Files:** Modify `CLAUDE.md`

- [ ] **Step 7.1:** Locate the existing "Admin sub-project gotchas" section in `CLAUDE.md`. Append (do NOT replace existing bullets) one new bullet at the end of that section, before the next `##` heading:

```markdown
- **`/admin/users` is server-side everything (search, filter, sort, paginate).** The page replaces the old single-shot `sat.admin_users_summary()` with two security-definer RPCs: `sat.admin_users_search(p_q, p_role, p_activity, p_joined_days, p_score_min, p_score_max, p_sort, p_dir, p_offset, p_limit)` returns one page of rows plus a `total_count` window aggregate, and `sat.admin_users_stats()` returns the filter-independent headline numbers (total / students / admins / active-30d / active-7d). State lives entirely in URL query params — [app/lib/admin/users-search.ts](app/lib/admin/users-search.ts) is the single source of truth for the param shape, defaults, and URL helpers; the toolbar ([app/components/admin/UsersToolbar.tsx](app/components/admin/UsersToolbar.tsx)) calls `router.replace(buildUsersHref(...))` on every change with a 250ms debounce on the text search. `pg_trgm` is enabled and GIN-indexes back the substring search on `lower(full_name)` / `lower(email)`. **Do not add a write path through these RPCs** — they are read-only by design; promote/demote needs its own server action behind `requireAdmin()` plus a `profiles_protect_role` trigger change (deferred, see the auth gotchas).
```

- [ ] **Step 7.2:** In the same `CLAUDE.md`, locate the line that describes `app/lib/admin/users.ts` in the architecture file list (search for `app/lib/admin/users.ts`). Replace just that bullet's description so it reads:

```markdown
- [app/lib/admin/users.ts](app/lib/admin/users.ts) — `searchUsers(params)` / `getUsersStats()` / `getUserProfileForAdmin(id)` / `getUserAnalyticsForAdmin(id)`: power the `/admin/users` views. `searchUsers` calls the `sat.admin_users_search` security-definer RPC and reads `total_count` off the first row; `getUsersStats` calls `sat.admin_users_stats`. Both RPCs re-check `role = 'admin'` at the SQL layer. The single-row profile lookup uses the service-role client. Mirrors the `AnalyticsView` shape from `analytics/compute.ts` so the existing chart components render unchanged.
```

- [ ] **Step 7.3:** In the same file, locate the bullet for `app/(app)/admin/users/page.tsx`. Replace just that bullet so it reads:

```markdown
- [app/(app)/admin/users/page.tsx](app/(app)/admin/users/page.tsx) — admin users listing; server component, reads `searchParams`, parses via `parseUsersSearchParams` (safe — never throws), fires `getUsersStats()` and `searchUsers(params)` in parallel, then renders the headline stats, `<UsersToolbar>`, the `UserRow` cards, and `<UsersPagination>`. 25 per page. Filter-independent stats stay stable while the user types.
```

- [ ] **Step 7.4:** In the same file, add two new lines next to the existing `app/components/admin/*` bullets, slotted alphabetically:

```markdown
- [app/components/admin/UsersToolbar.tsx](app/components/admin/UsersToolbar.tsx) — `'use client'` search input + role/activity/joined/score pills + sort & order dropdowns; pushes changes via `router.replace(buildUsersHref(...))` with a 250ms debounce on the text input. Every non-search change is immediate; every change resets `page` to 1. Shows a "Clear filters" link when any param deviates from defaults.
- [app/components/admin/UsersPagination.tsx](app/components/admin/UsersPagination.tsx) — server Prev/Next + "Showing X–Y of N" indicator. Plain `<Link>`s preserve the query string via `buildUsersHref`. Hidden when `total ≤ PAGE_SIZE`.
```

- [ ] **Step 7.5:** In the same file, add a new file-list bullet for `app/lib/admin/users-search.ts`, slotted alphabetically:

```markdown
- [app/lib/admin/users-search.ts](app/lib/admin/users-search.ts) — single source of truth for `/admin/users` URL state: `UsersSearchParams` type + enum constants (`ROLES`, `ACTIVITIES`, `JOINED`, `SCORE_BANDS`, `SORT_KEYS`, `SORT_DIRS`), `DEFAULTS`, `PAGE_SIZE`, `parseUsersSearchParams` (zod-narrowed, falls back to defaults silently on bad input), `paramsToSearchParams`, `buildUsersHref`, plus the `scoreBandToRange` / `joinedToDays` converters that bridge UI vocabulary to the RPC's `(min, max, days)` args.
```

- [ ] **Step 7.6:** Run `pnpm type-check && pnpm lint && pnpm build`. All exit 0.

- [ ] **Step 7.7:** Commit.

```bash
git add CLAUDE.md && git commit -F- <<'EOF'
docs(admin): document /admin/users scalability rewrite

New gotcha bullet under "Admin sub-project gotchas" covering the two
security-definer RPCs and the URL-state convention. Updated file-list
descriptions for users.ts and admin/users/page.tsx. Added entries for
the three new files (users-search.ts, UsersToolbar.tsx, UsersPagination.tsx).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

---

## Final verification

After every task is committed, run from `sat-app`:

```powershell
pnpm type-check
pnpm lint
pnpm build
```

All three must exit 0. Confirm with the controller (or human): the manual smoke checks in Step 6.5 still pass against the deployed migration.

If a check fails: do not paper over it. Diagnose, fix in the relevant file, commit the fix as its own commit (not as an amend).

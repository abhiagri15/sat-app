# SAT-App Admin — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** An admin-only `/admin` area to moderate the AI question pool — browse, inspect, and soft-disable bad questions.

**Architecture:** A `sat.questions.enabled` column (default true); `sat.draw_questions` updated to serve only enabled questions. `requireAdmin()` gates the `/admin` layout and every admin server action (404 for non-admins). Disable/enable writes go through a role-checked `'use server'` action using the service-role client. Reads use the SSR client (`sat.questions` is readable by any authenticated user).

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript strict · pnpm · `@supabase/ssr` + `@supabase/supabase-js` · Postgres.

**Spec:** [2026-05-21-sat-app-admin-design.md](../specs/2026-05-21-sat-app-admin-design.md)

**Builds on:** `post-analytics`. Lands eight commits on `main`, tagged `post-admin`.

**Verification:** `pnpm type-check` / `lint` / `build` + MCP SQL. No unit-test runner.

**Shell:** Windows / PowerShell. Use the **Bash tool with a `cat <<'EOF'` here-doc** for every commit. Run from `C:/Users/AbishekPotlapalli/Desktop/Projects/Personal/satpracticereact/sat-app`.

**Migration application:** the implementer writes & commits the `.sql`; the **controller** applies it via `mcp__claude_ai_Supabase__apply_migration` and verifies.

**No new env vars** (the service-role key already exists for the AI sub-project).

---

## Plan-wide File Structure

```
supabase/migrations/20260521070000_sat_questions_enabled.sql   # CREATED (Task 1)
app/lib/admin/guard.ts      # CREATED (Task 2)
app/lib/admin/queries.ts    # CREATED (Task 3)
app/lib/admin/actions.ts    # CREATED (Task 4)
app/(app)/admin/layout.tsx                  # CREATED (Task 5)
app/(app)/admin/page.tsx                    # CREATED (Task 5)
app/components/admin/QuestionRow.tsx        # CREATED (Task 5)
app/(app)/admin/questions/[id]/page.tsx     # CREATED (Task 6)
app/components/AppHeader.tsx                # MODIFIED (Task 7)
README.md / CLAUDE.md                       # MODIFIED (Task 8)
```

---

## Chunk 1: Data + lib

### Task 1: `enabled` column + `draw_questions` update

**Files:** Create `supabase/migrations/20260521070000_sat_questions_enabled.sql`

- [ ] **Step 1.1:** Create the file with EXACTLY:

```sql
-- Admin sub-project — soft-disable for pool questions.

alter table sat.questions
  add column if not exists enabled boolean not null default true;

-- draw_questions, recreated to serve only enabled questions. Identical to the
-- AI sub-project version except `and q.enabled` is added to the fresh and
-- recycle queries.
create or replace function sat.draw_questions(p_section text, p_count int)
returns setof sat.questions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_count int  := least(greatest(coalesce(p_count, 0), 0), 60);
  v_ids   text[];
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select coalesce(array_agg(id), array[]::text[]) into v_ids from (
    select q.id from sat.questions q
    where q.section = p_section
      and q.enabled
      and not exists (
        select 1 from sat.served_questions s
        where s.user_id = v_user and s.question_id = q.id)
    order by random()
    limit v_count
  ) fresh;

  if coalesce(array_length(v_ids, 1), 0) < v_count then
    select v_ids || coalesce(array_agg(id), array[]::text[]) into v_ids from (
      select q.id
      from sat.questions q
      join sat.served_questions s
        on s.question_id = q.id and s.user_id = v_user
      where q.section = p_section
        and q.enabled
        and not (q.id = any(v_ids))
      order by s.served_at asc
      limit v_count - coalesce(array_length(v_ids, 1), 0)
    ) recycled;
  end if;

  insert into sat.served_questions (user_id, question_id, served_at)
  select v_user, unnest(v_ids), now()
  on conflict (user_id, question_id) do update set served_at = excluded.served_at;

  return query select * from sat.questions q where q.id = any(v_ids);
end;
$$;

grant execute on function sat.draw_questions(text, int) to authenticated;
```

- [ ] **Step 1.2:** Commit.

```bash
git add supabase/migrations/20260521070000_sat_questions_enabled.sql && git commit -F- <<'EOF'
feat(admin): sat.questions.enabled column + draw_questions filter

Adds a soft-disable flag to the question pool and updates draw_questions
to serve only enabled questions (fresh and recycle paths).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

- [ ] **Step 1.3 (controller):** Apply via `mcp__claude_ai_Supabase__apply_migration` (name `sat_questions_enabled`).
- [ ] **Step 1.4 (controller):** Verify with `execute_sql`:

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'sat' and table_name = 'questions' and column_name = 'enabled';
select count(*) as total, count(*) filter (where enabled) as enabled_rows from sat.questions;
select pg_get_functiondef(p.oid) like '%q.enabled%' as has_enabled_filter
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'sat' and p.proname = 'draw_questions';
```

Expected: `enabled` column is `boolean`, `NOT NULL`, default `true`; `total = enabled_rows`; `has_enabled_filter = true`.

### Task 2: `requireAdmin()` guard

**Files:** Create `app/lib/admin/guard.ts`

- [ ] **Step 2.1:** Create `app/lib/admin/guard.ts` with EXACTLY:

```ts
import { notFound } from 'next/navigation';
import { getOrCreateProfile, type Profile } from '@/app/lib/auth/profile';

// Returns the signed-in user's profile if they are an admin; 404s otherwise.
// Used by the /admin layout and every admin server action — the gate never
// relies on UI reachability alone. notFound() is `never`, so the return
// narrows to a non-null admin Profile.
export async function requireAdmin(): Promise<Profile> {
  const profile = await getOrCreateProfile();
  if (!profile || profile.role !== 'admin') notFound();
  return profile;
}
```

- [ ] **Step 2.2:** Run `pnpm type-check` — exits 0.
- [ ] **Step 2.3:** Commit.

```bash
git add app/lib/admin/guard.ts && git commit -F- <<'EOF'
feat(admin): requireAdmin guard

Returns the caller's profile if they are an admin, 404s everyone else.
Used by the /admin layout and every admin server action.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 3: admin queries

**Files:** Create `app/lib/admin/queries.ts`

- [ ] **Step 3.1:** Create `app/lib/admin/queries.ts` with EXACTLY:

```ts
import { createClient } from '@/app/lib/supabase/server';

export interface AdminQuestion {
  id: string;
  section: 'rw' | 'math';
  skill: string;
  passage: string | null;
  prompt: string;
  choices: unknown;
  answer_index: number;
  explanation: string;
  source: 'seed' | 'ai';
  enabled: boolean;
  created_at: string;
}

export interface PoolCounts {
  total: number;
  enabled: number;
  disabled: number;
  ai: number;
  seed: number;
  rw: number;
  math: number;
}

export interface QuestionFilters {
  section?: 'rw' | 'math';
  status?: 'enabled' | 'disabled';
}

const QUESTION_COLUMNS =
  'id, section, skill, passage, prompt, choices, answer_index, explanation, source, enabled, created_at';

// The question pool, newest first, filtered, capped at 200 rows.
export async function listQuestions(
  filters: QuestionFilters,
): Promise<AdminQuestion[]> {
  const supabase = await createClient();
  let query = supabase.schema('sat').from('questions').select(QUESTION_COLUMNS);
  if (filters.section) query = query.eq('section', filters.section);
  if (filters.status === 'enabled') query = query.eq('enabled', true);
  if (filters.status === 'disabled') query = query.eq('enabled', false);
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('[listQuestions] failed:', error);
    return [];
  }
  return (data ?? []) as unknown as AdminQuestion[];
}

// One question by id, or null if it does not exist.
export async function getQuestion(id: string): Promise<AdminQuestion | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('questions')
    .select(QUESTION_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as AdminQuestion;
}

// Pool-wide counts for the /admin header. The pool is small — count in JS.
export async function getPoolCounts(): Promise<PoolCounts> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('questions')
    .select('section, source, enabled');
  if (error || !data) {
    console.error('[getPoolCounts] failed:', error);
    return { total: 0, enabled: 0, disabled: 0, ai: 0, seed: 0, rw: 0, math: 0 };
  }
  const rows = data as { section: string; source: string; enabled: boolean }[];
  return {
    total: rows.length,
    enabled: rows.filter((r) => r.enabled).length,
    disabled: rows.filter((r) => !r.enabled).length,
    ai: rows.filter((r) => r.source === 'ai').length,
    seed: rows.filter((r) => r.source === 'seed').length,
    rw: rows.filter((r) => r.section === 'rw').length,
    math: rows.filter((r) => r.section === 'math').length,
  };
}
```

- [ ] **Step 3.2:** Run `pnpm type-check` — exits 0.
- [ ] **Step 3.3:** Commit.

```bash
git add app/lib/admin/queries.ts && git commit -F- <<'EOF'
feat(admin): admin pool queries

listQuestions (filtered, capped), getQuestion, getPoolCounts — read the
question pool via the SSR client for the admin moderation views.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 4: `setQuestionEnabled` server action

**Files:** Create `app/lib/admin/actions.ts`

- [ ] **Step 4.1:** Create `app/lib/admin/actions.ts` with EXACTLY:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from './guard';
import { createAdminClient } from '@/app/lib/supabase/admin';

// Enable or disable a pool question. Admin-only. sat.questions is RLS
// write-locked, so the write goes through the service-role client; a disabled
// question is excluded by draw_questions and never served again.
export async function setQuestionEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .schema('sat')
    .from('questions')
    .update({ enabled })
    .eq('id', id);
  if (error) {
    console.error('[setQuestionEnabled] failed:', error);
    throw new Error('Failed to update the question.');
  }
  revalidatePath('/admin');
  revalidatePath(`/admin/questions/${id}`);
}
```

- [ ] **Step 4.2:** Run `pnpm type-check` (exits 0) and `pnpm lint` (no errors).
- [ ] **Step 4.3:** Commit.

```bash
git add app/lib/admin/actions.ts && git commit -F- <<'EOF'
feat(admin): setQuestionEnabled server action

Admin-gated server action that toggles a question's enabled flag via the
service-role client, then revalidates the admin views.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

---

## Chunk 2: UI + docs

### Task 5: admin layout, pool page, QuestionRow

**Files:** Create `app/(app)/admin/layout.tsx`, `app/(app)/admin/page.tsx`, `app/components/admin/QuestionRow.tsx`

- [ ] **Step 5.1:** Create `app/(app)/admin/layout.tsx` with EXACTLY:

```tsx
import type { ReactNode } from 'react';
import { requireAdmin } from '@/app/lib/admin/guard';

// Gates the whole /admin subtree to admins; requireAdmin() 404s everyone else.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}
```

- [ ] **Step 5.2:** Create `app/components/admin/QuestionRow.tsx` with EXACTLY:

```tsx
import Link from 'next/link';
import { setQuestionEnabled } from '@/app/lib/admin/actions';
import type { AdminQuestion } from '@/app/lib/admin/queries';

function truncate(s: string, n = 120): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// One question-pool row: metadata, truncated prompt, and an enable/disable
// toggle (a form bound to the setQuestionEnabled server action).
export function QuestionRow({ question }: { question: AdminQuestion }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
          {question.section === 'rw' ? 'R&W' : 'Math'}
        </span>
        <span className="text-slate-500">{question.skill}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
          {question.source}
        </span>
        {question.enabled ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
            Enabled
          </span>
        ) : (
          <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">
            Disabled
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-800">{truncate(question.prompt)}</p>
      <div className="mt-2 flex items-center gap-3">
        <Link
          href={`/admin/questions/${question.id}`}
          className="text-xs text-blue-600 underline"
        >
          View
        </Link>
        <form action={setQuestionEnabled.bind(null, question.id, !question.enabled)}>
          <button
            type="submit"
            className={`rounded px-2.5 py-1 text-xs font-medium ${
              question.enabled
                ? 'bg-red-50 text-red-700 hover:bg-red-100'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            {question.enabled ? 'Disable' : 'Enable'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 5.3:** Create `app/(app)/admin/page.tsx` with EXACTLY:

```tsx
import Link from 'next/link';
import {
  listQuestions,
  getPoolCounts,
  type QuestionFilters,
} from '@/app/lib/admin/queries';
import { QuestionRow } from '@/app/components/admin/QuestionRow';

const SECTION_FILTERS: { label: string; section?: 'rw' | 'math' }[] = [
  { label: 'All sections', section: undefined },
  { label: 'Reading & Writing', section: 'rw' },
  { label: 'Math', section: 'math' },
];
const STATUS_FILTERS: { label: string; status?: 'enabled' | 'disabled' }[] = [
  { label: 'All', status: undefined },
  { label: 'Enabled', status: 'enabled' },
  { label: 'Disabled', status: 'disabled' },
];

function filterHref(section?: string, status?: string): string {
  const p = new URLSearchParams();
  if (section) p.set('section', section);
  if (status) p.set('status', status);
  const qs = p.toString();
  return qs ? `/admin?${qs}` : '/admin';
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const filters: QuestionFilters = {
    section: sp.section === 'rw' || sp.section === 'math' ? sp.section : undefined,
    status:
      sp.status === 'enabled' || sp.status === 'disabled' ? sp.status : undefined,
  };

  const [counts, questions] = await Promise.all([
    getPoolCounts(),
    listQuestions(filters),
  ]);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Question pool</h1>
      <p className="text-sm text-slate-500">
        {counts.total} questions · {counts.enabled} enabled · {counts.disabled}{' '}
        disabled · {counts.ai} AI · {counts.seed} seed · {counts.rw} R&amp;W ·{' '}
        {counts.math} Math
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {SECTION_FILTERS.map((f) => {
          const active = filters.section === f.section;
          return (
            <Link
              key={f.label}
              href={filterHref(f.section, filters.status)}
              className={`rounded-full px-3 py-1 text-xs ${
                active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => {
          const active = filters.status === f.status;
          return (
            <Link
              key={f.label}
              href={filterHref(filters.section, f.status)}
              className={`rounded-full px-3 py-1 text-xs ${
                active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-6 space-y-2">
        {questions.length === 0 ? (
          <p className="text-sm text-slate-500">
            No questions match these filters.
          </p>
        ) : (
          questions.map((q) => <QuestionRow key={q.id} question={q} />)
        )}
      </div>
    </main>
  );
}
```

- [ ] **Step 5.4:** Run `pnpm type-check` (exits 0) and `pnpm lint` (no errors).
- [ ] **Step 5.5:** Commit.

```bash
git add "app/(app)/admin/layout.tsx" "app/(app)/admin/page.tsx" app/components/admin/QuestionRow.tsx && git commit -F- <<'EOF'
feat(admin): /admin pool page, role-gated layout, QuestionRow

The /admin layout 404s non-admins via requireAdmin(). The page shows
pool counts, section/status filters, and a list of QuestionRows each
with an enable/disable toggle.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 6: question detail page

**Files:** Create `app/(app)/admin/questions/[id]/page.tsx`

- [ ] **Step 6.1:** Create `app/(app)/admin/questions/[id]/page.tsx` with EXACTLY:

```tsx
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getQuestion } from '@/app/lib/admin/queries';
import { setQuestionEnabled } from '@/app/lib/admin/actions';
import { LETTERS } from '@/app/lib/test';

export default async function AdminQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const q = await getQuestion(id);
  if (!q) notFound();

  const choices = Array.isArray(q.choices) ? (q.choices as string[]) : [];

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/admin" className="text-sm text-blue-600 underline">
        ← Back to the pool
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded bg-slate-100 px-1.5 py-0.5">
          {q.section === 'rw' ? 'Reading & Writing' : 'Math'}
        </span>
        <span>{q.skill}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5">{q.source}</span>
        <span>{q.id}</span>
        {q.enabled ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
            Enabled
          </span>
        ) : (
          <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">
            Disabled
          </span>
        )}
      </div>

      {q.passage && (
        <div className="mt-4 whitespace-pre-wrap rounded-md border-l-4 border-blue-500 bg-slate-50 p-4 text-sm">
          {q.passage}
        </div>
      )}

      <h1 className="mt-4 text-lg font-semibold">{q.prompt}</h1>

      <ul className="mt-3 space-y-1.5">
        {choices.map((c, i) => (
          <li
            key={i}
            className={`rounded-md border p-2 text-sm ${
              i === q.answer_index
                ? 'border-emerald-300 bg-emerald-50 font-medium text-emerald-800'
                : 'border-slate-200'
            }`}
          >
            {LETTERS[i]}. {c}
            {i === q.answer_index && ' ✓'}
          </li>
        ))}
      </ul>

      <div className="mt-4 text-sm text-slate-700">
        <span className="font-semibold text-blue-700">Explanation: </span>
        {q.explanation}
      </div>

      <form
        action={setQuestionEnabled.bind(null, q.id, !q.enabled)}
        className="mt-6"
      >
        <button
          type="submit"
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            q.enabled
              ? 'bg-red-50 text-red-700 hover:bg-red-100'
              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
          }`}
        >
          {q.enabled ? 'Disable this question' : 'Enable this question'}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 6.2:** Run `pnpm type-check` (exits 0); `pnpm build` — completes, `/admin/questions/[id]` builds.
- [ ] **Step 6.3:** Commit.

```bash
git add "app/(app)/admin/questions/[id]/page.tsx" && git commit -F- <<'EOF'
feat(admin): question detail page

/admin/questions/[id] shows the full question — passage, choices with
the correct answer marked, explanation, metadata — and the enable/disable
toggle. notFound() for a missing id.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 7: conditional Admin nav link

**Files:** Modify `app/components/AppHeader.tsx`

- [ ] **Step 7.1:** In `app/components/AppHeader.tsx`, find this exact block:

```tsx
        <Link
          href="/analytics"
          className="text-sm text-slate-500 transition-colors hover:text-slate-900"
        >
          Analytics
        </Link>
      </nav>
```

and replace it with (the Analytics link unchanged, an admin-only Admin link added before `</nav>`):

```tsx
        <Link
          href="/analytics"
          className="text-sm text-slate-500 transition-colors hover:text-slate-900"
        >
          Analytics
        </Link>
        {profile?.role === 'admin' && (
          <Link
            href="/admin"
            className="text-sm text-slate-500 transition-colors hover:text-slate-900"
          >
            Admin
          </Link>
        )}
      </nav>
```

`profile` is already in scope (`const profile = await getOrCreateProfile()` near the top of the component).

- [ ] **Step 7.2:** Run `pnpm type-check` (exits 0), `pnpm lint` (no errors), `pnpm build` (completes).
- [ ] **Step 7.3:** Commit.

```bash
git add app/components/AppHeader.tsx && git commit -F- <<'EOF'
feat(admin): conditional Admin nav link

AppHeader shows an Admin link only when the signed-in user's profile
role is 'admin'.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 8: verification + docs

**Files:** Modify `README.md`, `CLAUDE.md`

- [ ] **Step 8.1:** Run `pnpm type-check`, `pnpm lint`, `pnpm build` — all pass.
- [ ] **Step 8.2 (controller):** MCP `execute_sql` — confirm a `draw_questions` result excludes a temporarily-disabled question (or, simpler: re-confirm `pg_get_functiondef` contains `q.enabled` twice).
- [ ] **Step 8.3:** Update `README.md` — add a concise "Admin" section: an admin-only `/admin` area to moderate the AI question pool (browse, filter, inspect, soft-disable/enable); only users with `profiles.role = 'admin'` can reach it.
- [ ] **Step 8.4:** Update `CLAUDE.md` — record the admin sub-project shipped (matching prior sub-projects). Gotchas: `/admin` is gated by `requireAdmin()` in `(app)/admin/layout.tsx` AND re-checked in every admin server action (404, not 403, for non-admins); admin writes use the service-role client through a role-gated `'use server'` action because `sat.questions` is RLS write-locked; `sat.questions.enabled` is a soft-disable and `draw_questions` filters it.
- [ ] **Step 8.5:** Commit.

```bash
git add README.md CLAUDE.md && git commit -F- <<'EOF'
docs(admin): sync README and CLAUDE.md for the admin sub-project

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

- [ ] **Step 8.6 (controller):** After the final whole-implementation review passes, tag: `git tag post-admin`.

---

## Plan Complete

Eight commits land on `main`: (1) `enabled` column + `draw_questions`, (2) `requireAdmin`, (3) admin queries, (4) `setQuestionEnabled` action, (5) admin layout + pool page + QuestionRow, (6) question detail page, (7) Admin nav link, (8) docs. Then the `post-admin` tag.

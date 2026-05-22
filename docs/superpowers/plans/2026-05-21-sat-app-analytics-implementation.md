# SAT-App Analytics — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A `/analytics` page showing the signed-in user's score trend, per-section and per-skill accuracy, focus areas, and summary stats.

**Architecture:** A `security invoker` RPC `sat.user_analytics()` does the `GROUP BY` aggregation over `sat.attempt_responses`; the score trend reuses `listAttempts()`. Pure helpers in `app/lib/analytics/compute.ts` derive summary stats / orderings; `getAnalytics()` assembles an `AnalyticsView`; a server-component page renders it with dependency-free SVG/CSS visuals.

**Tech Stack:** Next.js 15 · React 19 · TypeScript strict · pnpm · `@supabase/ssr` · Postgres.

**Spec:** [2026-05-21-sat-app-analytics-design.md](../specs/2026-05-21-sat-app-analytics-design.md)

**Builds on:** `post-persistence`. Lands six commits on `main`, tagged `post-analytics`.

**Verification:** `pnpm type-check` / `lint` / `build` + `scripts/check-analytics.ts` + MCP SQL. No unit-test runner (project convention).

**Shell:** Windows / PowerShell. Use the **Bash tool with a `cat <<'EOF'` here-doc** for every commit message. Run commands from `C:/Users/AbishekPotlapalli/Desktop/Projects/Personal/satpracticereact/sat-app`.

**Migration application:** the implementer writes & commits the `.sql` file; the **controller** applies it via `mcp__claude_ai_Supabase__apply_migration` and verifies.

**No new env vars.**

---

## Plan-wide File Structure

```
supabase/migrations/20260521060000_sat_user_analytics.sql   # CREATED (Task 1)
app/lib/analytics/compute.ts        # CREATED (Task 2)
app/lib/analytics/queries.ts        # CREATED (Task 3)
app/components/analytics/ScoreTrend.tsx      # CREATED (Task 4)
app/components/analytics/SkillAccuracy.tsx   # CREATED (Task 4)
app/(app)/analytics/page.tsx        # CREATED (Task 5)
app/components/AppHeader.tsx        # MODIFIED (Task 5: + Analytics link)
scripts/check-analytics.ts          # CREATED (Task 2)
README.md / CLAUDE.md               # MODIFIED (Task 6)
```

---

## Chunk 1: Data + compute

### Task 1: `sat.user_analytics()` migration

**Files:** Create `supabase/migrations/20260521060000_sat_user_analytics.sql`

- [ ] **Step 1.1:** Create `supabase/migrations/20260521060000_sat_user_analytics.sql` with EXACTLY:

```sql
-- Analytics sub-project — per-user skill/section accuracy aggregation.
-- security invoker: runs as the caller, so RLS on attempt_responses scopes the
-- rows; the explicit user_id filter is a clarity backstop. Read-only.
create or replace function sat.user_analytics()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_skills jsonb;
  v_sections jsonb;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  select coalesce(jsonb_agg(r order by r->>'section', r->>'skill'), '[]'::jsonb)
    into v_skills
  from (
    select jsonb_build_object(
      'section', section_key,
      'skill',   skill,
      'total',   count(*),
      'correct', count(*) filter (where is_correct)
    ) as r
    from sat.attempt_responses
    where user_id = v_user
    group by section_key, skill
  ) s;

  select coalesce(jsonb_agg(r order by r->>'section'), '[]'::jsonb)
    into v_sections
  from (
    select jsonb_build_object(
      'section', section_key,
      'total',   count(*),
      'correct', count(*) filter (where is_correct)
    ) as r
    from sat.attempt_responses
    where user_id = v_user
    group by section_key
  ) s;

  return jsonb_build_object('skills', v_skills, 'sections', v_sections);
end;
$$;

grant execute on function sat.user_analytics() to authenticated;
```

- [ ] **Step 1.2:** Commit.

```bash
git add supabase/migrations/20260521060000_sat_user_analytics.sql && git commit -F- <<'EOF'
feat(analytics): sat.user_analytics RPC

A security-invoker RPC returning the caller's per-skill and per-section
accuracy aggregates as JSON (the GROUP BYs supabase-js cannot express).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

- [ ] **Step 1.3 (controller):** Apply via `mcp__claude_ai_Supabase__apply_migration` (name `sat_user_analytics`).
- [ ] **Step 1.4 (controller):** Verify with `execute_sql`:

```sql
select proname, prosecdef as security_definer,
       pg_get_function_result(oid) as returns
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'sat' and proname = 'user_analytics';
```

Expected: one row, `security_definer = false`, `returns = jsonb`.

### Task 2: `compute.ts` pure helpers + scripted check

**Files:** Create `app/lib/analytics/compute.ts`, `scripts/check-analytics.ts`

- [ ] **Step 2.1:** Create `scripts/check-analytics.ts` with EXACTLY:

```ts
// Scripted check for app/lib/analytics/compute.ts (no unit-test runner — see CLAUDE.md).
// Run: pnpm dlx tsx scripts/check-analytics.ts
import {
  accuracyPct,
  sortSkillsWeakestFirst,
  focusAreas,
  summarize,
  type SkillStat,
} from '../app/lib/analytics/compute';
import type { AttemptSummary } from '../app/lib/persistence/queries';

function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('  ok —', msg);
}

assert(accuracyPct(0, 0) === 0, 'accuracyPct(0,0) === 0');
assert(accuracyPct(1, 2) === 50, 'accuracyPct(1,2) === 50');
assert(accuracyPct(2, 3) === 67, 'accuracyPct(2,3) rounds to 67');

const skills: SkillStat[] = [
  { section: 'rw', skill: 'Words in Context', total: 10, correct: 9 },
  { section: 'rw', skill: 'Command of Evidence', total: 10, correct: 3 },
  { section: 'math', skill: 'Linear equations', total: 8, correct: 4 },
  { section: 'math', skill: 'Ratios', total: 4, correct: 2 },
];

const sorted = sortSkillsWeakestFirst(skills);
assert(sorted[0].skill === 'Command of Evidence', 'weakest skill sorts first (30%)');
assert(sorted[sorted.length - 1].skill === 'Words in Context', 'strongest sorts last (90%)');
assert(sorted[1].skill === 'Linear equations' && sorted[2].skill === 'Ratios',
  '50% tie broken by total desc (8 before 4)');

const focus = focusAreas(skills, 3);
assert(focus.length === 3, 'focusAreas returns 3');
assert(focus[0].skill === 'Command of Evidence', 'focus area 0 is the weakest');
assert(focusAreas([], 3).length === 0, 'focusAreas([]) is empty');

const attempts = [
  { scaled_score: 1200 },
  { scaled_score: 900 },
  { scaled_score: 1500 },
] as unknown as AttemptSummary[];
const sum = summarize(attempts, skills);
assert(sum.testsTaken === 3, 'summarize testsTaken === 3');
assert(sum.bestScore === 1500, 'summarize bestScore === 1500');
assert(sum.averageScore === 1200, 'summarize averageScore === 1200');
assert(sum.questionsAnswered === 32, 'summarize questionsAnswered === 32');

const empty = summarize([], []);
assert(empty.testsTaken === 0 && empty.bestScore === 0 && empty.averageScore === 0,
  'summarize([], []) is all zeros');

console.log('\nALL CHECKS PASSED');
```

- [ ] **Step 2.2:** Run `pnpm dlx tsx scripts/check-analytics.ts` — expected: FAIL (module `../app/lib/analytics/compute` does not exist yet).

- [ ] **Step 2.3:** Create `app/lib/analytics/compute.ts` with EXACTLY:

```ts
import type { AttemptSummary } from '@/app/lib/persistence/queries';

export interface SkillStat {
  section: 'rw' | 'math';
  skill: string;
  total: number;
  correct: number;
}

export interface SectionStat {
  section: 'rw' | 'math';
  total: number;
  correct: number;
}

export interface TrendPoint {
  date: string;
  score: number;
}

export interface AnalyticsSummary {
  testsTaken: number;
  bestScore: number;
  averageScore: number;
  questionsAnswered: number;
}

export interface AnalyticsView {
  summary: AnalyticsSummary;
  sections: SectionStat[];
  skills: SkillStat[];
  trend: TrendPoint[];
}

// Percent correct, 0-100, integer. 0 when no questions.
export function accuracyPct(correct: number, total: number): number {
  return total === 0 ? 0 : Math.round((100 * correct) / total);
}

// Skills ascending by accuracy; ties → more-answered first, then skill name.
export function sortSkillsWeakestFirst(skills: SkillStat[]): SkillStat[] {
  return [...skills].sort((a, b) => {
    const pa = accuracyPct(a.correct, a.total);
    const pb = accuracyPct(b.correct, b.total);
    if (pa !== pb) return pa - pb;
    if (a.total !== b.total) return b.total - a.total;
    return a.skill.localeCompare(b.skill);
  });
}

// The n weakest skills the user has actually answered.
export function focusAreas(skills: SkillStat[], n = 3): SkillStat[] {
  return sortSkillsWeakestFirst(skills.filter((s) => s.total > 0)).slice(0, n);
}

// Summary stats from the attempt list + the per-skill totals.
export function summarize(
  attempts: AttemptSummary[],
  skills: SkillStat[],
): AnalyticsSummary {
  const scores = attempts.map((a) => a.scaled_score);
  const testsTaken = attempts.length;
  const bestScore = testsTaken === 0 ? 0 : Math.max(...scores);
  const averageScore =
    testsTaken === 0
      ? 0
      : Math.round(scores.reduce((s, n) => s + n, 0) / testsTaken);
  const questionsAnswered = skills.reduce((s, k) => s + k.total, 0);
  return { testsTaken, bestScore, averageScore, questionsAnswered };
}
```

- [ ] **Step 2.4:** Run `pnpm dlx tsx scripts/check-analytics.ts` — expected: all `ok —` lines, ending `ALL CHECKS PASSED`.
- [ ] **Step 2.5:** Run `pnpm type-check` — expected: exits 0.
- [ ] **Step 2.6:** Commit.

```bash
git add app/lib/analytics/compute.ts scripts/check-analytics.ts && git commit -F- <<'EOF'
feat(analytics): pure compute helpers + scripted check

accuracyPct, sortSkillsWeakestFirst, focusAreas, summarize — the
derivation logic for the analytics view, plus the AnalyticsView types.
Exercised by scripts/check-analytics.ts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 3: `getAnalytics()` query assembler

**Files:** Create `app/lib/analytics/queries.ts`

- [ ] **Step 3.1:** Create `app/lib/analytics/queries.ts` with EXACTLY:

```ts
import { createClient } from '@/app/lib/supabase/server';
import { listAttempts } from '@/app/lib/persistence/queries';
import {
  summarize,
  type AnalyticsView,
  type SkillStat,
  type SectionStat,
} from './compute';

interface UserAnalyticsRpc {
  skills: SkillStat[];
  sections: SectionStat[];
}

// Assembles the analytics view: per-skill/section aggregates from the
// user_analytics RPC, the score trend + summary from the attempt list.
export async function getAnalytics(): Promise<AnalyticsView> {
  const supabase = await createClient();
  const attempts = await listAttempts();

  let skills: SkillStat[] = [];
  let sections: SectionStat[] = [];
  const { data, error } = await supabase.schema('sat').rpc('user_analytics');
  if (error) {
    console.error('[getAnalytics] user_analytics rpc failed:', error);
  } else if (data) {
    const rpc = data as UserAnalyticsRpc;
    skills = rpc.skills ?? [];
    sections = rpc.sections ?? [];
  }

  // listAttempts is newest-first; the trend reads oldest-first.
  const trend = [...attempts]
    .reverse()
    .map((a) => ({ date: a.created_at, score: a.scaled_score }));

  return { summary: summarize(attempts, skills), sections, skills, trend };
}
```

- [ ] **Step 3.2:** Run `pnpm type-check` — expected: exits 0.
- [ ] **Step 3.3:** Run `pnpm lint` — expected: no errors.
- [ ] **Step 3.4:** Commit.

```bash
git add app/lib/analytics/queries.ts && git commit -F- <<'EOF'
feat(analytics): getAnalytics query assembler

Calls the user_analytics RPC for skill/section aggregates, reuses
listAttempts for the score trend and summary, returns an AnalyticsView.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

---

## Chunk 2: UI

### Task 4: visualization components

**Files:** Create `app/components/analytics/ScoreTrend.tsx`, `app/components/analytics/SkillAccuracy.tsx`

- [ ] **Step 4.1:** Create `app/components/analytics/ScoreTrend.tsx` with EXACTLY:

```tsx
import type { TrendPoint } from '@/app/lib/analytics/compute';

const W = 560;
const H = 180;
const PAD = 32;
const MIN = 400;
const MAX = 1600;

// Inline-SVG line chart of scaled score over attempts (oldest -> newest).
// No charting dependency. Plain (non-client) component.
export function ScoreTrend({ trend }: { trend: TrendPoint[] }) {
  if (trend.length === 0) return null;

  const x = (i: number) =>
    trend.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (trend.length - 1);
  const y = (score: number) =>
    H - PAD - ((score - MIN) / (MAX - MIN)) * (H - 2 * PAD);

  const points = trend.map((p, i) => ({ cx: x(i), cy: y(p.score), score: p.score }));
  const line = points.map((p) => `${p.cx},${p.cy}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Score trend">
      {[MIN, (MIN + MAX) / 2, MAX].map((g) => (
        <g key={g}>
          <line x1={PAD} y1={y(g)} x2={W - PAD} y2={y(g)} stroke="#e2e8f0" strokeWidth={1} />
          <text x={4} y={y(g) + 4} fontSize={10} fill="#94a3b8">{g}</text>
        </g>
      ))}
      {trend.length > 1 && (
        <polyline points={line} fill="none" stroke="#2563eb" strokeWidth={2} />
      )}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.cx} cy={p.cy} r={4} fill="#2563eb" />
          <text x={p.cx} y={p.cy - 10} fontSize={10} fill="#475569" textAnchor="middle">
            {p.score}
          </text>
        </g>
      ))}
    </svg>
  );
}
```

- [ ] **Step 4.2:** Create `app/components/analytics/SkillAccuracy.tsx` with EXACTLY:

```tsx
import {
  accuracyPct,
  sortSkillsWeakestFirst,
  type SkillStat,
} from '@/app/lib/analytics/compute';
import { SECTION_ORDER, SECTION_CONFIG } from '@/app/lib/questions';

function barColor(pct: number): string {
  if (pct < 60) return 'bg-red-500';
  if (pct < 80) return 'bg-amber-500';
  return 'bg-emerald-500';
}

// Per-skill accuracy bars, grouped by section, weakest skill first.
export function SkillAccuracy({ skills }: { skills: SkillStat[] }) {
  return (
    <div className="space-y-6">
      {SECTION_ORDER.map((section) => {
        const rows = sortSkillsWeakestFirst(
          skills.filter((s) => s.section === section),
        );
        if (rows.length === 0) return null;
        return (
          <div key={section}>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">
              {SECTION_CONFIG[section].name}
            </h3>
            <div className="space-y-2">
              {rows.map((s) => {
                const pct = accuracyPct(s.correct, s.total);
                return (
                  <div key={s.skill}>
                    <div className="flex justify-between text-xs text-slate-600">
                      <span>{s.skill}</span>
                      <span>
                        {s.correct}/{s.total} · {pct}%
                      </span>
                    </div>
                    <div className="mt-0.5 h-2 rounded-full bg-slate-200">
                      <div
                        className={`h-full rounded-full ${barColor(pct)}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4.3:** Run `pnpm type-check` — expected: exits 0.
- [ ] **Step 4.4:** Commit.

```bash
git add app/components/analytics/ScoreTrend.tsx app/components/analytics/SkillAccuracy.tsx && git commit -F- <<'EOF'
feat(analytics): ScoreTrend + SkillAccuracy visual components

Dependency-free: ScoreTrend is an inline-SVG line chart; SkillAccuracy
is CSS accuracy bars grouped by section, weakest-first, colour-graded.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 5: `/analytics` page + header link

**Files:** Create `app/(app)/analytics/page.tsx`; modify `app/components/AppHeader.tsx`

- [ ] **Step 5.1:** Create `app/(app)/analytics/page.tsx` with EXACTLY:

```tsx
import Link from 'next/link';
import { getOrCreateProfile } from '@/app/lib/auth/profile';
import { getAnalytics } from '@/app/lib/analytics/queries';
import { accuracyPct, focusAreas } from '@/app/lib/analytics/compute';
import { ScoreTrend } from '@/app/components/analytics/ScoreTrend';
import { SkillAccuracy } from '@/app/components/analytics/SkillAccuracy';
import { SECTION_CONFIG } from '@/app/lib/questions';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-center">
      <div className="text-2xl font-bold text-blue-600">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

export default async function AnalyticsPage() {
  const profile = await getOrCreateProfile();
  const { summary, sections, skills, trend } = await getAnalytics();

  if (summary.testsTaken === 0) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-2 text-2xl font-bold">Your analytics</h1>
        <p className="text-slate-600">
          Signed in as {profile?.full_name || profile?.email}.
        </p>
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 p-8 text-center">
          <p className="text-slate-600">Take a test to see your analytics.</p>
          <Link href="/" className="mt-3 inline-block text-blue-600 underline">
            Start a test
          </Link>
        </div>
      </main>
    );
  }

  const focus = focusAreas(skills);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Your analytics</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tests taken" value={summary.testsTaken} />
        <Stat label="Best score" value={summary.bestScore} />
        <Stat label="Average score" value={summary.averageScore} />
        <Stat label="Questions answered" value={summary.questionsAnswered} />
      </div>

      <section className="mt-8">
        <h2 className="mb-2 text-base font-semibold">Score trend</h2>
        <div className="rounded-lg border border-slate-200 p-4">
          <ScoreTrend trend={trend} />
        </div>
      </section>

      {sections.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">Section accuracy</h2>
          <div className="space-y-2">
            {sections.map((s) => {
              const pct = accuracyPct(s.correct, s.total);
              return (
                <div key={s.section}>
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>{SECTION_CONFIG[s.section].name}</span>
                    <span>
                      {s.correct}/{s.total} · {pct}%
                    </span>
                  </div>
                  <div className="mt-0.5 h-2.5 rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {focus.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">Focus areas</h2>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-800">
              Your weakest skills — worth some practice:
            </p>
            <ul className="mt-2 space-y-1">
              {focus.map((s) => (
                <li key={s.skill} className="text-sm text-amber-900">
                  {s.skill} — {accuracyPct(s.correct, s.total)}% ({s.correct}/
                  {s.total})
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {skills.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">Skill breakdown</h2>
          <SkillAccuracy skills={skills} />
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 5.2:** In `app/components/AppHeader.tsx`, find this exact block:

```tsx
        <Link
          href="/dashboard"
          className="text-sm text-slate-500 transition-colors hover:text-slate-900"
        >
          Dashboard
        </Link>
```

and add an Analytics link immediately after it (inside the same `<nav>`):

```tsx
        <Link
          href="/dashboard"
          className="text-sm text-slate-500 transition-colors hover:text-slate-900"
        >
          Dashboard
        </Link>
        <Link
          href="/analytics"
          className="text-sm text-slate-500 transition-colors hover:text-slate-900"
        >
          Analytics
        </Link>
```

- [ ] **Step 5.3:** Run `pnpm type-check` → exits 0; `pnpm lint` → no errors; `pnpm build` → completes, `/analytics` builds.
- [ ] **Step 5.4:** Commit.

```bash
git add "app/(app)/analytics/page.tsx" app/components/AppHeader.tsx && git commit -F- <<'EOF'
feat(analytics): /analytics page + header link

Server-component page: summary stats, score trend, section accuracy,
focus-areas callout, full skill breakdown — with an empty state for
users with no attempts. AppHeader gains an Analytics nav link.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

### Task 6: verification, docs, tag

**Files:** Modify `README.md`, `CLAUDE.md`

- [ ] **Step 6.1:** Run `pnpm type-check`, `pnpm lint`, `pnpm build`, and `pnpm dlx tsx scripts/check-analytics.ts` — all must pass.
- [ ] **Step 6.2 (controller):** MCP `execute_sql` — confirm `user_analytics` exists with `prosecdef = false`; call `select sat.user_analytics();` returns a `{skills, sections}` jsonb.
- [ ] **Step 6.3:** Update `README.md` (a short "Analytics" section: the `/analytics` page, what it shows) and `CLAUDE.md` (note the analytics sub-project shipped; gotcha: `user_analytics` is `security invoker` — a read aggregation, RLS-scoped, unlike the definer write RPCs).
- [ ] **Step 6.4:** Commit.

```bash
git add README.md CLAUDE.md && git commit -F- <<'EOF'
docs(analytics): sync README and CLAUDE.md for the analytics sub-project

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
```

- [ ] **Step 6.5 (controller):** After the final whole-implementation review passes, tag: `git tag post-analytics`.

---

## Plan Complete

Six commits land on `main`: (1) `user_analytics` RPC, (2) compute helpers + check, (3) `getAnalytics`, (4) visual components, (5) `/analytics` page + header link, (6) docs. Then the `post-analytics` tag.

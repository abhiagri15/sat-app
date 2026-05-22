# SAT Prep — Analytics Sub-Project Design

**Date:** 2026-05-21
**Status:** Approved for plan-writing (autonomous build — design decisions made by the implementer per the stakeholder's standing instruction to proceed without per-step approval)
**Sub-project:** #5 of 7 — Analytics
**Builds on:** Foundation (#1), Auth (#3), AI (#2), Persistence (#4, `post-persistence`)

---

## 1. Context

Persistence (#4) saves every submitted test: `sat.test_attempts` (score, date) and
`sat.attempt_responses` (one row per question, with `skill`, `section_key`,
`is_correct`). It deliberately stored per-question detail in a real table so this
sub-project can aggregate it. `/dashboard` is a plain history list.

This sub-project adds a **`/analytics`** page that turns that stored data into
insight: a score trend over time, per-section and per-skill accuracy, and a
"focus areas" callout naming the user's weakest skills so they know what to
study.

## 2. Scope

### In scope
- **`sat.user_analytics()`** — a `security invoker` RPC returning the caller's
  per-skill and per-section accuracy aggregates as JSON (the `GROUP BY`s
  `supabase-js` cannot express directly).
- **`/analytics`** page (server component) under the `(app)` route group.
- **Score trend** — a dependency-free inline-SVG line chart of `scaled_score`
  over attempts (chronological).
- **Per-section accuracy** — Reading & Writing vs. Math.
- **Per-skill accuracy** — every skill the user has answered, as horizontal
  bars grouped by section, weakest-first, colour-graded.
- **Focus areas** — a callout naming the 3 weakest skills.
- **Summary stats** — tests taken, best score, average score, questions answered.
- An **Analytics** link in `AppHeader`.
- Pure compute helpers + a `scripts/check-analytics.ts` scripted check.
- Docs sync + a `post-analytics` git tag.

### Out of scope
- Predictive scoring / target-score projection.
- Per-question-difficulty analytics across users (that needs cross-user data;
  this is a per-user view).
- Date-range filtering, CSV export.
- A charting library — visuals are hand-built SVG/CSS (the app is already
  dependency-light; `ResultsScreen` uses a CSS bar).
- Automated test runner — verification is `type-check` + `lint` + `build` + a
  scripted check + MCP SQL, matching #4.

### Acceptance criteria
1. `pnpm type-check`, `pnpm lint`, `pnpm build` succeed.
2. `sat.user_analytics()` exists, runs as the caller, returns only the caller's
   data, and `authenticated` has `execute`.
3. `/analytics` renders the score trend, section accuracy, focus areas, the full
   per-skill breakdown, and the summary stats for the signed-in user.
4. A user with no attempts sees a friendly empty state, no crash.
5. `AppHeader` links to `/analytics`.
6. `scripts/check-analytics.ts` passes.

## 3. Architecture decisions

| # | Decision | Rationale |
|---|---|---|
| A1 | Per-skill / per-section aggregation is a **`security invoker` RPC** (`sat.user_analytics()`), not JS aggregation over all rows and not `security definer`. | `supabase-js` cannot express `GROUP BY`. A read-only aggregation needs no privilege elevation: run as the caller, RLS on `attempt_responses` scopes the rows; the function also filters `user_id` explicitly for clarity. Unlike `draw_questions`/`save_attempt` (definer — they *write*), this only reads. |
| A2 | The **score trend reuses `listAttempts()`** from `app/lib/persistence/queries.ts`; the RPC handles only the `attempt_responses` `GROUP BY`s. | `test_attempts` rows are already a clean per-attempt list (`created_at`, `scaled_score`). No need to duplicate that in SQL. One RPC call + one existing query. |
| A3 | **Visuals are hand-built SVG/CSS**, no charting dependency. | The app is deliberately dependency-light. A line chart is ~40 lines of SVG; skill accuracy is CSS bars like `ResultsScreen`'s. A chart library would be disproportionate. |
| A4 | A dedicated **`/analytics`** route, separate from `/dashboard`. | `/dashboard` stays the attempt history list (#4's job); analytics is a distinct concern with its own page and header link. |
| A5 | **Pure compute helpers** (`app/lib/analytics/compute.ts`) hold all derivation logic (summary stats, weakest-first sort, accuracy %, focus areas); the page and RPC wrapper stay thin. | Keeps the logic testable by `scripts/check-analytics.ts` (the project has no unit-test runner) and the page a thin composition. |

## 4. Data model

No new tables. One function:

```sql
-- supabase/migrations/20260521060000_sat_user_analytics.sql
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

`security invoker` (the default) means RLS on `attempt_responses` applies; the
explicit `where user_id = v_user` is a clarity backstop. The function reads
only — no write, no definer rights.

## 5. Application structure

```
supabase/migrations/20260521060000_sat_user_analytics.sql   # CREATED
app/lib/analytics/
  compute.ts        # CREATED: pure helpers + the AnalyticsView type
  queries.ts        # CREATED: getAnalytics() — calls the RPC + listAttempts, returns AnalyticsView
app/components/analytics/
  ScoreTrend.tsx    # CREATED: inline-SVG line chart of scaled_score over attempts
  SkillAccuracy.tsx # CREATED: per-skill horizontal accuracy bars, grouped by section
app/(app)/analytics/page.tsx   # CREATED: the analytics page
app/components/AppHeader.tsx   # MODIFIED: + Analytics nav link
scripts/check-analytics.ts     # CREATED: scripted check of compute.ts
README.md / CLAUDE.md          # MODIFIED
```

### 5.1 `compute.ts`
Pure, no I/O. Exports:
- Types: `SkillStat { section: 'rw'|'math'; skill: string; total: number; correct: number }`,
  `SectionStat { section: 'rw'|'math'; total: number; correct: number }`,
  `AnalyticsSummary { testsTaken: number; bestScore: number; averageScore: number; questionsAnswered: number }`,
  `TrendPoint { date: string; score: number }`,
  `AnalyticsView { summary; sections: SectionStat[]; skills: SkillStat[]; trend: TrendPoint[] }`.
- `accuracyPct(correct, total): number` — `total === 0 ? 0 : round(100*correct/total)`.
- `sortSkillsWeakestFirst(skills): SkillStat[]` — ascending by accuracy %, tie-broken by `total` desc then skill name.
- `focusAreas(skills, n = 3): SkillStat[]` — the `n` weakest skills (weakest-first), only skills with `total > 0`.
- `summarize(attempts, skills): AnalyticsSummary` — `testsTaken` = attempts length, `bestScore`/`averageScore` from `scaled_score` (averageScore rounded; both 0 when no attempts), `questionsAnswered` = sum of `skills[].total`.

### 5.2 `queries.ts`
`getAnalytics(): Promise<AnalyticsView>` — server-only. Calls `supabase.schema('sat').rpc('user_analytics')` for `{ skills, sections }`, calls `listAttempts()` for the attempts, builds `trend` (attempts oldest→newest: `{ date: created_at, score: scaled_score }`), and `summary` via `summarize`. On RPC error, logs and returns empty skills/sections (the page still renders the trend + summary).

### 5.3 Components
- **`ScoreTrend`** — props `{ trend: TrendPoint[] }`. Inline SVG line chart, y-axis fixed 400–1600, x evenly spaced by attempt order, a dot per point. 0 points → nothing (page shows empty state); 1 point → a single dot with its score label.
- **`SkillAccuracy`** — props `{ skills: SkillStat[] }`. Groups by section (Reading & Writing, then Math), each skill a row: name, `correct/total`, a horizontal bar whose width is the accuracy % and whose colour is graded (`< 60` red, `60–79` amber, `>= 80` green). Within a section, weakest-first.

### 5.4 `/analytics` page
Server component. `getOrCreateProfile()` for the greeting; `getAnalytics()` for data.
- **Empty state** (`summary.testsTaken === 0`): a card — "Take a test to see your analytics" + a link to `/`.
- Otherwise, in order: summary stat cards (tests taken, best score, average score, questions answered); `ScoreTrend`; per-section accuracy (two bars); a **Focus areas** callout listing `focusAreas(skills)` (skipped if no skills); the full `SkillAccuracy` breakdown.

### 5.5 `AppHeader`
Add an `Analytics` link next to `Dashboard`, same styling.

## 6. Security
- `user_analytics()` is `security invoker`; RLS on `attempt_responses` confines it
  to the caller, and it also filters `user_id` explicitly. No definer rights, no
  way to read another user's aggregates.
- `/analytics` is inside the `(app)` route group — already session-gated by
  `middleware.ts`. No new gating needed.
- No new secrets, no service-role usage.

## 7. Verification
- `pnpm type-check`, `pnpm lint`, `pnpm build` clean.
- `scripts/check-analytics.ts` — asserts `compute.ts` behaviour (accuracy %,
  weakest-first ordering, focus-area selection, summary maths, empty inputs).
- MCP SQL: `user_analytics()` exists, `prosecdef = false` (invoker), `authenticated`
  has `execute`; calling it returns the `{ skills, sections }` shape.
- Manual: `/analytics` renders for a user with attempts and shows a sane empty
  state for a user without.

## 8. Next steps
Spec review → `superpowers:writing-plans` → `superpowers:subagent-driven-development`
→ commits on `main`, tag `post-analytics`.

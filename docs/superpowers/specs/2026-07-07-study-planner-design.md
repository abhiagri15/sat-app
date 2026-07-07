# Study Planner + Miss-Reason Tagging — Design

**Date:** 2026-07-07
**Status:** Approved (user directive; the "professional market readiness" gap)
**Sub-project:** #18

## Problem

Every professional competitor (UWorld, Acely, PrepScholar, Khan) turns
diagnosis into a SCHEDULE: target score, test date, "do this next," overdue
review. The app diagnoses brilliantly (focus areas, pacing, coach updates)
but never tells the student what to do this week. And when a student misses
a question, nobody asks WHY — concept gap and careless error need opposite
remedies, and that signal feeds both the plan and the coach.

## A. Miss-reason tagging

- **Data:** `miss_reason text null` on BOTH response tables, CHECK in
  `('concept','careless','time_pressure','misread','setup','vocab')`.
- **Write path:** security-definer RPC
  `sat.tag_miss_reason(p_origin text, p_response_id uuid, p_reason text)` —
  `p_origin in ('test','practice')` picks the table; the UPDATE is guarded
  `where id = p_response_id and user_id = auth.uid() and is_correct =
  false`; a non-matching id is a SILENT no-op (return false), never a
  raise — a stale client id must not 500. `p_reason` null clears the tag
  (re-taggable); non-null values validated against the closed set (the
  column CHECK is the backstop). `grant execute to authenticated`. No write
  policies (standing rule). **Single source for the enum:** an exported
  `MISS_REASONS` const (value + label + prompt phrasing) that the zod
  union, the six UI chips, and the guidance phrasing all derive from — only
  the SQL CHECK duplicates it (note beside the SKILLS two-places gotcha).
- **UI — "Why did you miss this?" chip row** (one-tap, six labeled chips:
  Didn't know the concept · Careless slip · Ran out of time · Misread it ·
  Set it up wrong · Vocabulary), selected chip highlighted, tappable to
  change. Surfaces:
  1. **Attempt review** (`/dashboard/attempts/[id]`): response row ids are
     already selected — render under each incorrect `ReviewItem`.
  2. **Drill summary recap:** practice response ids are fetched after save
     via an RLS-scoped select on `practice_responses` by `session_id`
     (select-own policy + `(session_id, position)` index already exist),
     mapped by `position` — the drill index the client sent, which
     `save_practice` persists verbatim. Chips render ONLY on incorrect
     rows (the RPC rejects correct ones).
  Post-test results-screen review is EXCLUDED v1 (in-memory questions lack
  response ids; the attempt page is one click away).
- **Consumers:** `sat.skill_evidence` gains a `miss_reason` column. The
  RETURNS TABLE signature changes, and Postgres forbids CREATE OR REPLACE
  from changing a return type → the migration must `DROP FUNCTION
  sat.skill_evidence(text,int)` and recreate — **and a DROP loses the ACL:
  the recreate MUST re-issue `grant execute ... to authenticated` and keep
  `security invoker` + `set search_path to ''`** (unlike the
  CREATE-OR-REPLACE cases that preserve ACLs). `miss_reason` reads straight
  off the response row (no new join; the questions LEFT join stays).
  Feeding the guidance prompt is a THREE-place change: `GuidanceEvidenceItem`
  gains `missReason: string | null` (provider.ts), the guidance route maps
  it through, and the Ollama prompt renders it ("student's own read:
  careless slip") when present. The planner (below) consumes per-skill
  reason mixes via a NEW invoker RPC **`sat.miss_reason_mix()`** (security
  INVOKER, `grant execute to authenticated`, the `user_analytics`
  precedent): tagged incorrect responses across both tables grouped by
  `(skill, miss_reason)` with counts.

## B. Study Planner

### Data

- **`sat.study_plans`:** `user_id uuid pk`, `target_score int` (400–1600),
  `test_date date null`, `sessions_per_week int` (2–7, default 4),
  `created_at`, `updated_at`. RLS select-own; writes via security-definer
  `sat.upsert_study_plan(p_target int, p_test_date date, p_sessions int)`
  (sets `user_id := auth.uid()`, validates bounds). `grant execute to
  authenticated`.
- No plan-item storage: **the weekly plan is COMPUTED, and completion is
  DERIVED from actual activity** — a plan item is "done" when a matching
  drill/test exists this ISO week. No checkboxes to maintain, can't go
  stale.

### Plan computation (pure, deterministic — no AI in v1)

`app/lib/planner/compute.ts`, covered by `scripts/check-planner.ts`:

- **Inputs** (one `PlannerInputs` object, assembled by a server query):
  per-skill test accuracy (the focus-area stats), per-skill practice
  recency + drill counts (from `practice_skill_stats`), per-skill dominant
  miss reasons (new small aggregate), tests taken + last-test date +
  latest/average estimated score, the plan row, and `today`.
- **`buildWeekPlan(inputs): PlanItem[]`** — fills `sessions_per_week` slots
  in priority order:
  1. Drill focus-area skill #1 (weakest tested skill).
  2. Drill focus-area skill #2.
  3. "Review your misses" — drill the skill with the most recent wrong
     answers (missed-first drilling already targets exactly those).
  4. A short test if none this week; a FULL test instead when `test_date`
     is ≥ 14 days away and no full test in the last 14 days.
  5. Remaining slots: overdue skills (below), weakest first.
  Each `PlanItem`: `{kind: 'drill'|'test', skill?, slug?, label, why,
  done: boolean, href}` — `done` derived from this week's
  sessions/attempts. `why` is one plain sentence citing the evidence
  ("42% on tests · mostly 'ran out of time' misses").
- **`overdueSkills(inputs): OverdueSkill[]`** — tested accuracy < 75% AND
  (never drilled OR last practiced > 14 days ago), weakest first, capped 8.
  "Never drilled" = absent from the practice-stats map — the helper
  iterates the full `SKILLS` taxonomy, never just the practiced keys (the
  zero-history fixture asserts never-drilled skills surface).
- **`paceSummary(inputs)`** — current estimate (average of last 3 test
  scores, else last), target, gap, days/weeks to test date, and a one-line
  pace note. Reason-aware tip: when a skill's dominant miss reason is
  `time_pressure`, its item's `why` says pacing (drill untimed, then watch
  the pacing panel); when `careless`, it says accuracy-over-speed.

### UI

- **`/plan` page** (session-gated; "Plan" in `AppHeader` between Practice
  and Analytics):
  - **Setup card** (no plan row yet): target score slider/select, optional
    test date, sessions per week → server action calling the upsert RPC.
  - **Plan view:** pace header (estimate → target, gap, countdown) · "This
    week" list of `PlanItem`s (done items checked + dimmed; each links to
    the drill `?drill=1` or `/` for tests) · "Overdue skills" chips →
    practice pages · an edit affordance back to setup.
  - Empty-data state: no tests yet → the plan leads with "Take your first
    test" and seeds drills from untested-but-important skills (planner
    handles zero-history inputs without throwing — check-script case).
- **"Do this next" card** on the Practice hub (top, one item: the first
  not-done plan item; links to `/plan`) and a one-liner on the test start
  screen when a plan exists.

## Security invariants

- Both new write paths are definer RPCs setting/checking `auth.uid()`; no
  write policies anywhere. `study_plans` numbers are bounds-checked in SQL.
  Miss reasons are a closed enum (CHECK constraint + zod-side literal
  union). Planner reads are all RLS-scoped user-client queries or existing
  invoker RPCs.

## Testing

- `scripts/check-planner.ts` — fixtures: rich history (all five slot rules
  fire, done-derivation works), zero history (no throw, sensible seed
  plan), test-date near vs far (full-test slot logic), time-pressure vs
  careless reason mixes change the `why` strings, overdue capping/sorting.
- Tag RPC smoke live (own row taggable, wrong-owner/correct-row rejected).
- Gates: type-check, lint, build.

## Deferred

AI-written weekly narrative; calendar/ICS export; notifications; manual
plan-item checkoffs; miss-reason analytics page; results-screen tagging.

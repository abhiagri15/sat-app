# Focus-Area Practice — Design

**Date:** 2026-07-07
**Status:** Approved (design decisions delegated to Claude as thought partner)
**Sub-project:** #13 — Practice

## Problem

Students can see their weakest skills on `/analytics` ("Focus areas"), but the app
gives them nothing to *do* about it. The only activity is taking another full or
short test — which draws across all skills, gives no instruction, and defers all
feedback to the end. Professional prep products (Khan Academy, UWorld, Bluebook
companion apps) pair weakness diagnosis with two things the app lacks:

1. **Study material** — a concise, skill-specific lesson: what the skill tests,
   how to approach it, a worked example, and the traps to avoid.
2. **Targeted drills** — short, untimed practice sets scoped to one skill, with
   **immediate feedback** (answer → check → explanation) instead of end-of-test
   review, prioritising the questions the student previously got wrong.

## Goal

A new student-facing **Practice** section that closes the diagnose → learn →
drill → re-measure loop:

- `/practice` — a hub that leads with the student's focus areas (from existing
  test analytics) and offers the full skill catalog below.
- `/practice/[skill]` — a per-skill page: lesson + the student's stats + an
  untimed drill runner with instant feedback and an end-of-drill recap.

Visual quality bar: consistent with the existing app (Tailwind, slate/blue/amber
palette, card-based layout, dependency-free SVG/CSS) and comparable to
professional prep sites — clear hierarchy, mastery tiers, progress indication,
empty states, responsive, keyboard-accessible.

## Decisions (thought-partner Q&A, with rationale)

| Question | Decision | Why |
|---|---|---|
| Lesson source | **Static, hand-authored-in-code lessons** (one per skill, TS objects) | Quality control (a real student already flagged AI authenticity problems once); zero runtime latency/cost; versioned and reviewable in git; server-renderable. AI-on-demand (Option B) adds latency, cost, and quality variance for content that rarely changes. |
| Drill question source | Existing `sat.questions` pool via a new `sat.draw_drill` RPC | The pool is 4,400+ strong with per-skill floors; no new generation path needed. |
| Missed-question review | Drills serve **currently-missed questions first** (latest recorded answer was wrong), capped at half the drill, then fresh unseen, then least-recently-served | Re-practicing your own mistakes is the highest-value drill content; capping at half keeps new material flowing. |
| Feedback model | **Immediate per-question feedback**, untimed | This is the pedagogical differentiator vs tests. Tests measure; drills teach. |
| Persistence | New `sat.practice_sessions` + `sat.practice_responses` tables, written via a `sat.save_practice` security-definer RPC | Keeps test analytics pure (tests remain the score-validity measurement); mirrors the proven `save_attempt` pattern. |
| Analytics impact | Practice does **not** feed `/analytics` (test-based). The Practice hub shows both test accuracy (focus-area driver) and practice stats per skill | Preserves the meaning of test analytics; improvement shows up on the next test — which is the honest signal. |
| Served tracking | Drill draws **upsert `sat.served_questions`** like test draws | A question you drilled must never appear on a later test as "unseen" material; the demand-driven generator replenishes the buffer. |
| Daily limit | Drills are **not** limited (the daily test limit stays test-only) | Practice should be frictionless; draws come from the existing pool at no marginal cost. |
| Scope | No spaced repetition, no timed drill mode, no admin views, no generator changes | YAGNI — see Deferred. |

## Approaches considered

- **A (chosen): static lessons + pool-drawn drills + dedicated practice tables.**
  Maximum reuse of proven patterns (`draw_questions`, `save_attempt`, RLS
  select-only + security-definer writes, check scripts), no new dependencies.
- **B: AI-generated lessons on demand with DB caching.** Richer, but adds an AI
  call to a page students hit daily, plus caching/invalidation machinery, and
  re-opens the authenticity risk the May 29 fix closed.
- **C: drills only, no lessons.** Halves the build but misses the "study
  material" half of the requirement.

## Architecture

### Routes (both session-gated by existing middleware)

- **`/practice`** — server component (hub).
  - **Focus areas hero**: top-3 weakest skills from `sat.user_analytics()` +
    `focusAreas()` (reused as-is). Each card: skill name, domain, test accuracy,
    practice stats (drills, last practiced), mastery tier chip, and two CTAs —
    **Learn** and **Practice** (both → `/practice/[slug]`, Practice deep-links
    the drill via `?drill=1`).
  - **Skill catalog**: all skills grouped section → domain. Each row: skill
    name, test-accuracy chip (or "not yet tested"), practice count, link.
  - **Empty state** (no tests taken): banner "Take a test to get personalized
    focus areas" + full catalog still browsable — drills work without test
    history.
- **`/practice/[skill]`** — server component (param = slug); renders:
  - **Lesson** (`LessonView`): what the skill tests, strategy steps, one worked
    example (authentic Digital SAT archetype), traps to avoid.
  - **Your stats**: test accuracy for the skill, drills taken, practice
    accuracy, last practiced.
  - **Drill runner** (`SkillDrill`, `'use client'`): the interactive part.
  - Unknown slug → `notFound()`.

### Drill runner FSM (`usePracticeSession` hook + `SkillDrill` component)

States: `idle → loading → drilling → summary` (+ `error` from loading).

- `start()`: calls `drawDrill(skill, 10)` (client, browser Supabase → RPC),
  shuffles each MCQ's choices via the existing `shuffleChoices` (remaps
  `answerIndex`), enters `drilling`.
- `drilling`: one question at a time. MCQ → choice list; SPR → existing
  `SprInput`. **Check** button → grades locally (MCQ: index compare; SPR:
  existing `isSprCorrect`) and shows the feedback panel: correct/incorrect,
  the correct answer, the explanation (source-branched rendering exactly like
  `ReviewItem` — seed HTML trusted, AI React-escaped), and the existing
  `FlagQuestion` widget so bad questions can be reported from drills too.
  **Next** advances; progress bar + running correct/streak counters on top.
- `summary`: score, per-question recap (compact), CTAs: **Practice again**,
  **Back to practice**, **Next focus area** (when the hub passed one). A
  save-status line (saving / saved / retry button on failure).
- Save: fires once on entering `summary` (guarded ref, like `useTestSession`) —
  `savePractice(payload)` server action → `sat.save_practice` RPC, with a
  client-generated `sessionUuid` for idempotent retry.

### New lib modules

| Module | Kind | Contents |
|---|---|---|
| `app/lib/lessons/types.ts` | pure | `Lesson` interface: `skill`, `overview: string[]`, `strategies: {title, body}[]`, `workedExample: {passage?, prompt, choices?, correct, walkthrough}`, `traps: string[]` |
| `app/lib/lessons/rw-information-ideas.ts` (+7 siblings, one per domain) | pure data | Lessons for that domain's skills |
| `app/lib/lessons/index.ts` | pure | `LESSONS` registry, `getLesson(skill)` |
| `app/lib/practice/slug.ts` | pure | `skillSlug(skill)` / `slugToSkill(slug)` over the `SKILLS` taxonomy (kebab-case, punctuation stripped; collision-checked) |
| `app/lib/practice/draw.ts` | `'use client'` | `drawDrill(skill, count)` → `sat.draw_drill` RPC → `rowToQuestion` (mirrors `pool.ts` conventions) |
| `app/lib/practice/payload.ts` | pure | `toPracticePayload()` mapper (no I/O) |
| `app/lib/practice/schema.ts` | pure | zod payload schema — **lists every wire field** incl. SPR fields (strip-mode gotcha), `.refine` for per-format choices rule |
| `app/lib/practice/actions.ts` | `'use server'` | `savePractice()` — zod-validate → `sat.save_practice`; failures logged to `sat.save_failures` with `context.kind='practice'` |
| `app/lib/practice/queries.ts` | server | `getPracticeSkillStats()` (via new RPC), `getSkillPageData(skill)` |
| `app/hooks/usePracticeSession.ts` | `'use client'` | Drill FSM (above) |

New components under `app/components/practice/`: `LessonView` (plain,
server-renderable), `SkillCatalog` (plain), `FocusAreaCard` (plain),
`SkillDrill` + `DrillQuestion` + `DrillSummary` (`'use client'`).
Mastery tiers used consistently: `<60%` Needs work (amber), `60–79%` Improving
(blue), `≥80%` Strong (green); rendered as chips, computed by a small pure
helper in `app/lib/practice/mastery.ts`.

### Integration touches (existing files)

- `AppHeader.tsx`: add **Practice** link (between Dashboard and Analytics).
- `/analytics` focus-areas callout: each skill links to `/practice/[slug]`
  ("Practice this skill →").
- `ResultsScreen.tsx`: post-test CTA linking to `/practice`.

### Database (one migration, `20260707000000_sat_practice.sql`)

- **`sat.practice_sessions`**: `id uuid pk`, `user_id`, `session_uuid uuid`,
  `section`, `skill`, `total int`, `correct int`, `created_at`. Partial unique
  `(user_id, session_uuid)` for idempotent resave.
- **`sat.practice_responses`**: `id`, `session_id fk`, `user_id`, `position`,
  `question_id`, `skill`, `source`, `passage`, `prompt`, `choices jsonb`,
  `answer_index`, `explanation`, `chosen_index`, `is_correct`,
  `response_format`, `entered_value`, `correct_answer`, `answer_tolerance` —
  the same *as-presented snapshot* discipline as `attempt_responses`.
- **RLS**: both tables select-only scoped to `auth.uid()`, **no write
  policies** — writes go exclusively through the RPC (project standing rule).
  Grants: `select` to `authenticated`; full privileges + schema `USAGE`
  confirmation for `service_role` (the Foundation grants gotcha).
- **`sat.draw_drill(p_skill text, p_count int default 10)`** — security
  definer, mirrors `draw_questions` structure. Tiers, de-duplicated, all
  `enabled`-filtered, capped `p_count ≤ 30`:
  1. **Currently-missed** (≤ `ceil(p_count/2)`): questions whose *latest*
     recorded answer by this user was wrong — latest across
     `attempt_responses` (timestamp via parent `test_attempts.created_at`) and
     `practice_responses` (via parent session `created_at`), most recent miss
     first. A question later answered correctly in practice drops out.
  2. **Fresh**: never in `served_questions` for this user, `order by random()`.
  3. **Recycled**: least-recently-served.
  Upserts `served_questions` for everything returned (tests never re-serve
  drilled material as unseen). Returns `SETOF sat.questions`.
- **`sat.save_practice(p_session jsonb, p_responses jsonb)`** — security
  definer. Sets `user_id := auth.uid()`; short-circuits on existing
  `(user_id, session_uuid)` **before** any insert (idempotent resave);
  **re-verifies correctness server-side** (MCQ: `chosen_index = answer_index`
  from the snapshot; SPR: re-join `sat.questions` by `question_id` →
  `sat.spr_is_correct` — client-claimed correctness is ignored, same posture
  as `save_attempt`); inserts session + responses transactionally; returns the
  session id. No daily-limit check.
- **`sat.practice_skill_stats()`** — **security invoker** (read-only over
  RLS-scoped tables, per the `user_analytics` precedent; keep the explicit
  `user_id = auth.uid()` clarity backstop): per skill → sessions count,
  questions, correct, `last_practiced`.
- All `RETURNS TABLE` functions: `#variable_conflict use_column` (the 42702
  bite-mark from admin_users_search).

### Lesson content rules (authoring contract)

- One lesson per skill in `SKILLS` — completeness is script-enforced.
- Worked examples must follow the authentic Digital SAT archetypes (the
  `RW_ARCHETYPES` rules: student-notes format for Rhetorical Synthesis, literal
  punctuation choices for Boundaries, Text 1/Text 2 for Cross-Text, etc.) and
  the global authenticity rules (no trivial items, no "underlined" references,
  no their-vs-his-or-her pronoun traps).
- Never reference choices by letter ("Choice A") — quote content instead
  (consistency with the app-wide rule; lessons render statically but the rule
  stays uniform).
- Plain text/strings only (rendered React-escaped); no HTML in lesson bodies.
- Voice: direct, second-person, coach-like; overview ≤ 3 short paragraphs,
  3–5 strategy steps, 2–4 traps.

## Error handling

- **Draw fails / returns 0**: error card with Retry (no `BANK` fallback — the
  seed bank is too thin per-skill to fake a drill; honesty over degradation).
  Draw returning fewer than requested (thin skill) just runs a shorter drill.
- **Save fails**: summary still renders (drills are low-stakes); status line
  shows the error with a Retry button re-firing the same `sessionUuid` payload;
  failure logged to `sat.save_failures` (`context.kind='practice'`). No
  localStorage backup in v1 — a lost drill costs minutes, not a test.
- **Unknown slug**: `notFound()`.

## Security invariants (checklist for review)

- No new write policies; both writes via security-definer RPCs setting
  `user_id := auth.uid()`.
- `createAdminClient` is **not** imported anywhere new except the existing
  `'use server'` save-failure logging path.
- `/practice` routes stay out of `PUBLIC_PATHS` (session-gated).
- SPR canonical remains server-trusted at save; client-side grading is
  display-only.
- AI-sourced explanations render React-escaped in drills (source-branched,
  same as `ReviewItem`).

## Testing

- `scripts/check-lessons.ts` — every skill in `SKILLS` has a lesson; all fields
  non-empty within authoring bounds; MCQ worked examples have 4 choices and a
  valid `correct` reference; no letter references ("Choice A/B", "Option 1");
  slug round-trip (`slugToSkill(skillSlug(s)) === s`) and slug uniqueness for
  every skill.
- `scripts/check-practice-payload.ts` — `toPracticePayload` shape; SPR rows
  pass with empty `choices`, MCQ rows with empty choices rejected; wire fields
  survive zod (strip-mode regression guard).
- Existing gates: `pnpm type-check`, `pnpm lint`, `pnpm build`, plus the four
  existing check scripts stay green.
- `usePracticeSession` remains script-untested (consistent with
  `useTestSession`); manual smoke via dev server before push.

## Deferred (explicitly out of scope)

- Generator thinnest-domain rebalance (separate, touches n8n in lockstep).
- Blending practice results into `/analytics`.
- Spaced repetition / scheduling, timed drill mode, per-drill difficulty picker.
- Admin views over practice data.
- Lesson diagrams/images.

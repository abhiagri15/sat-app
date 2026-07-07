# Focus-Area Practice Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Practice section (sub-project #13): `/practice` hub + `/practice/[skill]` lesson-and-drill pages that turn analytics focus areas into targeted, instant-feedback skill practice.

**Architecture:** Static in-code lessons (one per skill), drills drawn from the live `sat.questions` pool via a new missed-first `sat.draw_drill` RPC, results persisted to new RLS-select-only `sat.practice_*` tables through a `sat.save_practice` security-definer RPC that re-verifies correctness server-side. Client drill FSM mirrors `useTestSession` conventions; UI reuses the app's Tailwind/card/mastery-chip language.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Tailwind, `@supabase/ssr`, zod, Postgres (Supabase `sat` schema). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-07-focus-area-practice-design.md` — read it first; its Decisions table and Security invariants section are binding.

**Repo ground rules (from CLAUDE.md — binding):**
- No write RLS policies ever; writes go through security-definer RPCs that set `user_id := auth.uid()`.
- `createAdminClient` import sites are enumerated; this plan adds exactly one shared module (`app/lib/persistence/failures.ts`) and removes the inline copy.
- SPR canonical is server-trusted; client grading is display-only.
- AI-sourced explanations render React-escaped; seed explanations via `dangerouslySetInnerHTML`.
- Never reference choices by letter in any authored string.
- The project has no test runner: pure modules get `scripts/check-*.ts` assertion files run with `pnpm dlx tsx`.
- Path alias `@/*` → repo root; cross-directory imports use `@/app/...`.

---

## File Structure

```
supabase/migrations/20260707000000_sat_practice.sql   # tables, RLS, grants, 3 RPCs
app/lib/practice/slug.ts                              # skillSlug / slugToSkill (pure)
app/lib/practice/mastery.ts                           # masteryTier (pure)
app/lib/practice/payload.ts                           # toPracticePayload (pure)
app/lib/practice/schema.ts                            # zod practicePayloadSchema (pure)
app/lib/practice/draw.ts                              # 'use client' drawDrill → RPC
app/lib/practice/actions.ts                           # 'use server' savePractice
app/lib/practice/queries.ts                           # server reads (stats, page data)
app/lib/persistence/failures.ts                       # extracted logSaveFailure (server-only)
app/lib/lessons/types.ts                              # Lesson / WorkedExample interfaces
app/lib/lessons/rw-information-ideas.ts               # 4 lessons
app/lib/lessons/rw-craft-structure.ts                 # 3 lessons
app/lib/lessons/rw-expression.ts                      # 2 lessons
app/lib/lessons/rw-conventions.ts                     # 5 lessons
app/lib/lessons/math-algebra.ts                       # 5 lessons
app/lib/lessons/math-advanced.ts                      # 5 lessons
app/lib/lessons/math-psda.ts                          # 6 lessons
app/lib/lessons/math-geometry.ts                      # 5 lessons
app/lib/lessons/index.ts                              # LESSONS registry + getLesson
app/hooks/usePracticeSession.ts                       # drill FSM ('use client')
app/components/practice/MasteryChip.tsx               # plain chip
app/components/practice/LessonView.tsx                # plain lesson renderer
app/components/practice/FocusAreaCard.tsx             # plain hub card
app/components/practice/SkillCatalog.tsx              # plain catalog
app/components/practice/SkillDrill.tsx                # 'use client' FSM root
app/components/practice/DrillQuestion.tsx             # 'use client' question + feedback
app/components/practice/DrillSummary.tsx              # plain summary
app/(app)/practice/page.tsx                           # hub (server)
app/(app)/practice/[skill]/page.tsx                   # skill page (server)
scripts/check-lessons.ts                              # lessons + slug assertions
scripts/check-practice-payload.ts                     # payload/schema assertions
# Modified: app/lib/persistence/actions.ts (use extracted helper)
# Modified: app/components/AppHeader.tsx (Practice link)
# Modified: app/(app)/analytics/page.tsx (focus-area links)
# Modified: app/components/ResultsScreen.tsx (post-test CTA)
# Modified: CLAUDE.md (new sub-project gotchas + verification command list)
```

Dependency order: Task 1 (DB) ∥ Task 2 (types) → Tasks 3a–3h (content, parallel) → Task 4 (registry+check) ; Task 5 (payload) → Task 6 (data layer) → Task 7 (hook) → Task 8 (components) → Task 9 (pages+integration) → Task 10 (docs) → Task 11 (verify). Tasks 2–5 don't depend on Task 1.

---

## Chunk 1: Database

### Task 1: Migration — tables, RLS, grants, RPCs

**Files:**
- Create: `supabase/migrations/20260707000000_sat_practice.sql`

- [ ] **Step 1: Write the migration file** with exactly this content:

```sql
-- Practice sub-project (#13): drill sessions/responses, missed-first drill
-- draw, transactional save with server-side re-verification, per-skill stats.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table sat.practice_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  session_uuid uuid not null,
  section      text not null check (section in ('rw', 'math')),
  skill        text not null,
  total        int  not null check (total >= 0),
  correct      int  not null check (correct >= 0 and correct <= total),
  created_at   timestamptz not null default now(),
  unique (user_id, session_uuid)
);

create index practice_sessions_user_skill_idx
  on sat.practice_sessions (user_id, skill, created_at desc);

alter table sat.practice_sessions enable row level security;

create policy practice_sessions_select_own on sat.practice_sessions
  for select to authenticated using (user_id = (select auth.uid()));

-- Snapshot-as-presented, mirroring sat.attempt_responses (minus module/section
-- naming): the review must show what the student saw, shuffled order included.
create table sat.practice_responses (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references sat.practice_sessions (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  position         int  not null,
  question_id      text not null,
  skill            text not null,
  source           text not null,
  passage          text,
  prompt           text not null,
  choices          jsonb not null default '[]'::jsonb,
  answer_index     int  not null,
  explanation      text not null,
  chosen_index     int  not null,
  is_correct       boolean not null,
  response_format  text not null default 'mcq' check (response_format in ('mcq', 'spr')),
  entered_value    text,
  correct_answer   text,
  answer_tolerance numeric
);

create index practice_responses_user_q_idx
  on sat.practice_responses (user_id, question_id);
create index practice_responses_session_idx
  on sat.practice_responses (session_id, position);

alter table sat.practice_responses enable row level security;

create policy practice_responses_select_own on sat.practice_responses
  for select to authenticated using (user_id = (select auth.uid()));

-- Select for users; full access for the service role (Foundation grants
-- gotcha: BYPASSRLS does not confer schema/table privileges).
grant select on sat.practice_sessions, sat.practice_responses to authenticated;
grant all on sat.practice_sessions, sat.practice_responses to service_role;

-- ---------------------------------------------------------------------------
-- draw_drill: missed-first drill draw. Tier 1 = currently-missed (the user's
-- LATEST recorded answer for the question was wrong, across tests and
-- practice), capped at half the drill. Tier 2 = fresh (never served). Tier 3 =
-- recycled (least recently served). Everything returned is upserted into
-- served_questions so later tests never treat drilled material as unseen.
-- Return order is preserved (missed first) via array_position.
-- ---------------------------------------------------------------------------

create or replace function sat.draw_drill(p_skill text, p_count int default 10)
returns setof sat.questions
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user       uuid := (select auth.uid());
  v_count      int  := least(greatest(coalesce(p_count, 0), 1), 30);
  v_missed_cap int;
  v_ids        text[];
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if p_skill is null then
    raise exception 'p_skill required';
  end if;
  v_missed_cap := ceil(v_count / 2.0)::int;

  -- Tier 1: currently-missed (latest answer wrong), most recent miss first.
  select coalesce(array_agg(id), array[]::text[]) into v_ids from (
    select q.id
    from sat.questions q
    join lateral (
      select r.is_correct, r.answered_at
      from (
        select ar.is_correct, ta.created_at as answered_at
        from sat.attempt_responses ar
        join sat.test_attempts ta on ta.id = ar.attempt_id
        where ar.user_id = v_user and ar.question_id = q.id
        union all
        select pr.is_correct, ps.created_at as answered_at
        from sat.practice_responses pr
        join sat.practice_sessions ps on ps.id = pr.session_id
        where pr.user_id = v_user and pr.question_id = q.id
      ) r
      order by r.answered_at desc
      limit 1
    ) latest on true
    where q.skill = p_skill
      and q.enabled
      and latest.is_correct = false
    order by latest.answered_at desc
    limit v_missed_cap
  ) missed;

  -- Tier 2: fresh — never served to this user.
  if coalesce(array_length(v_ids, 1), 0) < v_count then
    select v_ids || coalesce(array_agg(id), array[]::text[]) into v_ids from (
      select q.id from sat.questions q
      where q.skill = p_skill
        and q.enabled
        and not (q.id = any(v_ids))
        and not exists (
          select 1 from sat.served_questions s
          where s.user_id = v_user and s.question_id = q.id)
      order by random()
      limit v_count - coalesce(array_length(v_ids, 1), 0)
    ) fresh;
  end if;

  -- Tier 3: recycled — least recently served.
  if coalesce(array_length(v_ids, 1), 0) < v_count then
    select v_ids || coalesce(array_agg(id), array[]::text[]) into v_ids from (
      select q.id
      from sat.questions q
      join sat.served_questions s
        on s.question_id = q.id and s.user_id = v_user
      where q.skill = p_skill
        and q.enabled
        and not (q.id = any(v_ids))
      order by s.served_at asc
      limit v_count - coalesce(array_length(v_ids, 1), 0)
    ) recycled;
  end if;

  insert into sat.served_questions (user_id, question_id, served_at)
  select v_user, unnest(v_ids), now()
  on conflict (user_id, question_id) do update set served_at = excluded.served_at;

  return query
    select * from sat.questions q
    where q.id = any(v_ids)
    order by array_position(v_ids, q.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- save_practice: transactional save. Idempotent on (user_id, session_uuid) —
-- the short-circuit runs BEFORE any insert, and a concurrent same-uuid race is
-- resolved in the unique_violation handler (same discipline as save_attempt).
-- Correctness is recomputed server-side: mcq from the snapshotted
-- chosen/answer indexes; spr by re-joining sat.questions for the canonical
-- (client-claimed isCorrect is ignored).
-- ---------------------------------------------------------------------------

create or replace function sat.save_practice(p_session jsonb, p_responses jsonb)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_user         uuid := (select auth.uid());
  v_session_uuid uuid;
  v_section      text;
  v_skill        text;
  v_existing     uuid;
  v_id           uuid;
  v_total        int := 0;
  v_correct      int := 0;
  r              jsonb;
  v_format       text;
  v_chosen       int;
  v_is_correct   boolean;
  v_canonical    text;
  v_tolerance    numeric;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  v_session_uuid := (p_session ->> 'sessionUuid')::uuid;
  v_section      := p_session ->> 'section';
  v_skill        := p_session ->> 'skill';
  if v_session_uuid is null then
    raise exception 'sessionUuid required';
  end if;
  if v_section is null or v_skill is null then
    raise exception 'section and skill required';
  end if;
  if p_responses is null or jsonb_typeof(p_responses) <> 'array'
     or jsonb_array_length(p_responses) = 0 then
    raise exception 'no responses';
  end if;

  select ps.id into v_existing
  from sat.practice_sessions ps
  where ps.user_id = v_user and ps.session_uuid = v_session_uuid;
  if v_existing is not null then
    return v_existing;
  end if;

  begin
    insert into sat.practice_sessions
      (user_id, session_uuid, section, skill, total, correct)
    values (v_user, v_session_uuid, v_section, v_skill, 0, 0)
    returning id into v_id;
  exception when unique_violation then
    select ps.id into v_existing
    from sat.practice_sessions ps
    where ps.user_id = v_user and ps.session_uuid = v_session_uuid;
    return v_existing;
  end;

  for r in select * from jsonb_array_elements(p_responses) loop
    v_format := coalesce(r ->> 'responseFormat', 'mcq');
    v_chosen := coalesce((r ->> 'chosenIndex')::int, -1);

    if v_format = 'spr' then
      -- Canonical comes from sat.questions — never from the client.
      select q.correct_answer, q.answer_tolerance
        into v_canonical, v_tolerance
        from sat.questions q
        where q.id = r ->> 'questionId';
      v_is_correct := coalesce(
        sat.spr_is_correct(r ->> 'enteredValue', v_canonical, v_tolerance),
        false);
    else
      v_is_correct := v_chosen >= 0
        and v_chosen = coalesce((r ->> 'answerIndex')::int, -2);
      v_canonical := null;
      v_tolerance := null;
    end if;

    insert into sat.practice_responses
      (session_id, user_id, position, question_id, skill, source, passage,
       prompt, choices, answer_index, explanation, chosen_index, is_correct,
       response_format, entered_value, correct_answer, answer_tolerance)
    values
      (v_id, v_user,
       coalesce((r ->> 'position')::int, v_total),
       r ->> 'questionId',
       coalesce(r ->> 'skill', v_skill),
       coalesce(r ->> 'source', 'ai'),
       r ->> 'passage',
       r ->> 'prompt',
       coalesce(r -> 'choices', '[]'::jsonb),
       coalesce((r ->> 'answerIndex')::int, 0),
       coalesce(r ->> 'explanation', ''),
       v_chosen,
       v_is_correct,
       v_format,
       r ->> 'enteredValue',
       case when v_format = 'spr' then v_canonical else null end,
       case when v_format = 'spr' then v_tolerance else null end);

    v_total := v_total + 1;
    if v_is_correct then v_correct := v_correct + 1; end if;
  end loop;

  update sat.practice_sessions ps
    set total = v_total, correct = v_correct
    where ps.id = v_id;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- practice_skill_stats: read-only per-skill aggregates for the signed-in user.
-- SECURITY INVOKER on purpose (the user_analytics precedent): it reads only
-- RLS-scoped tables, and keeps the explicit auth.uid() filter as a clarity
-- backstop. SQL-language, so no #variable_conflict concerns.
-- ---------------------------------------------------------------------------

create or replace function sat.practice_skill_stats()
returns table (
  skill          text,
  sessions       bigint,
  questions      bigint,
  correct        bigint,
  last_practiced timestamptz
)
language sql
security invoker
set search_path to ''
as $$
  select
    ps.skill,
    count(distinct ps.id)                          as sessions,
    count(pr.id)                                   as questions,
    count(pr.id) filter (where pr.is_correct)      as correct,
    max(ps.created_at)                             as last_practiced
  from sat.practice_sessions ps
  left join sat.practice_responses pr on pr.session_id = ps.id
  where ps.user_id = (select auth.uid())
  group by ps.skill
$$;

-- The sat schema is deny-by-default for functions (20260521000000 revokes all
-- on functions from anon/authenticated/public via default privileges) — every
-- RPC needs an explicit execute grant or the app gets "permission denied".
grant execute on function sat.draw_drill(text, int) to authenticated;
grant execute on function sat.save_practice(jsonb, jsonb) to authenticated;
grant execute on function sat.practice_skill_stats() to authenticated, service_role;
```

- [ ] **Step 2: Sanity-read the file** — confirm it contains all three `create or replace function` statements, both `enable row level security` lines, both table grants, **all three `grant execute` lines**, and no `create policy ... for insert/update/delete` anywhere.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260707000000_sat_practice.sql
git commit -m "feat(db): practice tables, draw_drill, save_practice, practice_skill_stats"
```

**Note for the orchestrator (not the subagent):** apply the migration to the live project (`falgykkspbtrwdcchayi`) via the Supabase MCP `apply_migration`, then verify with smoke queries: `select to_regprocedure('sat.draw_drill(text,int)'), to_regprocedure('sat.save_practice(jsonb,jsonb)'), to_regprocedure('sat.practice_skill_stats()');` (all non-null) and `select * from sat.practice_skill_stats();` (0 rows). Subagents must NOT apply migrations.

---

## Chunk 2: Pure modules (slug, mastery, lessons scaffolding, payload)

### Task 2: Lesson types + slug + mastery helpers

**Files:**
- Create: `app/lib/lessons/types.ts`
- Create: `app/lib/practice/slug.ts`
- Create: `app/lib/practice/mastery.ts`

- [ ] **Step 1: Create `app/lib/lessons/types.ts`:**

```ts
// Lesson content model for the Practice section. Lessons are static,
// hand-authored-in-code data (see docs/superpowers/specs/
// 2026-07-07-focus-area-practice-design.md): plain strings only — every field
// renders React-escaped, so no HTML. Never reference choices by letter
// ("Choice A"); quote the option's text instead.

export interface WorkedExample {
  /** Passage/setup shown above the prompt. Optional for bare math prompts. */
  passage?: string;
  prompt: string;
  /** Exactly 4 for mcq-style examples; omit for SPR-style math examples. */
  choices?: string[];
  /** The full text of the correct choice, or the SPR answer string. */
  correct: string;
  /** Step-by-step reasoning, 2–5 steps, each one plain sentence or two. */
  walkthrough: string[];
}

export interface Lesson {
  /** Must exactly match a name in SKILLS (app/lib/questions.ts). */
  skill: string;
  /** One line: what this skill actually tests. */
  tagline: string;
  /** 1–3 short paragraphs. Direct, second-person, coach-like. */
  overview: string[];
  /** 3–5 named strategy steps. */
  strategies: { title: string; body: string }[];
  workedExample: WorkedExample;
  /** 2–4 common traps, each one sentence. */
  traps: string[];
}
```

- [ ] **Step 2: Create `app/lib/practice/slug.ts`:**

```ts
import { SKILLS, type SectionKey } from '@/app/lib/questions';

// URL slugs for skill names ("Boundaries (Punctuation)" →
// "boundaries-punctuation", "Ratios & Proportions" → "ratios-and-proportions").
// The reverse map is built once from the SKILLS taxonomy; check-lessons.ts
// asserts round-trip and uniqueness for every skill.

export function skillSlug(skill: string): string {
  return skill
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface SlugEntry {
  section: SectionKey;
  skill: string;
}

const SLUG_MAP: Record<string, SlugEntry> = {};
for (const section of ['rw', 'math'] as SectionKey[]) {
  for (const skill of SKILLS[section]) {
    SLUG_MAP[skillSlug(skill)] = { section, skill };
  }
}

export function slugToSkill(slug: string): SlugEntry | null {
  return SLUG_MAP[slug] ?? null;
}
```

(If `SKILLS`' actual type in `questions.ts` differs from `Record<SectionKey, string[]>`, adapt the loop, not the taxonomy.)

- [ ] **Step 3: Create `app/lib/practice/mastery.ts`:**

```ts
import { accuracyPct } from '@/app/lib/analytics/compute';

// Mastery tiers, fed by TEST accuracy (the focus-area driver — practice
// accuracy is shown separately and does not move the tier).
export type MasteryTier = 'untested' | 'needs-work' | 'improving' | 'strong';

export function masteryTier(correct: number, total: number): MasteryTier {
  if (total === 0) return 'untested';
  const pct = accuracyPct(correct, total);
  if (pct < 60) return 'needs-work';
  if (pct < 80) return 'improving';
  return 'strong';
}

export const TIER_LABEL: Record<MasteryTier, string> = {
  untested: 'Not yet tested',
  'needs-work': 'Needs work',
  improving: 'Improving',
  strong: 'Strong',
};
```

- [ ] **Step 4: Type-check** — `pnpm type-check`, expected: clean.

- [ ] **Step 5: Commit** — `feat(practice): lesson types, skill slugs, mastery tiers`

### Task 3 (a–h, parallelizable): Lesson content — one file per domain

Eight sibling tasks with identical structure. Each creates ONE file exporting a
`Lesson[]` const. Skills per file (names must match `SKILLS` exactly):

| Task | File | Export const | Skills |
|---|---|---|---|
| 3a | `app/lib/lessons/rw-information-ideas.ts` | `RW_INFORMATION_IDEAS_LESSONS` | Central Ideas; Inferences; Command of Evidence; Command of Evidence (Quantitative) |
| 3b | `app/lib/lessons/rw-craft-structure.ts` | `RW_CRAFT_STRUCTURE_LESSONS` | Words in Context; Text Structure and Purpose; Cross-Text Connections |
| 3c | `app/lib/lessons/rw-expression.ts` | `RW_EXPRESSION_LESSONS` | Rhetorical Synthesis; Transitions |
| 3d | `app/lib/lessons/rw-conventions.ts` | `RW_CONVENTIONS_LESSONS` | Boundaries (Modifiers); Boundaries (Punctuation); Form & Structure (Verbs); Subject-Verb Agreement; Pronoun Agreement |
| 3e | `app/lib/lessons/math-algebra.ts` | `MATH_ALGEBRA_LESSONS` | Linear Equations; Linear Functions; Systems of Equations; Inequalities; Slope & Lines |
| 3f | `app/lib/lessons/math-advanced.ts` | `MATH_ADVANCED_LESSONS` | Quadratics; Exponents; Exponential Growth; Equivalent Expressions; Functions |
| 3g | `app/lib/lessons/math-psda.ts` | `MATH_PSDA_LESSONS` | Percentages; Ratios & Proportions; Probability; Statistics (Mean); Statistics (Spread); Scatterplots & Models |
| 3h | `app/lib/lessons/math-geometry.ts` | `MATH_GEOMETRY_LESSONS` | Circles; Geometry (Area); Geometry (Triangles); Volume; Right Triangle Trigonometry |

**Authoring contract (binding for every lesson):**
- Audience: a high-schooler targeting 1300+. Voice: direct, second-person, coach-like. No fluff.
- `tagline`: one sentence, what the Digital SAT actually tests with this skill.
- `overview`: 1–3 short paragraphs (each ≤ ~90 words) — what the question format looks like on the Digital SAT and the core insight for attacking it.
- `strategies`: 3–5 steps, each `{ title, body }`, bodies 1–3 sentences, actionable ("Read the question stem first…"), not generic ("Practice more").
- `workedExample`: an **authentic Digital SAT-style item** obeying the app's authenticity rules: Rhetorical Synthesis uses the "While researching a topic, a student has taken the following notes:" bulleted format; Boundaries (Punctuation) choices are literal marks/text (";", ", and") never descriptions; Words in Context uses high-utility academic vocab; Cross-Text Connections uses "Text 1"/"Text 2" labels in the passage; Transitions/cloze passages contain exactly one `______` (six underscores) blank; reading-comprehension examples have NO blank; no arithmetic puzzles dressed as Reading; never hinge Pronoun Agreement on "their" vs "his or her"; never reference "underlined" or highlighted text. Math examples: mcq (4 choices) or SPR-style (`choices` omitted, `correct` is the numeric/fraction string). `correct` for mcq examples must be byte-identical to one entry in `choices`.
- `walkthrough`: 2–5 steps that reason to the answer — quote choice text, never "Choice A/B/C/D" or "Option 1/2/3/4".
- `traps`: 2–4 one-sentence common errors.
- Plain text only (no HTML, no markdown syntax inside strings).

**Steps for each of 3a–3h:**
- [ ] **Step 1:** Create the file: `import type { Lesson } from './types';` then `export const <NAME>: Lesson[] = [ ... ]` with one entry per listed skill, following the authoring contract.
- [ ] **Step 2:** `pnpm type-check` — clean.
- [ ] **Step 3:** Self-audit against the contract: correct-in-choices, blank conventions, no letter references (`grep -inE "choice [a-d]|option [1-4]" <file>` → no matches).
- [ ] **Step 4:** Commit — `feat(lessons): <domain> lessons (<n> skills)`.

### Task 4: Lessons registry + check-lessons script

**Files:**
- Create: `app/lib/lessons/index.ts`
- Create: `scripts/check-lessons.ts`

- [ ] **Step 1: Create `app/lib/lessons/index.ts`:**

```ts
import type { Lesson } from './types';
import { RW_INFORMATION_IDEAS_LESSONS } from './rw-information-ideas';
import { RW_CRAFT_STRUCTURE_LESSONS } from './rw-craft-structure';
import { RW_EXPRESSION_LESSONS } from './rw-expression';
import { RW_CONVENTIONS_LESSONS } from './rw-conventions';
import { MATH_ALGEBRA_LESSONS } from './math-algebra';
import { MATH_ADVANCED_LESSONS } from './math-advanced';
import { MATH_PSDA_LESSONS } from './math-psda';
import { MATH_GEOMETRY_LESSONS } from './math-geometry';

const ALL: Lesson[] = [
  ...RW_INFORMATION_IDEAS_LESSONS,
  ...RW_CRAFT_STRUCTURE_LESSONS,
  ...RW_EXPRESSION_LESSONS,
  ...RW_CONVENTIONS_LESSONS,
  ...MATH_ALGEBRA_LESSONS,
  ...MATH_ADVANCED_LESSONS,
  ...MATH_PSDA_LESSONS,
  ...MATH_GEOMETRY_LESSONS,
];

export const LESSONS: Record<string, Lesson> = Object.fromEntries(
  ALL.map((l) => [l.skill, l]),
);

export function getLesson(skill: string): Lesson | null {
  return LESSONS[skill] ?? null;
}

export type { Lesson, WorkedExample } from './types';
```

- [ ] **Step 2: Write `scripts/check-lessons.ts`** (assertion script, run with `pnpm dlx tsx scripts/check-lessons.ts`; follow the assert-and-report style of `scripts/check-analytics.ts`). Assert, for EVERY skill in `SKILLS` (both sections):
  1. `getLesson(skill)` is non-null and `lesson.skill === skill`.
  2. Bounds: `tagline` non-empty; `overview` length 1–3, all non-empty; `strategies` length 3–5 with non-empty titles/bodies; `traps` length 2–4 non-empty; `walkthrough` length 2–5 non-empty.
  3. Worked example: if `choices` present → exactly 4 and `choices.includes(correct)`; if absent → `correct` parses via `parseSpr` from `../app/lib/spr` (returns `ParsedSpr | null` — assert `parseSpr(correct) !== null`). Use relative imports in scripts, matching the existing check scripts.
  4. No letter references: `/\b(choice|option)\s+[a-d1-4]\b/i` matches nowhere in any lesson string (serialize each lesson with `JSON.stringify` and test).
  5. Slugs: `slugToSkill(skillSlug(skill))?.skill === skill`, and all slugs unique across the taxonomy.
  6. No orphan lessons: every key of `LESSONS` appears in `SKILLS`.
  Print `check-lessons: N assertions passed` and `process.exit(1)` on any failure.

- [ ] **Step 3: Run it** — `pnpm dlx tsx scripts/check-lessons.ts`. Expected: passes. If a content file violates the contract, fix THAT file (content, not the check).

- [ ] **Step 4: Commit** — `feat(lessons): registry + check-lessons assertions`

### Task 5: Practice payload mapper + zod schema + check script

**Files:**
- Create: `app/lib/practice/payload.ts`
- Create: `app/lib/practice/schema.ts`
- Create: `scripts/check-practice-payload.ts`

- [ ] **Step 1: Create `app/lib/practice/payload.ts`:**

```ts
import type { Question } from '@/app/lib/questions';
import type { SectionKey } from '@/app/lib/questions';

// One graded drill item as the runner presented it (choices already shuffled
// by shuffleChoices at draw time — snapshot-as-presented, like attempts).
export interface DrillResult {
  question: Question;
  /** mcq: index into the as-presented choices; spr: -1. */
  chosenIndex: number;
  /** spr: the raw string the student typed; mcq: null. */
  enteredValue: string | null;
  /** Client-graded for instant feedback; server re-verifies at save. */
  isCorrect: boolean;
}

export interface PracticeResponsePayload {
  position: number;
  questionId: string;
  skill: string;
  source: string;
  passage: string | null;
  prompt: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  chosenIndex: number;
  isCorrect: boolean;
  responseFormat: 'mcq' | 'spr';
  enteredValue: string | null;
  correctAnswer: string | null;
  answerTolerance: number | null;
}

export interface PracticePayload {
  sessionUuid: string;
  section: SectionKey;
  skill: string;
  total: number;
  correct: number;
  responses: PracticeResponsePayload[];
}

export function toPracticePayload(
  sessionUuid: string,
  section: SectionKey,
  skill: string,
  results: DrillResult[],
): PracticePayload {
  const responses = results.map((r, i) => {
    const q = r.question;
    // Question's SPR fields are snake_case (response_format, correct_answer,
    // answer_tolerance) — see the interface in app/lib/questions.ts.
    const spr = q.response_format === 'spr';
    return {
      position: i,
      questionId: q.id,
      skill: q.skill,
      source: q.source,
      passage: q.passage ?? null,
      prompt: q.prompt,
      choices: spr ? [] : q.choices,
      answerIndex: spr ? 0 : q.answerIndex,
      explanation: q.explanation,
      chosenIndex: spr ? -1 : r.chosenIndex,
      isCorrect: r.isCorrect,
      responseFormat: (spr ? 'spr' : 'mcq') as 'mcq' | 'spr',
      enteredValue: spr ? r.enteredValue : null,
      correctAnswer: spr ? (q.correct_answer ?? null) : null,
      answerTolerance: spr ? (q.answer_tolerance ?? null) : null,
    };
  });
  return {
    sessionUuid,
    section,
    skill,
    total: responses.length,
    correct: responses.filter((r) => r.isCorrect).length,
    responses,
  };
}
```

(The snake_case SPR field names above are the real `Question` interface — verified. Check the actual type once before writing anyway.)

- [ ] **Step 2: Create `app/lib/practice/schema.ts`** — zod schema mirroring the payload EXACTLY. **Strip-mode gotcha applies: list every wire field**, including the SPR fields, or `save_practice` never sees them:

```ts
import { z } from 'zod';

const practiceResponseSchema = z
  .object({
    position: z.number().int().min(0),
    questionId: z.string().min(1),
    skill: z.string().min(1),
    source: z.string().min(1),
    passage: z.string().nullable(),
    prompt: z.string().min(1),
    choices: z.array(z.string()),
    answerIndex: z.number().int().min(0),
    explanation: z.string(),
    chosenIndex: z.number().int().min(-1),
    isCorrect: z.boolean(),
    responseFormat: z.enum(['mcq', 'spr']),
    enteredValue: z.string().nullable(),
    correctAnswer: z.string().nullable(),
    answerTolerance: z.number().nullable(),
  })
  .refine((r) => r.responseFormat === 'spr' || r.choices.length >= 1, {
    message: 'mcq responses need at least one choice',
  });

export const practicePayloadSchema = z.object({
  sessionUuid: z.uuid(), // zod v4 — z.string().uuid() is deprecated
  section: z.enum(['rw', 'math']),
  skill: z.string().min(1),
  total: z.number().int().min(1),
  correct: z.number().int().min(0),
  responses: z.array(practiceResponseSchema).min(1),
});

export type PracticePayloadInput = z.infer<typeof practicePayloadSchema>;
```

- [ ] **Step 3: Write `scripts/check-practice-payload.ts`** asserting:
  1. `toPracticePayload` on a 3-question fixture (2 mcq — one right, one wrong — 1 spr) produces correct `total`/`correct`/`position` and per-format fields (mcq: `choices` non-empty, `enteredValue === null`; spr: `choices: []`, `chosenIndex === -1`, `correctAnswer` present).
  2. The schema ACCEPTS that payload, and the parsed output still carries `responseFormat`, `enteredValue`, `correctAnswer`, `answerTolerance` (strip-mode regression guard).
  3. The schema REJECTS an mcq response with `choices: []`.
  4. The schema REJECTS a payload with `responses: []`.

- [ ] **Step 4: Run it** — `pnpm dlx tsx scripts/check-practice-payload.ts` → passes. Also `pnpm type-check` → clean.

- [ ] **Step 5: Commit** — `feat(practice): payload mapper + wire schema + assertions`

---

## Chunk 3: Data layer + drill FSM

### Task 6: logSaveFailure extraction, savePractice action, drawDrill client, queries

**Files:**
- Create: `app/lib/persistence/failures.ts`
- Modify: `app/lib/persistence/actions.ts` (use the extracted helper; behavior unchanged)
- Create: `app/lib/practice/actions.ts`
- Create: `app/lib/practice/draw.ts`
- Create: `app/lib/practice/queries.ts`

- [ ] **Step 1: Extract `logSaveFailure`.** The current helper in `app/lib/persistence/actions.ts` is positional — `(error, code, retryable, userId, payload: AttemptPayload, meta?)` — and builds its `context` jsonb from the `AttemptPayload` internally. Practice saves have no `AttemptPayload`, so the extraction MUST change the signature. Create server-only `app/lib/persistence/failures.ts` exporting exactly:

```ts
export interface SaveFailureLog {
  errorMessage: string;
  errorCode: string;      // keep the existing SaveErrorCode values for attempts
  retryable: boolean;
  userId?: string | null;
  attemptNo?: number;
  context: Record<string, unknown>; // caller-built (attempts: testLength etc.; practice: { kind: 'practice', skill })
}
export async function logSaveFailure(log: SaveFailureLog): Promise<void>;
```

Keep the exact insert shape into `sat.save_failures` (same columns) and the never-throws discipline (wrap in try/catch; a logging failure must not mask the real error). **Rewrite the call sites in `persistence/actions.ts` mechanically** to build the same `context` object they produce today and pass it in — the rows written must be byte-equivalent to before (that is the "no behavior change" bar; the call-site diffs are expected and fine).

- [ ] **Step 2: Run existing checks** — `pnpm type-check` and `pnpm dlx tsx scripts/check-payload.ts` → clean/pass.

- [ ] **Step 3: Create `app/lib/practice/actions.ts`** (`'use server'`), modeled line-for-line on `persistence/actions.ts` conventions:

```ts
'use server';

import { createClient } from '@/app/lib/supabase/server';
import { logSaveFailure } from '@/app/lib/persistence/failures';
import { practicePayloadSchema } from './schema';
import type { PracticePayload } from './payload';

export interface SavePracticeResult {
  ok: boolean;
  sessionId?: string;
  error?: string;
}

export async function savePractice(
  payload: PracticePayload,
): Promise<SavePracticeResult> {
  const parsed = practicePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    await logSaveFailure({
      errorMessage: 'invalid practice payload',
      errorCode: 'invalid_payload',
      retryable: false,
      context: { kind: 'practice', skill: payload?.skill },
    });
    return { ok: false, error: 'invalid payload' };
  }
  const { responses, ...session } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .rpc('save_practice', { p_session: session, p_responses: responses });
  if (error) {
    console.error('[practice] save_practice failed:', error.message);
    await logSaveFailure({
      errorMessage: error.message,
      errorCode: 'rpc_error',
      retryable: true,
      context: { kind: 'practice', skill: parsed.data.skill },
    });
    return { ok: false, error: error.message };
  }
  return { ok: true, sessionId: data as string };
}
```

(Match `logSaveFailure`'s real signature from Step 1 — adapt the call, not the helper.)

- [ ] **Step 4: Create `app/lib/practice/draw.ts`** (`'use client'`), mirroring `pool.ts` conventions:

```ts
'use client';

import { createClient } from '@/app/lib/supabase/client';
import { rowToQuestion, type Question } from '@/app/lib/questions';

// Draws a drill for one skill via the missed-first draw_drill RPC.
// Order is meaningful (missed questions first) — do not shuffle the array;
// only choices within each mcq get shuffled (the caller does that).
export async function drawDrill(
  skill: string,
  count = 10,
): Promise<Question[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema('sat')
    .rpc('draw_drill', { p_skill: skill, p_count: count });
  if (error) {
    throw new Error(`draw_drill failed (skill=${skill}): ${error.message}`);
  }
  return (data ?? []).map(rowToQuestion);
}
```

- [ ] **Step 5: Create `app/lib/practice/queries.ts`** (server-only, no `'use server'` — plain server helpers like `analytics/queries.ts`):
  - `PracticeSkillStat` interface: `{ skill: string; sessions: number; questions: number; correct: number; lastPracticed: string | null }`.
  - `getPracticeSkillStats(): Promise<Record<string, PracticeSkillStat>>` — server Supabase client → `sat.practice_skill_stats()` RPC → keyed by skill; on error, `console.error('[practice] ...')` and return `{}` (graceful, page still renders).
  - `getRecentDrills(skill: string, limit = 5)` — reads `sat.practice_sessions` (RLS-scoped) for the signed-in user, newest first: `{ id, createdAt, total, correct }[]`; on error return `[]`.

- [ ] **Step 6:** `pnpm type-check` → clean. Verify no new `createAdminClient` import outside the documented list:

```powershell
Get-ChildItem -Path app -Recurse -Include *.tsx,*.ts | Select-String -Pattern "supabase/admin|SUPABASE_SERVICE_ROLE_KEY"
```

Expected matches ONLY in: `app/lib/supabase/admin.ts`, `app/lib/ai/generate.ts`, `app/lib/persistence/failures.ts`.

- [ ] **Step 7: Commit** — `feat(practice): save action, drill draw, stats queries; extract logSaveFailure`

### Task 7: usePracticeSession hook

**Files:**
- Create: `app/hooks/usePracticeSession.ts`

- [ ] **Step 1: Create the hook** (`'use client'`). Contract:

```ts
export type DrillPhase = 'idle' | 'loading' | 'drilling' | 'summary' | 'error';

export interface PracticeSession {
  phase: DrillPhase;
  error: string | null;          // draw error (phase 'error')
  questions: Question[];          // choices pre-shuffled per drill
  qIdx: number;
  checked: boolean;               // current question graded?
  selected: number | null;        // mcq selection before/after check
  entered: string;                // spr input value
  lastCorrect: boolean | null;    // grade of the current question once checked
  correctCount: number;
  streak: number;                 // current consecutive-correct run
  results: DrillResult[];         // grows as questions are checked
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  saveError: string | null;
  start: () => void;              // idle/error/summary → loading → drilling
  select: (i: number) => void;    // no-op once checked
  setEntered: (v: string) => void;
  check: () => void;              // grades current question, appends to results
  next: () => void;               // advances; after last question → summary
  retrySave: () => void;
}

export function usePracticeSession(
  section: SectionKey,
  skill: string,
  autoStart: boolean,
): PracticeSession;
```

Implementation requirements:
- `start()`: `phase='loading'`; `drawDrill(skill, 10)`; on empty result treat as error ("No questions available for this skill yet"); shuffle each mcq's choices with the existing `shuffleChoices` from `@/app/lib/test` (it already no-ops for spr and remaps `answerIndex`); reset all per-drill state; `phase='drilling'`. On throw: `phase='error'`, message in `error`.
- `autoStart`: a mount effect calls `start()` once when `autoStart` is true and phase is `'idle'` (guard with a ref against Strict-Mode double-fire, like `resaveStartedRef` in `useTestSession`).
- `check()`: grades locally — mcq: `selected === q.answerIndex`; spr: `isSprCorrect(entered, q.correct_answer ?? '', q.answer_tolerance ?? null)` (snake_case fields on `Question`; confirm the exact `isSprCorrect` parameter types in `app/lib/spr.ts` before writing). Ignores calls when nothing selected/entered or already checked. Updates `results`, `correctCount`, `streak` (reset to 0 on a miss), `lastCorrect`, `checked=true`.
- `next()`: if `qIdx` is last → build payload via `toPracticePayload(sessionUuid, section, skill, results)` and fire save (below), `phase='summary'`; else `qIdx+1`, clear `checked/selected/entered/lastCorrect`.
- Save: `sessionUuid` generated once per drill via `crypto.randomUUID()` at `start()`. Fire-once guard ref on entering summary. `saveStatus` transitions `saving → saved | error`; `retrySave()` re-sends the SAME payload (kept in a ref) with the same uuid — idempotent server-side.
- No timers anywhere (drills are untimed).
- `start()` from `summary` begins a fresh drill (new uuid, re-draw).

- [ ] **Step 2:** `pnpm type-check` → clean.

- [ ] **Step 3: Commit** — `feat(practice): usePracticeSession drill FSM`

---

## Chunk 4: UI, pages, integration, docs, verification

### Task 8: Practice components

**Files:**
- Create: `app/components/practice/MasteryChip.tsx`
- Create: `app/components/practice/LessonView.tsx`
- Create: `app/components/practice/FocusAreaCard.tsx`
- Create: `app/components/practice/SkillCatalog.tsx`
- Create: `app/components/practice/DrillQuestion.tsx`
- Create: `app/components/practice/DrillSummary.tsx`
- Create: `app/components/practice/SkillDrill.tsx`

Visual language (match the app: `max-w-3xl` mains, `rounded-lg border border-slate-200` cards, `text-blue-600` accents, amber focus callouts, `bg-slate-200` track bars):

- [ ] **Step 1: `MasteryChip.tsx`** (plain). Props `{ tier: MasteryTier }`. Small rounded-full chip: untested → `bg-slate-100 text-slate-500`; needs-work → `bg-amber-100 text-amber-800`; improving → `bg-blue-100 text-blue-800`; strong → `bg-green-100 text-green-800`. Text from `TIER_LABEL`.

- [ ] **Step 2: `LessonView.tsx`** (plain, server-renderable, no hooks). Props `{ lesson: Lesson }`. Sections: tagline as lede; overview paragraphs; "How to approach it" numbered strategy list (title bold + body); "Worked example" card — passage (whitespace-pre-line to preserve student-notes bullets), prompt, choices as a static lettered-free list (render the choice text with the correct one marked by a green check icon + "Correct answer" label after the walkthrough heading), walkthrough as ordered steps; "Traps to avoid" amber callout list. All content rendered as React-escaped text (lessons are plain strings).

- [ ] **Step 3: `FocusAreaCard.tsx`** (plain). Props `{ skill, section, testCorrect, testTotal, practice?: PracticeSkillStat, rank: number }`. Card: rank badge ("Focus #1"), skill name + domain subtitle (via `SKILL_DOMAIN`), `MasteryChip` from test accuracy, test accuracy line ("42% on tests · 5/12"), practice line ("3 drills · last practiced Jul 5" or "Not practiced yet"), two buttons: **Learn** (`Link` → `/practice/[slug]`) secondary, **Practice** (`Link` → `/practice/[slug]?drill=1`) primary blue.

- [ ] **Step 4: `SkillCatalog.tsx`** (plain). Props `{ skillStats: Record<string, {correct,total}>, practiceStats: Record<string, PracticeSkillStat> }`. For each section (R&W then Math) render domain groups in the order given by the real exports in `questions.ts` (`RW_DOMAINS` / `MATH_DOMAINS` — check exact names): domain heading + rows. Row: skill name (Link to `/practice/[slug]`), right-aligned: test-accuracy chip or "Not yet tested", drill count if > 0, chevron. Rows are `<Link>` blocks with hover state.

- [ ] **Step 5: `DrillQuestion.tsx`** (`'use client'`). Props: `{ question, checked, selected, entered, lastCorrect, onSelect, onEntered, onCheck, onNext, isLast, index, total }`. Layout: passage card (pre-line) when present; prompt; mcq → button-list of choices (selected ring; after check: correct choice gets green border/bg, a wrong selection gets red) — reuse the interaction pattern from `QuestionView` but self-contained; spr → `SprInput` (existing component). Footer: before check → **Check answer** (disabled until selected/entered); after check → feedback panel: "Correct!"/"Not quite" banner (green/red), for spr show the canonical answer, explanation block (source-branched EXACTLY like `ReviewItem`: `source === 'seed'` → `dangerouslySetInnerHTML`, else React-escaped span), the existing `FlagQuestion` widget (pass the props it needs — read `FlagQuestion.tsx` for its real prop shape), then **Next question** / **See results** button. Enter key triggers check/next appropriately.

- [ ] **Step 6: `DrillSummary.tsx`** (plain). Props `{ skill, results, correctCount, saveStatus, saveError, onRestart, onRetrySave, nextFocus?: { skill, slug } }`. Score hero ("8/10 correct" + accuracy ring or bar), per-question recap list (number, truncated prompt, right/wrong icon), save-status line (subtle: "Saved to your history" / "Saving…" / error + Retry button), CTA row: **Practice again** (onRestart), **Back to practice** (`Link` → `/practice`), **Next focus area →** (Link, only when `nextFocus` provided).

- [ ] **Step 7: `SkillDrill.tsx`** (`'use client'`, the FSM root). Props `{ section, skill, autoStart, nextFocus? }`. Uses `usePracticeSession`. Renders by phase: idle → start card ("10 questions · untimed · instant feedback" + **Start practice** button); loading → skeleton/spinner card; error → red card with message + **Try again**; drilling → progress header (thin `bg-blue-600` bar `width: (qIdx+ (checked?1:0))/questions.length`, "Question X of N", running "✓ correct · streak" counters) + `DrillQuestion`; summary → `DrillSummary`.

- [ ] **Step 8:** `pnpm type-check` + `pnpm lint` → clean. Commit — `feat(practice): drill + lesson + hub components`

### Task 9: Pages, nav, cross-links

**Files:**
- Create: `app/(app)/practice/page.tsx`
- Create: `app/(app)/practice/[skill]/page.tsx`
- Modify: `app/components/AppHeader.tsx`
- Modify: `app/(app)/analytics/page.tsx`
- Modify: `app/components/ResultsScreen.tsx`

- [ ] **Step 1: `/practice` hub page** (server). Data: `getAnalytics()` (existing) + `getPracticeSkillStats()` in `Promise.all`. Compute `focus = focusAreas(skills)` (top 3, existing helper). Render: `<h1>Practice</h1>` + sub-line; if `focus.length > 0` → "Your focus areas" grid of `FocusAreaCard`s (rank 1..3, each card's `nextFocus` chain not needed here); else the take-a-test banner (amber, Link to `/`); then "All skills" heading + `SkillCatalog` (skill test stats keyed from `skills`, practice stats from the RPC). Keep `max-w-4xl` for the hub (two-column card grid on `sm:`).

- [ ] **Step 2: `/practice/[skill]` page** (server). **`params` and `searchParams` are Promises in this repo's Next.js 15** — type them as `Promise<...>` and `await` them first (see `app/(app)/dashboard/attempts/[id]/page.tsx` and `app/(app)/admin/users/page.tsx` for the exact pattern): `const { skill: slug } = await params;` then `slugToSkill(slug)` → `notFound()` when null; `const sp = await searchParams;` then `sp.drill === '1'` → `autoStart`. Data in parallel: `getAnalytics()` (for this skill's test stat + computing the next focus area), `getPracticeSkillStats()`, `getRecentDrills(skill)`. `getLesson(skill)` — if null render a minimal "lesson coming soon" card in its place (defensive; check-lessons should make this unreachable). Compute `nextFocus`: the first entry of `focusAreas(skills)` whose skill ≠ current, mapped to `{skill, slug}`. Layout: breadcrumb ("← Practice"), header (skill name, domain, `MasteryChip`, stat line: test accuracy · drills · practice accuracy · last practiced), `SkillDrill` (client) directly under the header (`autoStart` from the query param), then `LessonView`, then a small "Recent drills" list when non-empty (date · score). Export `dynamic = 'force-dynamic'` only if the existing pages do (match `(app)/analytics/page.tsx` conventions — check before adding).

- [ ] **Step 3: `AppHeader.tsx`** — add `Practice` link between Dashboard and Analytics, same styling as siblings.

- [ ] **Step 4: `analytics/page.tsx`** — in the focus-areas callout, wrap each skill line's name in a `Link` to `/practice/[slug]` and append a "Practice this skill →" link (amber-toned, underline). Import `skillSlug` from `@/app/lib/practice/slug`.

- [ ] **Step 5: `ResultsScreen.tsx`** — add a post-score CTA line/button: "Strengthen your weak areas → Practice" linking to `/practice` (place near the existing post-test actions; read the file for the right slot; keep it one `Link`, no new state).

- [ ] **Step 6:** `pnpm type-check` + `pnpm lint` + `pnpm build` → clean. Commit — `feat(practice): hub + skill pages, nav and analytics cross-links`

### Task 10: Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a "Practice sub-project gotchas" section** to CLAUDE.md documenting: (1) practice tables are RLS select-only, writes only via `sat.save_practice` (idempotent on `(user_id, session_uuid)`, server-side re-verification — client `isCorrect` ignored); (2) `sat.draw_drill` is missed-first (latest-answer-wrong definition), capped at half, and UPSERTS `served_questions` — drilled questions never reappear on tests as fresh, the generator absorbs the buffer drain; (3) practice results deliberately do NOT feed `/analytics`; (4) lessons are static code (`app/lib/lessons/`), enforced complete by `scripts/check-lessons.ts` — adding a skill to `SKILLS` fails that script until a lesson exists (list it beside the n8n dual-write gotcha); (5) `logSaveFailure` moved to `app/lib/persistence/failures.ts` — update the verification-command expected-match list (replace `app/lib/persistence/actions.ts` with `app/lib/persistence/failures.ts`); (6) drills have no daily limit by design. Also add the two new check scripts to the Commands section, and fix the stale `parseSpr` description in CLAUDE.md's architecture list (it returns `ParsedSpr | null` — `{ value, raw, isExact }` — not a `{ kind: ... }` union).

- [ ] **Step 2: Commit** — `docs: practice sub-project gotchas + check scripts`

### Task 11: Full verification

- [ ] **Step 1:** Run ALL gates; every one must pass:

```bash
pnpm type-check
pnpm lint
pnpm dlx tsx scripts/check-payload.ts
pnpm dlx tsx scripts/check-analytics.ts
pnpm dlx tsx scripts/check-spr.ts
pnpm dlx tsx scripts/check-scoring.ts
pnpm dlx tsx scripts/check-retry.ts
pnpm dlx tsx scripts/check-backup.ts
pnpm dlx tsx scripts/check-assembly.ts
pnpm dlx tsx scripts/check-lessons.ts
pnpm dlx tsx scripts/check-practice-payload.ts
pnpm build
```

- [ ] **Step 2:** Secret-leak scan (expected matches: `admin.ts`, `generate.ts`, `failures.ts` only):

```powershell
Get-ChildItem -Path app -Recurse -Include *.tsx,*.ts | Select-String -Pattern "supabase/admin|SUPABASE_SERVICE_ROLE_KEY"
```

- [ ] **Step 3 (orchestrator):** Manual smoke on `pnpm dev`: hub renders with focus areas for a user with attempts; skill page lesson + drill; complete a 10-question drill incl. at least one SPR (math skill); verify a `practice_sessions` row lands with server-verified `correct`; `?drill=1` auto-starts; unknown slug 404s.

- [ ] **Step 4:** Final commit if anything changed; do NOT push (orchestrator pushes after smoke).

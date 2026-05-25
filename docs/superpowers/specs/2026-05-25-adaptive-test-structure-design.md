# Sub-project #11 — Adaptive Test Structure Design

**Status:** Draft, pending spec review.
**Owner:** Abi.
**Date:** 2026-05-25.

## Goal

Replace the single-module section model with the real Digital SAT's
**two-module per-section adaptive delivery**. Each full-test section
delivers a **Module 1** (fixed, mixed difficulty) followed by a
**Module 2** (drawn lazily after routing) that's either the **Easier**
path or the **Harder** path based on Module 1 performance. Scoring
extends to two new per-section curves (easier-path / harder-path);
the existing short-test scoring stays unchanged. The 320 untagged
questions in the pool get classified by a one-off LLM batch.

This is the final sub-project in the "near real-world SAT" roadmap
(#8 Skill Coverage → #9 Format Parity → #10 Score Validity → #11
Adaptive Test Structure).

## Non-goals

- IRT-based per-question difficulty parameters (continuous scoring).
  The 3-tier `easy/medium/hard` is a deliberate simplification.
- Backwards re-routing once Module 2 starts (the real test forbids
  going back to Module 1; we follow suit).
- Variable section count or third sections.
- Re-routing within Module 2 based on mid-module performance.
- A "test prep adaptive" mode tuned for studying (e.g. always easier
  questions to build confidence). The adaptive routing is purely the
  real-test simulation.

## Background — why the current model is wrong

The real Digital SAT delivers each section in **two timed modules**
back-to-back:

```
                    SECTION   =   MODULE 1   →   MODULE 2
                                    (fixed)       (adaptive)
                                                 ┌─ Easier path
                                                 └─ Harder path
```

- **Module 1** is identical for every student in a section: a mixed
  spread of easy/medium/hard questions designed to probe ability
  across the curve.
- After Module 1 submit, the test engine grades it, compares to a
  threshold (College Board hasn't published it; ~60% correct is the
  consensus estimate), and picks one of two paths for Module 2.
- **Module 2 Easier** uses lower-difficulty questions; the
  reachable scaled score on this path caps around 600/section.
- **Module 2 Harder** uses higher-difficulty questions; the floor
  of the reachable range is higher (~430) and the ceiling reaches 800.

Today this app delivers a single module per section (27 R&W / 22 Math),
ignores difficulty entirely, and uses a single per-section curve
(`RW_CURVE` / `MATH_CURVE` from sub-project #10). After #11:

- Full-test sections have 54 R&W / 44 Math questions (two modules each).
- Each question carries `difficulty: 'easy' | 'medium' | 'hard'`.
- Each completed attempt records `module2_path: 'easier' | 'harder' | null`
  (null for short attempts, which stay non-adaptive).
- Scoring extends to four new curves
  (`RW_FULL_EASIER_CURVE` / `RW_FULL_HARDER_CURVE` / `MATH_FULL_EASIER_CURVE`
  / `MATH_FULL_HARDER_CURVE`). Each array's `length = fullSectionCount + 1`:
  **55 entries** for R&W (indexed 0..54), **45 entries** for Math (indexed 0..44).

## Architecture

```
                  ┌────────────────────────────────────────────┐
                  │  sat.questions                              │
                  │   .difficulty text NOT NULL                 │
                  │   check (difficulty in ('easy','medium','hard'))│
                  │   index (section, skill, difficulty) WHERE enabled│
                  └────────────────────────────────────────────┘
                                  │
                  ┌───────────────┼──────────────────┐
                  ▼               ▼                  ▼
        ┌─────────────────┐ ┌──────────────┐ ┌──────────────────┐
        │ sat.draw_       │ │ Generator    │ │ One-off backfill │
        │ questions(...,  │ │ tags AI rows │ │ n8n workflow     │
        │ p_difficulty,   │ │ via Ollama   │ │ LLM-classifies   │
        │ p_count)        │ │ prompt       │ │ existing 320 rows│
        └─────────────────┘ └──────────────┘ └──────────────────┘
                  │
                  ▼
        ┌─────────────────────────────────────────────────────────┐
        │  Test runner (useTestSession + buildTest)                │
        │   Full test = 2 sections × 2 modules                     │
        │   Module 1 = 9/9/9 R&W or 8/7/7 Math (easy/med/hard)     │
        │   Module 1 submit → compute correct count                │
        │   Threshold from sat.app_config.module2_threshold_pct    │
        │   route = correct >= ceil(moduleSize * threshold/100)    │
        │           ? 'harder' : 'easier'                          │
        │   Module 2 draw: 70/30 (easy+med for easier, hard+med   │
        │   for harder), drawn from pool with p_difficulty filter  │
        │   Per-module timer (moduleSize × secsPerQ)               │
        │   Auto-advance to Module 2; no back-navigation           │
        └─────────────────────────────────────────────────────────┘
                                  │
                                  ▼
        ┌─────────────────────────────────────────────────────────┐
        │ sat.save_attempt(payload)                                │
        │   stores module2_path per section_breakdown entry        │
        │   computes scaled_score via                              │
        │     sat.scale_section(section, correct, total,           │
        │                       test_length, module2_path)         │
        │   short tests pass module2_path = null → existing curve  │
        │   full tests pass module2_path = 'easier'|'harder'       │
        │     → one of the 4 new full-test curves                  │
        └─────────────────────────────────────────────────────────┘
```

## Data model

### `sat.questions.difficulty`

```sql
alter table sat.questions
  add column difficulty text not null default 'medium'
    check (difficulty in ('easy','medium','hard'));

create index questions_section_skill_difficulty_enabled_idx
  on sat.questions (section, skill, difficulty)
  where enabled;
```

`not null default 'medium'` means every existing row gets the same
placeholder until the backfill workflow re-classifies them. The
adaptive runner can still pull from the pool while classification is
incomplete (everything reads as medium → Module 2 Easier and Harder
both pull from the medium pool until easy/hard tags accumulate). The
backfill workflow updates rows in batches; the runner sees the new
values as soon as they're committed.

Index supports the per-difficulty draw query
(`where section = ? and skill = ? and difficulty = ? and enabled`).
Partial index keeps it small.

### `sat.attempt_responses.module_index`

```sql
alter table sat.attempt_responses
  add column module_index int;  -- 0 = Module 1, 1 = Module 2, null = short
```

Lets the review pages show which module a question came from. Null
for short-test rows.

### `sat.test_attempts.section_breakdown` (jsonb extension)

Each entry gains an optional `module2_path` field:

```jsonc
{
  "name": "Math",
  "sectionKey": "math",
  "correct": 32,
  "total": 44,
  "scaled": 690,
  "module2Path": "harder"   // 'easier' | 'harder' | omitted for short
}
```

No new column on `test_attempts` — `module2_path` lives inside the
jsonb the way `scaled` already does (per-section, not per-attempt;
each section gets its own routing).

### `sat.app_config.module2_threshold_pct`

```sql
alter table sat.app_config
  add column module2_threshold_pct int not null default 60
    check (module2_threshold_pct between 0 and 100);
```

The routing threshold (percent correct on Module 1). Admin-configurable
at `/admin/settings`. Default 60 = a student getting 16/27 on R&W
Module 1 (~59.3%) goes to Easier; 17/27 (~63%) goes to Harder. Math
default: 13/22 (~59%) goes to Easier; 14/22 (~63.6%) goes to Harder.

The threshold is shared across both sections to keep the admin UI
simple. If finer tuning ever becomes necessary, add per-section
columns later.

### `SECTION_CONFIG` refactor (app code)

`app/lib/questions.ts` `SECTION_CONFIG` becomes:

```ts
export const SECTION_CONFIG = {
  rw:   { name: 'Reading & Writing', shortCount: 10, moduleSize: 27, modulesPerSection: 2, secsPerQ: 90  },
  math: { name: 'Math',              shortCount: 10, moduleSize: 22, modulesPerSection: 2, secsPerQ: 105 },
} as const;
```

`fullCount` is removed. Derived helpers:

```ts
export function fullSectionCount(s: SectionKey): number {
  const c = SECTION_CONFIG[s];
  return c.moduleSize * c.modulesPerSection;   // 54 / 44
}
```

The short-test projection target stays at `moduleSize` (27/22), keeping
the existing short-test curves valid. Full-test curves are indexed by
raw count `0..fullSectionCount` — so `array length = fullSectionCount + 1`
= **55** entries for R&W, **45** for Math.

**Re-index discipline (vs. #10):** sub-project #10 re-indexed published
54/44-axis curves onto a 27/22 axis by an every-other-row pick (factor
×2). #11's full-test curves use the published axis **directly** (factor
×1) because `fullSectionCount === published count`. No re-index.

## Scoring

### Four new curves in `app/lib/scoring.ts`

```ts
// Module-2-Easier path: capped around 600/section. Sample
// shape — implementer transcribes from the published Digital SAT
// Practice Test 1 "Easier" scoring guide and re-indexes onto
// the 54/44 axis the same way as the existing short curves.
export const RW_FULL_EASIER_CURVE: readonly number[] = [
  /* length 55, indexed 0..54, monotonic, endpoints 200 .. ~600 */
];

export const RW_FULL_HARDER_CURVE: readonly number[] = [
  /* length 55, indexed 0..54, monotonic, endpoints ~430 .. 800 */
];

export const MATH_FULL_EASIER_CURVE: readonly number[] = [
  /* length 45, indexed 0..44, monotonic, endpoints 200 .. ~600 */
];

export const MATH_FULL_HARDER_CURVE: readonly number[] = [
  /* length 45, indexed 0..44, monotonic, endpoints ~430 .. 800 */
];
```

`CURVE_VERSION` bumps to `'dsat-pt1-2024-09+adaptive'`.

### New helper

```ts
export function scoreFullSection(
  section: SectionKey,
  correct: number,
  path: 'easier' | 'harder',
): number {
  const curves = section === 'rw'
    ? { easier: RW_FULL_EASIER_CURVE, harder: RW_FULL_HARDER_CURVE }
    : { easier: MATH_FULL_EASIER_CURVE, harder: MATH_FULL_HARDER_CURVE };
  const curve = curves[path];
  const n = curve.length - 1;
  const r = Math.round(correct);
  if (r < 0 || r > n) {
    throw new Error(
      `scoreFullSection: raw ${correct} (rounded ${r}) out of range [0, ${n}] for ${section}/${path}`,
    );
  }
  return curve[r];
}
```

`scoreSection` and `projectShort` are unchanged (used by short tests).
`computeResults` branches on `test.length`: short tests call the
existing helpers, full tests call `scoreFullSection` with the path
that came out of routing.

### `sat.scale_section` extension

```sql
create or replace function sat.scale_section(
  p_section text,
  p_correct integer,
  p_total integer,
  p_test_length text,
  p_module2_path text default null   -- 'easier' | 'harder' | null
) returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_curve integer[];
  v_full_count integer;
  v_raw integer;
begin
  -- Unambiguous dispatch — no silent fallthrough between branches.
  if p_test_length = 'short' then
    -- Existing short-test scoring, bit-for-bit identical to #10's
    -- function body (including the floor(x+0.5) projection rule).
    -- Implementer: copy the entire body of the #10 sat.scale_section
    -- function from supabase/migrations/20260525040000_sat_real_scoring.sql
    -- verbatim into this branch — the section + projection logic, the
    -- coalesce(v_raw, 0) clamp, the v_curve[v_raw + 1] return.
    -- Result: short attempts continue to score against the 28/23-length
    -- curves identically.
    -- (Full body elided here for brevity — see the migration template
    -- in section "Migration template" below for the verbatim copy.)
    return /* the existing #10 short-test scoring expression */;

  elsif p_test_length = 'full' then
    -- Full tests REQUIRE a path. Caller discipline alone is insufficient
    -- because sat.save_attempt is the server-trusted score authority; a
    -- payload bug must not silently mis-score.
    if p_module2_path is null then
      raise exception
        'sat.scale_section: full-test scoring requires p_module2_path (got NULL)';
    end if;

    -- Dispatch on (section, path). The four array literals MUST stay
    -- byte-for-byte equivalent to RW_FULL_EASIER_CURVE / RW_FULL_HARDER_CURVE
    -- / MATH_FULL_EASIER_CURVE / MATH_FULL_HARDER_CURVE in app/lib/scoring.ts.
    if p_section = 'rw' and p_module2_path = 'easier' then
      v_curve := array[ /* 55 ints: RW_FULL_EASIER */ ];
    elsif p_section = 'rw' and p_module2_path = 'harder' then
      v_curve := array[ /* 55 ints: RW_FULL_HARDER */ ];
    elsif p_section = 'math' and p_module2_path = 'easier' then
      v_curve := array[ /* 45 ints: MATH_FULL_EASIER */ ];
    elsif p_section = 'math' and p_module2_path = 'harder' then
      v_curve := array[ /* 45 ints: MATH_FULL_HARDER */ ];
    else
      raise exception 'sat.scale_section: unknown (section,path) (%, %)',
        p_section, p_module2_path;
    end if;

    -- Full tests: p_correct is the raw count over the full section
    -- (0..moduleSize*2). No projection. Clamp to [0, fullSectionCount].
    v_raw := greatest(0, least(array_length(v_curve, 1) - 1, p_correct));
    return v_curve[v_raw + 1];

  else
    raise exception 'sat.scale_section: unknown p_test_length (%)', p_test_length;
  end if;
end;
$$;
```

`p_module2_path text default null` keeps the SQL signature
compatible with old callers that only supply 4 args (none today — we
keep the default for safety). The function rejects `(full, null)`
with an explicit exception rather than silently mis-scoring.

### Migration template — call out for the implementer

The #10 short-test scoring branch is preserved exactly. When writing
the migration, the implementer:

1. Reads `supabase/migrations/20260525040000_sat_real_scoring.sql`
   lines 26-75 (the existing `sat.scale_section` body).
2. Copies the entire `begin ... return v_curve[v_raw + 1]; end` block
   into the `p_test_length = 'short'` branch above.
3. Then appends the four new full-test array literals + dispatch logic
   from the template above.

### `sat.save_attempt` recreation

Same drop-and-create as sub-project #10. The `section_breakdown`
assembly now reads `module2Path` from each entry and passes it through:

```sql
v_breakdown := (
  select jsonb_agg(
    jsonb_build_object(
      'name',         e ->> 'name',
      'sectionKey',   e ->> 'sectionKey',
      'correct',      (e ->> 'correct')::int,
      'total',        (e ->> 'total')::int,
      'module2Path',  e ->> 'module2Path',   -- 'easier' | 'harder' | null
      'scaled',       sat.scale_section(
                        e ->> 'sectionKey',
                        (e ->> 'correct')::int,
                        (e ->> 'total')::int,
                        v_test_length,
                        e ->> 'module2Path'
                      )
    )
    order by ord
  )
  from jsonb_array_elements(p_attempt -> 'sectionBreakdown')
    with ordinality as t(e, ord)
);
```

The `attempt_responses` insert gains `module_index` (read from each
response payload's `moduleIndex` field). The new column list adds
`module_index` to the existing #10 list:

```sql
insert into sat.attempt_responses (
  attempt_id, user_id, section_key, section_name, position,
  question_id, skill, source, passage, prompt, choices,
  answer_index, explanation, chosen_index, is_correct,
  response_format, entered_value, correct_answer, answer_tolerance,
  module_index   -- NEW
)
select
  ... (existing columns) ...,
  nullif(r ->> 'moduleIndex', '')::int   -- null for short-test rows
from jsonb_array_elements(p_responses) as r
left join sat.questions q on q.id = r ->> 'questionId';
```

For short-test responses, the client omits `moduleIndex` (or sends
`null`) — both serialise to a SQL NULL via the `nullif(..., '')::int`
trick already used for `chosen_index`.

### Zod schema updates (full list — every wire field must be present)

The CLAUDE.md gotcha from #10 — "The zod schema must list every wire
field — strip mode is silent" — applies here. Three schemas in
[app/lib/persistence/schema.ts](../../app/lib/persistence/schema.ts):

```ts
// attemptResponseSchema gains moduleIndex
const attemptResponseSchema = z.object({
  // ... all existing #9/#10 fields ...
  moduleIndex: z.number().int().min(0).max(1).nullable().optional(),
});

// sectionBreakdown item gains module2Path
attemptPayloadSchema.sectionBreakdown = z.array(
  z.object({
    name: z.string().min(1),
    sectionKey: z.enum(['rw', 'math']),
    correct: z.number().int().min(0),
    total: z.number().int().min(0),
    module2Path: z.enum(['easier', 'harder']).nullable().optional(),  // null/omit for short
  }),
).min(1);
```

`.nullable().optional()` on both new fields means **null AND absent
are both accepted** — important for old persisted attempts that
round-trip through the schema (none exist today, but the optionality
keeps the invariant clean).

## Pool draw

`sat.draw_questions` extends to accept difficulty + count per call:

```sql
create or replace function sat.draw_questions(
  p_section text,
  p_skill   text default null,
  p_difficulty text default null,   -- NEW: 'easy' | 'medium' | 'hard' | null
  p_count   int  default 1
) returns setof sat.questions
language sql
security definer
set search_path = ''
as $$
  -- existing per-user no-repeat logic, plus the new filter:
  select * from sat.questions q
  where q.enabled
    and q.section = p_section
    and (p_skill is null or q.skill = p_skill)
    and (p_difficulty is null or q.difficulty = p_difficulty)
    and q.id not in (
      select question_id from sat.served_questions
      where user_id = auth.uid()
    )
  order by random()
  limit p_count;
$$;
```

The client (`drawTestQuestions` in `app/lib/pool.ts`) makes a
**composition-aware** sequence of draws with a **deterministic
fallback** when the pool is thin. The target module always has
exactly `moduleSize` questions — even when the primary difficulty
buckets can't fully cover the requested slots:

```ts
async function fillSlot(
  section: SectionKey,
  primaryDifficulty: 'easy' | 'medium' | 'hard',
  count: number,
  alreadyDrawn: Set<string>,    // IDs already chosen for this module
): Promise<Question[]> {
  // Tier 1: try the requested difficulty.
  const primary = await rpc('draw_questions', {
    section, difficulty: primaryDifficulty, count,
  });
  if (primary.length >= count) return primary.slice(0, count);

  // Tier 2: backfill from 'medium' (always the deepest cell after backfill).
  const need = count - primary.length;
  const medium = await rpc('draw_questions', {
    section, difficulty: 'medium', count: need,
  });

  // Tier 3: if STILL short, drop the difficulty filter entirely.
  const combined = [...primary, ...medium].filter((q) => !alreadyDrawn.has(q.id));
  if (combined.length >= count) return combined.slice(0, count);
  const stillNeed = count - combined.length;
  const any = await rpc('draw_questions', {
    section, difficulty: null, count: stillNeed,
  });
  return [...combined, ...any.filter((q) => !alreadyDrawn.has(q.id))].slice(0, count);
}

// Full test, R&W Module 1: 9 easy + 9 medium + 9 hard, each filled by fillSlot:
const drawn = new Set<string>();
const easy   = await fillSlot('rw', 'easy',   9, drawn); easy.forEach((q) => drawn.add(q.id));
const medium = await fillSlot('rw', 'medium', 9, drawn); medium.forEach((q) => drawn.add(q.id));
const hard   = await fillSlot('rw', 'hard',   9, drawn); hard.forEach((q) => drawn.add(q.id));
const module1RW = shuffle([...easy, ...medium, ...hard]);

// Module 2 is drawn lazily, AFTER Module 1 is graded:
const path: 'easier' | 'harder' = correctCount >= cutoff ? 'harder' : 'easier';
const primaryD = path === 'easier' ? 'easy' : 'hard';
const m2Primary = await fillSlot('rw', primaryD, 19, drawn);
m2Primary.forEach((q) => drawn.add(q.id));
const m2Medium  = await fillSlot('rw', 'medium', 8, drawn);
const module2RW = shuffle([...m2Primary, ...m2Medium]);
```

**Invariant**: every module call returns exactly `moduleSize`
questions. The fallback degrades the adaptive fidelity (a "Harder"
Module 2 might contain medium questions if hard is depleted) but
never breaks the scoring invariant (curve is indexed by `correct`
count over `moduleSize`).

**Edge case (cold start)**: if the pool truly cannot deliver
`moduleSize` enabled questions for the section (e.g. a brand-new
deployment), the function returns however many it has and the runner
falls back to `BANK` (the existing offline-fallback behaviour from
`useTestSession.start()`). This is already covered by the existing
fallback path; we extend the same pattern for modules.

Short tests are unchanged — they continue calling the single-pool
draw without difficulty filtering. The existing `drawTestQuestions`
signature is renamed to `drawShortTest` to make the contract clear,
and `drawFullTest` / `drawModule2` are new exports.

### Floor gate extension

The thinnest-first picker (`app/lib/ai/generate.ts` + n8n Plan
Batches node) becomes per `(section, skill, difficulty)`. `SKILL_FLOOR`
now applies per difficulty (so each cell needs ≥ 3 enabled questions
before that cell stops triggering generation). The total pool grows
3× for the same coverage, which the on-the-clock generator handles
across the existing daily cron + hourly n8n workflow.

The per-user buffer gate (`sat.min_active_user_unseen`) is unchanged
— it still counts unseen-anywhere-in-pool. The difficulty-floor signal
fires until each cell has the minimum 3 questions.

## Test runner FSM

### `Test` / `Section` / `Module` types

```ts
// app/lib/test.ts
export interface TestModule {
  index: number;               // 0 or 1
  questions: Question[];       // moduleSize entries, shuffled
  timeLimit: number;           // moduleSize × secsPerQ
}

export interface TestSection {
  key: SectionKey;
  name: string;
  modules: TestModule[];       // length 1 for short, 2 for full
  module2Path?: 'easier' | 'harder';  // set after Module 1 submit; null for short
}

export interface Test {
  name: string;
  length: TestLength;          // 'short' | 'full'
  sections: TestSection[];
}
```

The existing `TestSection.questions` field is **removed**; existing
consumers either iterate `section.modules` or read the convenience
helper:

```ts
export function sectionQuestions(s: TestSection): Question[] {
  return s.modules.flatMap((m) => m.questions);
}
```

### `useTestSession` extension

```ts
// State:
const [secIdx, setSecIdx] = useState(0);
const [modIdx, setModIdx] = useState(0);  // 0 = Module 1, 1 = Module 2
const [qIdx,   setQIdx]   = useState(0);
// responses: [section][module][question]
const [responses, setResponses] = useState<ResponseValue[][][]>([]);
```

Transition logic:

```ts
const submitModule = async () => {
  if (!test) return;
  if (test.length === 'short') {
    // existing flow: move section or finish
    return submitSection();
  }
  const sec = test.sections[secIdx];
  if (modIdx === 0) {
    // Compute Module 1 correct, decide path, draw Module 2 lazily.
    const correct = countCorrect(sec.modules[0], responses[secIdx][0]);
    const threshold = await getModule2ThresholdPct();
    const moduleSize = SECTION_CONFIG[sec.key].moduleSize;
    const cutoff = Math.ceil(moduleSize * threshold / 100);
    const path: 'easier' | 'harder' = correct >= cutoff ? 'harder' : 'easier';
    const drawn = await drawModule2(sec.key, path);
    // Apply to test in place — appending Module 2 + path.
    setTest((t) => withModule2(t!, secIdx, drawn, path));
    setResponses((r) => withModule2Responses(r, secIdx, drawn.length));
    setModIdx(1);
    setQIdx(0);
  } else {
    // Module 2 done — advance section or finish.
    if (secIdx === test.sections.length - 1) {
      finish();
    } else {
      setSecIdx((s) => s + 1);
      setModIdx(0);
      setQIdx(0);
    }
  }
};
```

The Module 1 → Module 2 transition uses the same auto-advance UX as
the existing section transition (existing `submitSection` confirm
prompt is reused, but the message changes per state).

The `remaining[]` countdown array becomes `remaining[secIdx][modIdx]`
— per-module timer. Time-up fires `submitModule` automatically.

## Backfill workflow

A new n8n workflow `SAT Difficulty Classifier` (separate workflow
from the generator) does a one-off LLM classification of every row
where `difficulty = 'medium' AND id NOT IN (already classified)`.

Workflow shape:
1. **Trigger**: Manual ("Execute workflow" button) — the user runs it
   once after the migration lands. Hourly cron is NOT added; this is
   a one-off.
2. **Read batch**: 20 rows at a time from `sat.questions` where
   classification hasn't run yet.
3. **Ollama prompt**: "Classify this Digital SAT question as easy,
   medium, or hard based on the cognitive demand. Easy = single
   step, common skill, low working memory. Medium = two steps or
   a less common skill. Hard = multi-step or nuanced inference."
4. **Update**: writes back `difficulty` to the row.
5. **Loop**: SplitInBatches v3 (existing pattern in the Galaxy /
   email-cleanup work) until the row set is exhausted.

To track "already classified", a separate `classified_at timestamptz`
column is added on `sat.questions`. Rows with `classified_at is null`
are eligible for the workflow; rows it touches get `classified_at = now()`.
New AI-generated questions skip this column (the generator sets
`difficulty` directly from the generation prompt and stamps
`classified_at = now()` at insert time).

The migration that adds the column stamps every existing row's
`classified_at = null` so the backfill can run.

## AI generator changes

### Ollama prompt

The MCQ and SPR prompts in `app/lib/ai/ollama.ts` gain a `difficulty`
output field, with a brief calibration note in the prompt:

```
Also include "difficulty": one of "easy", "medium", "hard".
- easy: a single computational or recall step; one common skill.
- medium: two steps or a less common skill.
- hard: multi-step reasoning, careful reading, or nuanced inference.
```

### zod schema

`generatedQuestionSchema` (in `app/lib/ai/schema.ts`) requires
`difficulty: z.enum(['easy', 'medium', 'hard'])`.

### Generator picker

`generate.ts` picks the thinnest `(section, skill, difficulty)` slot
rather than the thinnest `(section, skill)`. Same n8n Plan Batches
node — both implementations of the picker are updated together.

## UI

### TestScreen

The header gains a module indicator:

```
Reading & Writing  ·  Module 1 of 2          [timer]
```

After routing into Module 2:

```
Reading & Writing  ·  Module 2 of 2  ·  Adaptive: Harder    [timer]
```

The "Adaptive: Easier" / "Adaptive: Harder" badge is muted slate —
informational, not flashing. Some users may prefer to not see it (it
spoils the implied performance feedback). A small note in the
disclaimer on `ResultsScreen` will explain that the real Digital SAT
does not show the path to the test taker — students can opt for an
"Hide path while testing" toggle in a future polish iteration.

### Per-module timer

The existing single-timer logic stretches to handle `remaining[secIdx][modIdx]`.
The timer reads the right slot; time-up calls `submitModule()`.

### AttemptCard / ResultsScreen

`section_breakdown` entries now include `module2Path`. The card chip
gains a small badge when path is set:

```
R&W 720 (Harder)  ·  Math 690 (Harder)  [Full]
```

For short attempts (no path), it shows:
```
R&W 740  ·  Math 720  [Short]
```

The `ResultsScreen` per-section card adds a one-line caption under
the scaled score when path is set:
```
                Reading & Writing
                       720
                Module 2: Harder path
                51 / 54 correct
```

### Admin

`/admin/questions/[id]` gains a difficulty dropdown (Edit and Save).
Server action: `setQuestionDifficulty(id, difficulty)` (service-role
write, behind `requireAdmin()`, mirrors the existing `setQuestionEnabled`
pattern).

`/admin/questions` (pool listing) gains a difficulty filter alongside
the existing section/status filters.

## Things that will bite you (CLAUDE.md gotchas additions)

- **`sat.questions.difficulty` defaults to `'medium'` for backward
  compatibility; the backfill workflow re-classifies.** Until you
  run the SAT Difficulty Classifier workflow once, the per-difficulty
  pool depth is unbalanced (all medium). Module 2 routing still
  works but pulls from the medium pool until easy/hard tags accumulate.
- **`sat.scale_section` requires a non-null `p_module2_path` for full
  tests — it raises rather than fallthrough-mis-scoring.** A full
  attempt that reaches the RPC without `module2Path` set fails with
  `'sat.scale_section: full-test scoring requires p_module2_path
  (got NULL)'`. If you see that exception in logs, the bug is upstream
  — find the caller that omitted `moduleIndex`/`module2Path` from
  the payload (typically a forgotten zod schema field or a stale
  `payload.ts` mapper). Short tests pass `null` deliberately; full
  tests must always pass `'easier'` or `'harder'`.
- **The four new curves (`RW_FULL_EASIER`, `RW_FULL_HARDER`,
  `MATH_FULL_EASIER`, `MATH_FULL_HARDER`) and their array literals
  inside `sat.scale_section` MUST stay byte-for-byte equivalent.**
  Same drift discipline as the existing curves. The parity battery
  in `scripts/check-scoring.ts` extends to cover all six curves.
- **Module 2 question draw is lazy** — runs server-side after Module 1
  is submitted. If the user closes the tab before Module 2 starts,
  the in-progress attempt is lost (we don't persist mid-test state).
  Same as today's mid-test exit behaviour.
- **The per-skill floor gate now demands per-difficulty depth.** If
  you add a new skill, the generator needs to mint 3 easy + 3 medium +
  3 hard questions for it before the floor stops firing. Total minimum
  pool grows 3× for the same coverage; the on-the-clock cron handles
  this across hours.
- **Routing threshold is a runtime config, not a code constant.**
  `sat.app_config.module2_threshold_pct` is the source of truth.
  Admin can change it at `/admin/settings`. Don't hardcode a fallback
  in client code — read from the config.

## Commit plan

Six commits. Each is a self-contained advancement.

1. **`feat(scoring): schema + 4 adaptive curves + scale_section extension`**
   - `supabase/migrations/20260525050000_sat_adaptive_schema.sql`:
     - `difficulty` column on `sat.questions` (`not null default 'medium'` + check constraint)
     - `classified_at` column on `sat.questions` (nullable timestamptz)
     - `module_index int` column on `sat.attempt_responses` (nullable)
     - `module2_threshold_pct int default 60 check (0..100)` on `sat.app_config`
     - Partial index `(section, skill, difficulty) where enabled`
     - `sat.draw_questions` extended with `p_difficulty` + `p_count` args
       (old signature dropped + new grant; existing callers using the
       2-arg positional form, if any, must be inventoried beforehand)
     - `sat.scale_section` recreation with `p_module2_path` arg and four
       new array literals
     - `sat.save_attempt` recreation that reads `module2Path` per section
       breakdown entry and `moduleIndex` per response
   - `app/lib/scoring.ts`: `RW_FULL_EASIER_CURVE` / `RW_FULL_HARDER_CURVE`
     / `MATH_FULL_EASIER_CURVE` / `MATH_FULL_HARDER_CURVE` constants;
     `scoreFullSection`; bumped `CURVE_VERSION = 'dsat-pt1-2024-09+adaptive'`.
   - `app/lib/persistence/queries.ts`:
     `SectionBreakdownEntry` gains `module2Path?: 'easier' | 'harder'`;
     `AttemptResponseRow` gains `module_index: number | null`.
   - `app/lib/persistence/payload.ts`:
     `AttemptPayload.sectionBreakdown` item type gains
     `module2Path?: 'easier' | 'harder' | null`;
     `AttemptResponsePayload` gains `moduleIndex: number | null`.
     **The payload mapper does NOT change in commit 1** — it continues
     producing payloads from the existing `Test` shape (single
     `section.questions` array). The new fields are added to the type
     but populated with safe defaults (`null`) by the mapper until
     commit 2 wires them through.
   - `app/lib/persistence/schema.ts`: zod gains `module2Path` on
     section breakdown items + `moduleIndex` on response items
     (both `.nullable().optional()`).
   - `scripts/check-scoring.ts`: parity battery extended.
     - **CURVE_VERSION assertion** updated to the new sentinel.
     - One **locked-sample row per `(section, path)` quadrant** (4
       new BATTERY rows), each with the exact expected scaled value
       from the published table.
     - One **path-inequality assertion**: for a fixed `correct` near
       the routing cutoff (e.g. 16/27 R&W), the Easier-path scaled
       score must be **strictly less** than the Harder-path scaled
       score — proves the curves are calibrated in the right direction.
     - Curve length / endpoints / monotonicity / range over [200, 800]
       for each of the four new curves.
     - **TDD ordering**: the check-scoring.ts extensions land FIRST
       in this commit, fail with module-not-found on the new helper,
       then the scoring.ts implementation lands and the script passes.
   - **No UI files change in commit 1.** Acceptance gate: `pnpm
     type-check` green AND `pnpm dlx tsx scripts/check-scoring.ts`
     green AND `pnpm dlx tsx scripts/check-payload.ts` green at the
     end of commit 1.

2. **`feat(adaptive): module-based test runner`**
   - `app/lib/questions.ts`: `SECTION_CONFIG` refactor — adds
     `moduleSize` + `modulesPerSection`, removes `fullCount`. **Grep
     `fullCount` across the repo as the first step of this commit** —
     any remaining reference fails type-check. Likely call sites:
     `app/lib/scoring.ts` (the `scoreSection` clamp comment + the
     `projectShort` denominator — both now use `moduleSize`),
     `scripts/check-scoring.ts` sanity asserts, anywhere else.
   - `app/lib/test.ts`: `Test` / `TestSection` / `TestModule` shape;
     `buildTest` produces modules; `computeResults` branches on
     `test.length` to use `scoreFullSection`; new `sectionQuestions`
     helper for legacy consumers that want a flat list (review pages,
     etc.).
   - `app/lib/pool.ts`: rename existing `drawTestQuestions` to
     `drawShortTest`; add `drawFullTest` (Module 1 only) + `drawModule2`;
     add `fillSlot` helper with the 3-tier fallback.
   - `app/hooks/useTestSession.ts`: `modIdx` state; `submitModule`
     logic; per-module timer (responses + remaining matrices become
     3-D); routing call to `getModule2ThresholdPct`.
   - `app/lib/config.ts`: `getModule2ThresholdPct()`.
   - `app/lib/persistence/payload.ts`: payload mapper now iterates
     `section.modules[m].questions` and writes `moduleIndex: m` per
     response, and `module2Path` per section breakdown entry.
   - `app/components/QuestionNavigator.tsx`: per-module navigation
     (Module 1 → Module 2 grouping). Update reads of
     `sec.questions` → `sectionQuestions(sec)`.
   - `app/components/ResultsScreen.tsx`: legacy `section.questions`
     iteration switches to `sectionQuestions(sec)`.
   - `scripts/check-payload.ts`: rewrite the in-script
     `responses[si][qi]` synthesis to `responses[si][mi][qi]` (3-D);
     assert `moduleIndex` on each response; assert `module2Path`
     populated on full-test breakdown entries.
   - **Acceptance gate**: `pnpm type-check` clean by end of commit 2.
3. **`feat(ai): generator emits difficulty + thinnest-first per-difficulty`**
   - `app/lib/ai/ollama.ts`: difficulty in prompts.
   - `app/lib/ai/schema.ts`: zod requires `difficulty`.
   - `app/lib/ai/generate.ts`: floor gate per `(section, skill, difficulty)`,
     thinnest-first picker by difficulty.
   - n8n Plan Batches updated.
4. **`feat(admin): difficulty backfill workflow + admin override`**
   - New n8n workflow `SAT Difficulty Classifier`.
   - `app/lib/admin/actions.ts`: `setQuestionDifficulty`.
   - `app/(app)/admin/questions/[id]/page.tsx`: difficulty dropdown.
   - `app/(app)/admin/questions/page.tsx`: difficulty filter chip.
5. **`feat(ui): module indicator + path badge`**
   - TestScreen header with Module-X-of-Y indicator + path badge.
   - AttemptCard / ResultsScreen / attempt-review-page show path.
   - QuestionNavigator gets per-module section.
6. **`docs(adaptive): document the adaptive-test sub-project`**
   - CLAUDE.md "Adaptive Test Structure sub-project gotchas" section.
   - README: Scoring section update + new Adaptive Test section.
   - Things-that-bite update: the old "single per-section curve"
     entry replaced with a description of the path-aware model.

## Acceptance

- `pnpm type-check`, `pnpm lint` clean after each commit; explicitly
  clean by end of commit 5.
- `scripts/check-scoring.ts` green; extended battery covers six curves
  (existing short × 2 + new full × 4) with endpoints, monotonicity,
  every value in [200, 800], `CURVE_VERSION` sentinel.
- `scripts/check-payload.ts` green; extended battery asserts
  `module2Path` on each section breakdown entry for full attempts
  and absent / null for short attempts.
- Migration apply: backfill UPDATE of existing rows touches all 320
  rows; `classified_at` is null for them; the n8n workflow is ready
  to run.
- SQL parity spot-checks: every curve quadrant returns expected
  values when called via `sat.scale_section`.
- Live test: a fresh full R&W test shows Module 1 → submit →
  Module 2 with path indicator → submit → composite scaled score
  in the expected range.
- Admin: question detail page shows + lets you change difficulty;
  the pool filter chip filters by difficulty.

## Risks

### Curve transcription errors

Six curves, four of them new. `check-scoring.ts` enforces monotonicity,
endpoint values, range, and a locked sample per quadrant. The same
discipline as #10 — drift between TS arrays and SQL `array[]` literals
is the prime failure mode; the parity battery catches it.

### Module 2 draw race

`drawModule2` runs after Module 1 submit. If the pool is too thin
(unbalanced difficulty in some skill cell), the draw could return
fewer than the requested 19/8 questions. The runner falls back to
backfilling from the medium pool (which always has the most depth
right after backfill). A future iteration could enforce per-cell
depth more aggressively.

### Threshold tuning

`module2_threshold_pct = 60` is a starting point. Real test data
suggests 60-70%; the admin can tune. The default is conservative
(easier to route to Harder, which has more upside score).

### Question pool capacity

The per-difficulty floor gate triples generation demand: 35 skills ×
2 sections × 3 difficulties × 3 floor = **~630 questions minimum** vs
the current 320 in the pool. Almost a doubling of the absolute pool
size. The existing daily cron + hourly n8n workflow handles this
without code changes, but the lag between "skill added" and "all
9 (skill, difficulty) cells full" widens from ~5 hours to ~15 hours.

**Hard prerequisite for full-test usability**: the SAT Difficulty
Classifier workflow MUST be run after the migration lands and BEFORE
the first full-adaptive test is taken — otherwise every existing row
is `difficulty='medium'`, Module 1 has no easy/hard pool to draw from,
and `fillSlot` falls through to Tier 2 (medium) for every cell. The
test still runs (invariant preserved by the fallback) but adaptive
fidelity is degraded to "everyone gets the same Module 2". Acceptance
includes "user has run the classifier workflow to completion".

### Sub-project #10 curve assumed single-module fullCount

`SECTION_CONFIG.fullCount` was 27/22 in #10; #11 renames to `moduleSize`
and adds `modulesPerSection`. Anywhere `fullCount` is referenced
(scoring sanity assertions, projectShort, etc.) needs a rename. The
check-scoring.ts assertion `RW_CURVE.length - 1 === SECTION_CONFIG.rw.fullCount`
becomes `=== SECTION_CONFIG.rw.moduleSize`. The grep before this
sub-project lands should turn up zero stragglers (commit 2 does this
grep as its first step).

### Backwards-compatibility for #10 full-test attempts

No past full-test attempts exist in production (the app only really
delivered short tests; full mode was 27/22 by accident — same as
short's projection target). The backfill in #10 fixed every existing
row's scaled score. After #11:

- Old #10 attempts persisted with `test_length = 'short'` continue
  scoring against the existing 28/23 short curves. Unchanged.
- The four new full-test curves apply only to **new** full attempts
  saved after this migration. The `module2Path` field on those rows
  drives curve selection.
- The CURVE_VERSION bump (`'dsat-pt1-2024-09'` → `'dsat-pt1-2024-09+adaptive'`)
  documents the model change in `scoring.ts`. The score-trend chart
  for any user who happened to take a "full" test under #10 will show
  a step on the swap day, but no such attempts exist today (verified
  via `select count(*) from sat.test_attempts where test_length =
  'full';` as a pre-migration check).

### `sat.draw_questions` grant churn

The existing `sat.draw_questions(text, int)` signature is dropped and
re-created as `sat.draw_questions(text, text, text, int)`. The previous
grant becomes orphaned (Postgres drops it automatically when the
function is dropped); the new signature gets its own
`grant execute on function sat.draw_questions(text, text, text, int)
to authenticated`. Pre-migration check: confirm no external caller
uses the positional 2-arg form (none today — only `app/lib/pool.ts`
calls this via PostgREST named-arg style).

## Sub-project sequencing reminder

This is the last sub-project in the roadmap. After #11 ships:
- The "near real-world SAT" roadmap is complete: #8 Skill Coverage,
  #9 Format Parity (SPR), #10 Score Validity, #11 Adaptive Structure.
- Future polish iterations (calibration tuning, "hide path while
  testing" toggle, IRT migration) are deferred.

# Adaptive Test Structure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real Digital SAT **two-module per-section adaptive delivery**. Module 1 (fixed, mixed difficulty) routes to Module 2 (Easier / Harder) based on Module 1 performance. Four new path-aware scoring curves; 3-tier `difficulty` tagging on `sat.questions`; one-off LLM classifier backfill; module-aware test runner FSM.

**Architecture:** `sat.questions.difficulty` (text, 3-tier) drives a difficulty-aware draw RPC. The test runner builds Module 1 (composition: 1/3 each easy/med/hard), grades it on submit, picks `'easier'` or `'harder'` based on `sat.app_config.module2_threshold_pct`, then lazily draws Module 2 (70% primary + 30% medium). `sat.scale_section` gains `p_module2_path` and four new SQL curve literals mirroring `RW_FULL_EASIER_CURVE` / `RW_FULL_HARDER_CURVE` / `MATH_FULL_EASIER_CURVE` / `MATH_FULL_HARDER_CURVE`. Short tests stay non-adaptive (existing short curves unchanged).

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript strict · Supabase Postgres (plpgsql security-definer RPCs) · pnpm · zod · n8n workflows · scripted assertion files.

**Spec:** [docs/superpowers/specs/2026-05-25-adaptive-test-structure-design.md](../specs/2026-05-25-adaptive-test-structure-design.md) (commit `7ce291c`).

---

## Curve numbers (locked for this plan)

Four new arrays. Sample values are plausible shapes from the published DSAT Practice Test 1 "Easier" / "Harder" Module 2 scoring guide (axis-direct: no re-index because `fullSectionCount` equals the published count). Implementer verifies against the actual PDF and adjusts; `scripts/check-scoring.ts` catches monotonicity/endpoint/range bugs.

```ts
// length 55, indexed 0..54, endpoints 200 .. 600
export const RW_FULL_EASIER_CURVE: readonly number[] = [
  200, 200, 200, 210, 220, 230, 240, 260, 280, 300,
  320, 340, 360, 370, 380, 390, 400, 410, 420, 430,
  440, 450, 460, 470, 480, 490, 500, 510, 510, 520,
  520, 530, 530, 540, 540, 550, 550, 560, 560, 570,
  570, 580, 580, 580, 580, 590, 590, 590, 590, 600,
  600, 600, 600, 600, 600,
];

// length 55, indexed 0..54, endpoints 430 .. 800
export const RW_FULL_HARDER_CURVE: readonly number[] = [
  430, 430, 440, 450, 460, 470, 480, 490, 500, 510,
  520, 530, 540, 550, 560, 570, 580, 590, 600, 610,
  620, 630, 640, 650, 660, 670, 680, 690, 700, 705,
  710, 715, 720, 725, 730, 735, 740, 745, 750, 755,
  760, 765, 770, 775, 780, 785, 790, 793, 795, 797,
  798, 799, 800, 800, 800,
];

// length 45, indexed 0..44, endpoints 200 .. 600
export const MATH_FULL_EASIER_CURVE: readonly number[] = [
  200, 200, 210, 220, 240, 260, 280, 300, 320, 340,
  360, 380, 400, 410, 420, 430, 440, 450, 460, 470,
  480, 490, 500, 510, 520, 530, 540, 545, 550, 555,
  560, 565, 570, 575, 580, 585, 585, 590, 590, 595,
  595, 600, 600, 600, 600,
];

// length 45, indexed 0..44, endpoints 430 .. 800
export const MATH_FULL_HARDER_CURVE: readonly number[] = [
  430, 440, 450, 460, 470, 480, 490, 500, 510, 520,
  530, 540, 550, 560, 570, 580, 590, 600, 610, 620,
  630, 640, 650, 660, 670, 680, 690, 700, 710, 720,
  725, 730, 735, 740, 745, 750, 755, 760, 765, 770,
  775, 780, 790, 795, 800,
];

export const CURVE_VERSION = 'dsat-pt1-2024-09+adaptive';
```

**Sanity invariants** (assertions in `check-scoring.ts`):
- Each curve monotonic non-decreasing.
- RW_FULL_EASIER_CURVE[0] = 200; RW_FULL_EASIER_CURVE[54] = 600.
- RW_FULL_HARDER_CURVE[0] = 430; RW_FULL_HARDER_CURVE[54] = 800.
- MATH_FULL_EASIER_CURVE[0] = 200; MATH_FULL_EASIER_CURVE[44] = 600.
- MATH_FULL_HARDER_CURVE[0] = 430; MATH_FULL_HARDER_CURVE[44] = 800.
- For any `correct` in [0, 54]: `RW_FULL_HARDER_CURVE[correct] > RW_FULL_EASIER_CURVE[correct]` (path inequality — Harder path always scores higher than Easier path for the same raw count). Same for Math.
- Every value in [200, 800].

---

## Chunk 1: Commit 1 — schema + scoring + curves + types

### Task 1: Add the failing parity battery to `check-scoring.ts`

**Files:**
- Modify: `scripts/check-scoring.ts`

- [ ] **Step 1: Append new imports + sanity + battery rows**

Open `scripts/check-scoring.ts`. After the existing imports, add:

```ts
import {
  RW_FULL_EASIER_CURVE,
  RW_FULL_HARDER_CURVE,
  MATH_FULL_EASIER_CURVE,
  MATH_FULL_HARDER_CURVE,
  scoreFullSection,
} from '../app/lib/scoring';
```

Update the CURVE_VERSION assertion line:
```ts
assert(CURVE_VERSION === 'dsat-pt1-2024-09+adaptive', 'CURVE_VERSION locked');
```

After the existing curve sanity loops, add the new ones:

```ts
// ---------- New curves (sub-project #11) ----------

const FULL_CURVES = [
  { name: 'RW_FULL_EASIER',   curve: RW_FULL_EASIER_CURVE,   expectedLen: 55, endpoint: [200, 600] },
  { name: 'RW_FULL_HARDER',   curve: RW_FULL_HARDER_CURVE,   expectedLen: 55, endpoint: [430, 800] },
  { name: 'MATH_FULL_EASIER', curve: MATH_FULL_EASIER_CURVE, expectedLen: 45, endpoint: [200, 600] },
  { name: 'MATH_FULL_HARDER', curve: MATH_FULL_HARDER_CURVE, expectedLen: 45, endpoint: [430, 800] },
] as const;

for (const { name, curve, expectedLen, endpoint: [lo, hi] } of FULL_CURVES) {
  assert(curve.length === expectedLen, `${name}.length === ${expectedLen}`);
  assert(curve[0] === lo,                       `${name}[0] === ${lo}`);
  assert(curve[curve.length - 1] === hi,        `${name} last === ${hi}`);
  for (let i = 0; i < curve.length; i++) {
    assert(curve[i] >= 200 && curve[i] <= 800, `${name}[${i}] in [200,800]`);
  }
  for (let i = 1; i < curve.length; i++) {
    assert(curve[i] >= curve[i - 1], `${name} non-decreasing at i=${i}`);
  }
}

// Path inequality — Harder ≥ Easier at every raw count (and strictly > for most).
for (let i = 0; i < RW_FULL_EASIER_CURVE.length; i++) {
  assert(RW_FULL_HARDER_CURVE[i] >= RW_FULL_EASIER_CURVE[i],
    `RW_FULL_HARDER[${i}] >= RW_FULL_EASIER[${i}]`);
}
for (let i = 0; i < MATH_FULL_EASIER_CURVE.length; i++) {
  assert(MATH_FULL_HARDER_CURVE[i] >= MATH_FULL_EASIER_CURVE[i],
    `MATH_FULL_HARDER[${i}] >= MATH_FULL_EASIER[${i}]`);
}

// scoreFullSection: locked quadrant rows.
assert(scoreFullSection('rw',   0,  'easier') === 200,                          'rw/easier raw 0 → 200');
assert(scoreFullSection('rw',   54, 'easier') === 600,                          'rw/easier raw 54 → 600');
assert(scoreFullSection('rw',   0,  'harder') === 430,                          'rw/harder raw 0 → 430');
assert(scoreFullSection('rw',   54, 'harder') === 800,                          'rw/harder raw 54 → 800');
assert(scoreFullSection('math', 0,  'easier') === 200,                          'math/easier raw 0 → 200');
assert(scoreFullSection('math', 44, 'easier') === 600,                          'math/easier raw 44 → 600');
assert(scoreFullSection('math', 0,  'harder') === 430,                          'math/harder raw 0 → 430');
assert(scoreFullSection('math', 44, 'harder') === 800,                          'math/harder raw 44 → 800');

// Mid-band path inequality at the routing cutoff (raw 17, half-ish of 54).
assert(scoreFullSection('rw', 17, 'harder') > scoreFullSection('rw', 17, 'easier'),
  'rw raw 17 harder > easier (path inequality)');
```

Also update the `RW_CURVE.length - 1 === SECTION_CONFIG.rw.fullCount` assertions to use `moduleSize` (commit 2 changes `SECTION_CONFIG`; for commit 1, the assertions still use `fullCount` and pass). Leave them alone for now — they're commit 2's responsibility.

- [ ] **Step 2: Run; expect failure**

```bash
pnpm dlx tsx scripts/check-scoring.ts
```

Expected: tsx resolves the new imports (`RW_FULL_EASIER_CURVE` etc. don't exist yet, neither does `scoreFullSection`); fails at module load with "no exported member 'RW_FULL_EASIER_CURVE'" or similar. **Failing-test gate.**

- [ ] **Step 3: Save progress** (do not commit)

---

### Task 2: Add curves + `scoreFullSection` to `scoring.ts`

**Files:**
- Modify: `app/lib/scoring.ts`

- [ ] **Step 1: Update CURVE_VERSION**

Change `'dsat-pt1-2024-09'` → `'dsat-pt1-2024-09+adaptive'`.

- [ ] **Step 2: Append the four new curves**

Append after `MATH_CURVE`:

```ts
// Sub-project #11 — Adaptive Test Structure.
//
// Full-test curves indexed by raw correct count over the entire
// 2-module section (length = fullSectionCount + 1 = 55 for R&W,
// 45 for Math). The published axis matches our axis 1:1 — no
// re-index multiplier (contrast the short curves above, which
// re-index by ×2 because moduleSize is half the published count).
//
// MIRROR DISCIPLINE: these arrays MUST stay byte-for-byte equivalent
// to the SQL array[] literals inside sat.scale_section's full-test
// branch. Update both in the same change.
export const RW_FULL_EASIER_CURVE: readonly number[] = [
  200, 200, 200, 210, 220, 230, 240, 260, 280, 300,
  320, 340, 360, 370, 380, 390, 400, 410, 420, 430,
  440, 450, 460, 470, 480, 490, 500, 510, 510, 520,
  520, 530, 530, 540, 540, 550, 550, 560, 560, 570,
  570, 580, 580, 580, 580, 590, 590, 590, 590, 600,
  600, 600, 600, 600, 600,
];

export const RW_FULL_HARDER_CURVE: readonly number[] = [
  430, 430, 440, 450, 460, 470, 480, 490, 500, 510,
  520, 530, 540, 550, 560, 570, 580, 590, 600, 610,
  620, 630, 640, 650, 660, 670, 680, 690, 700, 705,
  710, 715, 720, 725, 730, 735, 740, 745, 750, 755,
  760, 765, 770, 775, 780, 785, 790, 793, 795, 797,
  798, 799, 800, 800, 800,
];

export const MATH_FULL_EASIER_CURVE: readonly number[] = [
  200, 200, 210, 220, 240, 260, 280, 300, 320, 340,
  360, 380, 400, 410, 420, 430, 440, 450, 460, 470,
  480, 490, 500, 510, 520, 530, 540, 545, 550, 555,
  560, 565, 570, 575, 580, 585, 585, 590, 590, 595,
  595, 600, 600, 600, 600,
];

export const MATH_FULL_HARDER_CURVE: readonly number[] = [
  430, 440, 450, 460, 470, 480, 490, 500, 510, 520,
  530, 540, 550, 560, 570, 580, 590, 600, 610, 620,
  630, 640, 650, 660, 670, 680, 690, 700, 710, 720,
  725, 730, 735, 740, 745, 750, 755, 760, 765, 770,
  775, 780, 790, 795, 800,
];
```

- [ ] **Step 3: Add `scoreFullSection`**

Append after `scoreComposite`:

```ts
/**
 * Full-test per-section scoring. raw 0..fullSectionCount → 200..800.
 * Throws on out-of-range (same as scoreSection). The path determines
 * which of four curves applies.
 */
export function scoreFullSection(
  section: SectionKey,
  rawCorrect: number,
  path: 'easier' | 'harder',
): number {
  const curves = section === 'rw'
    ? { easier: RW_FULL_EASIER_CURVE, harder: RW_FULL_HARDER_CURVE }
    : { easier: MATH_FULL_EASIER_CURVE, harder: MATH_FULL_HARDER_CURVE };
  const curve = curves[path];
  const n = curve.length - 1;
  const r = Math.round(rawCorrect);
  if (r < 0 || r > n) {
    throw new Error(
      `scoreFullSection: raw ${rawCorrect} (rounded ${r}) out of range [0, ${n}] for ${section}/${path}`,
    );
  }
  return curve[r];
}
```

- [ ] **Step 4: Run check-scoring; expect PASS**

```bash
pnpm dlx tsx scripts/check-scoring.ts
```

Expected: all `ok — ...` lines. Final "All scoring assertions passed."

- [ ] **Step 5: Save progress**

---

### Task 3: Extend persistence types (`queries.ts` + `payload.ts` + `schema.ts`)

**Files:**
- Modify: `app/lib/persistence/queries.ts`
- Modify: `app/lib/persistence/payload.ts`
- Modify: `app/lib/persistence/schema.ts`

- [ ] **Step 1: Extend `SectionBreakdownEntry` and `AttemptResponseRow`**

In `app/lib/persistence/queries.ts`:

```ts
export interface SectionBreakdownEntry {
  name: string;
  sectionKey: 'rw' | 'math';
  correct: number;
  total: number;
  scaled: number;
  module2Path?: 'easier' | 'harder' | null;  // NEW: null/omitted for short
}
```

Add `module_index: number | null` to `AttemptResponseRow` (wherever it's defined — locate the type that lists `chosen_index`, `entered_value`, etc.). Update `RESPONSE_COLUMNS` to include `module_index`.

- [ ] **Step 2: Extend `AttemptPayload` types**

In `app/lib/persistence/payload.ts`:

```ts
export interface AttemptResponsePayload {
  // ... existing fields ...
  moduleIndex: number | null;   // NEW: null for short-test responses
}

export interface AttemptPayload {
  // ... existing fields ...
  sectionBreakdown: {
    name: string;
    sectionKey: SectionKey;
    correct: number;
    total: number;
    module2Path?: 'easier' | 'harder' | null;   // NEW
  }[];
}
```

**Commit 1 — payload mapper does NOT yet wire these through.** In `toAttemptPayload`, set both new fields to `null` for every payload:

```ts
// Inside the response push: append moduleIndex: null
{ /* ...existing fields..., */ moduleIndex: null }

// Inside the sectionBreakdown map: append module2Path: null
{ name: s.name, sectionKey: s.sectionKey, correct: s.correct, total: s.total, module2Path: null }
```

This keeps type-check green AND keeps short-test scoring identical (the `null` reaches the RPC; the RPC takes the short branch).

- [ ] **Step 3: Extend zod schemas**

In `app/lib/persistence/schema.ts`:

```ts
const attemptResponseSchema = z.object({
  // ... all existing fields ...
  moduleIndex: z.number().int().min(0).max(1).nullable().optional(),
});

export const attemptPayloadSchema = z.object({
  // ...
  sectionBreakdown: z
    .array(
      z.object({
        name: z.string().min(1),
        sectionKey: z.enum(['rw', 'math']),
        correct: z.number().int().min(0),
        total: z.number().int().min(0),
        module2Path: z.enum(['easier', 'harder']).nullable().optional(),
      }),
    )
    .min(1),
  // ...
});
```

- [ ] **Step 4: Run checks**

```bash
pnpm type-check                      # clean
pnpm dlx tsx scripts/check-scoring.ts # green
pnpm dlx tsx scripts/check-payload.ts # green (still works — null modules are valid)
```

All three must pass. Don't proceed to Task 4 if any fail.

- [ ] **Step 5: Save progress**

---

### Task 4: Write the migration

**Files:**
- Create: `supabase/migrations/20260525050000_sat_adaptive_schema.sql`

- [ ] **Step 1: Write the migration**

The migration has 6 sections. Each does one thing. Comments explain each.

```sql
-- 20260525050000_sat_adaptive_schema.sql
-- Sub-project #11 — Adaptive Test Structure.

-- ---------------- 1) sat.questions.difficulty + classified_at ----------------
alter table sat.questions
  add column difficulty text not null default 'medium'
    check (difficulty in ('easy','medium','hard'));

alter table sat.questions
  add column classified_at timestamptz;  -- nullable; set by classifier workflow

create index if not exists questions_section_skill_difficulty_enabled_idx
  on sat.questions (section, skill, difficulty)
  where enabled;

-- ---------------- 2) sat.attempt_responses.module_index ----------------
alter table sat.attempt_responses
  add column module_index int;   -- 0 = Module 1, 1 = Module 2, null = short

-- ---------------- 3) sat.app_config.module2_threshold_pct ----------------
alter table sat.app_config
  add column module2_threshold_pct int not null default 60
    check (module2_threshold_pct between 0 and 100);

-- ---------------- 4) sat.draw_questions rewrite (drop + recreate) ----------------
--
-- Adds p_skill + p_difficulty filters. PRESERVES the existing behaviour
-- from 20260521070000_sat_questions_enabled.sql in full:
--   • Fresh-pool draw (unserved questions for this user)
--   • Recycle path (least-recently-served if fresh pool insufficient)
--   • INSERT INTO sat.served_questions to track what was served
--   • Returns the actual rows
-- The new filters apply to both the fresh and recycle queries.

drop function if exists sat.draw_questions(text, int);
drop function if exists sat.draw_questions(text, text, int);
drop function if exists sat.draw_questions(text, text, text, int);

create or replace function sat.draw_questions(
  p_section    text,
  p_skill      text default null,
  p_difficulty text default null,
  p_count      int  default 1
) returns setof sat.questions
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

  -- Fresh: unserved questions matching the (section, skill?, difficulty?) filters.
  select coalesce(array_agg(id), array[]::text[]) into v_ids from (
    select q.id from sat.questions q
    where q.section = p_section
      and q.enabled
      and (p_skill is null or q.skill = p_skill)
      and (p_difficulty is null or q.difficulty = p_difficulty)
      and not exists (
        select 1 from sat.served_questions s
        where s.user_id = v_user and s.question_id = q.id)
    order by random()
    limit v_count
  ) fresh;

  -- Recycle: least-recently-served matching questions if fresh pool was thin.
  -- Same filter set so the recycle stays within the requested cell.
  if coalesce(array_length(v_ids, 1), 0) < v_count then
    select v_ids || coalesce(array_agg(id), array[]::text[]) into v_ids from (
      select q.id
      from sat.questions q
      join sat.served_questions s
        on s.question_id = q.id and s.user_id = v_user
      where q.section = p_section
        and q.enabled
        and (p_skill is null or q.skill = p_skill)
        and (p_difficulty is null or q.difficulty = p_difficulty)
        and not (q.id = any(v_ids))
      order by s.served_at asc
      limit v_count - coalesce(array_length(v_ids, 1), 0)
    ) recycled;
  end if;

  -- Track served (upsert served_at = now).
  insert into sat.served_questions (user_id, question_id, served_at)
  select v_user, unnest(v_ids), now()
  on conflict (user_id, question_id) do update set served_at = excluded.served_at;

  return query select * from sat.questions q where q.id = any(v_ids);
end;
$$;

grant execute on function sat.draw_questions(text, text, text, int)
  to authenticated, service_role;

-- ---------------- 5) sat.scale_section recreation ----------------
--
-- Adds p_module2_path. Short branch: identical to the #10 body, copied
-- verbatim from supabase/migrations/20260525040000_sat_real_scoring.sql
-- lines 26-72 (the entire begin..end block of the original function).
-- Full branch: dispatch on (section, path) → one of four new array literals.
-- Rejects (full, null) with an exception.

create or replace function sat.scale_section(
  p_section text,
  p_correct integer,
  p_total integer,
  p_test_length text,
  p_module2_path text default null
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
  if p_test_length = 'short' then
    -- Verbatim copy of the #10 short-test scoring body.
    if p_section = 'rw' then
      v_curve := array[
        200, 200, 220, 250, 290, 330, 360, 390, 410, 430,
        450, 470, 490, 510, 530, 550, 570, 590, 610, 630,
        660, 680, 700, 720, 740, 760, 780, 800
      ];
    elsif p_section = 'math' then
      v_curve := array[
        200, 210, 250, 290, 330, 370, 420, 460, 500, 530,
        550, 570, 590, 610, 630, 650, 680, 700, 720, 740,
        760, 780, 800
      ];
    else
      raise exception 'sat.scale_section: unknown section %', p_section;
    end if;

    v_full_count := array_length(v_curve, 1) - 1;
    -- floor(x+0.5) matches JS Math.round for non-negative inputs.
    v_raw := floor((p_correct::numeric / nullif(p_total, 0) * v_full_count) + 0.5);
    v_raw := greatest(0, least(v_full_count, coalesce(v_raw, 0)));
    return v_curve[v_raw + 1];

  elsif p_test_length = 'full' then
    if p_module2_path is null then
      raise exception 'sat.scale_section: full-test scoring requires p_module2_path (got NULL)';
    end if;

    if p_section = 'rw' and p_module2_path = 'easier' then
      v_curve := array[
        200, 200, 200, 210, 220, 230, 240, 260, 280, 300,
        320, 340, 360, 370, 380, 390, 400, 410, 420, 430,
        440, 450, 460, 470, 480, 490, 500, 510, 510, 520,
        520, 530, 530, 540, 540, 550, 550, 560, 560, 570,
        570, 580, 580, 580, 580, 590, 590, 590, 590, 600,
        600, 600, 600, 600, 600
      ];
    elsif p_section = 'rw' and p_module2_path = 'harder' then
      v_curve := array[
        430, 430, 440, 450, 460, 470, 480, 490, 500, 510,
        520, 530, 540, 550, 560, 570, 580, 590, 600, 610,
        620, 630, 640, 650, 660, 670, 680, 690, 700, 705,
        710, 715, 720, 725, 730, 735, 740, 745, 750, 755,
        760, 765, 770, 775, 780, 785, 790, 793, 795, 797,
        798, 799, 800, 800, 800
      ];
    elsif p_section = 'math' and p_module2_path = 'easier' then
      v_curve := array[
        200, 200, 210, 220, 240, 260, 280, 300, 320, 340,
        360, 380, 400, 410, 420, 430, 440, 450, 460, 470,
        480, 490, 500, 510, 520, 530, 540, 545, 550, 555,
        560, 565, 570, 575, 580, 585, 585, 590, 590, 595,
        595, 600, 600, 600, 600
      ];
    elsif p_section = 'math' and p_module2_path = 'harder' then
      v_curve := array[
        430, 440, 450, 460, 470, 480, 490, 500, 510, 520,
        530, 540, 550, 560, 570, 580, 590, 600, 610, 620,
        630, 640, 650, 660, 670, 680, 690, 700, 710, 720,
        725, 730, 735, 740, 745, 750, 755, 760, 765, 770,
        775, 780, 790, 795, 800
      ];
    else
      raise exception 'sat.scale_section: unknown (section,path) (%, %)',
        p_section, p_module2_path;
    end if;

    v_raw := greatest(0, least(array_length(v_curve, 1) - 1, p_correct));
    return v_curve[v_raw + 1];

  else
    raise exception 'sat.scale_section: unknown p_test_length (%)', p_test_length;
  end if;
end;
$$;

grant execute on function sat.scale_section(text, integer, integer, text, text)
  to authenticated, service_role;

-- ---------------- 6) sat.save_attempt recreation ----------------
--
-- Diff from the #10 version:
--   • section_breakdown adds module2Path per entry; scale_section call
--     gains the 5th arg.
--   • attempt_responses INSERT adds module_index from the payload.

create or replace function sat.save_attempt(p_attempt jsonb, p_responses jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_id   uuid;
  v_today_count int;
  v_daily_limit int;
  v_test_length text;
  v_breakdown    jsonb;
  v_scaled_score int;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;
  if jsonb_array_length(p_responses) = 0 then
    raise exception 'no responses';
  end if;

  select daily_attempt_limit into v_daily_limit from sat.app_config limit 1;
  if v_daily_limit is null then v_daily_limit := 5; end if;
  select count(*) into v_today_count
  from sat.test_attempts
  where user_id = v_user
    and created_at >= date_trunc('day', now() at time zone 'UTC');
  if v_today_count >= v_daily_limit then
    raise exception 'daily attempt limit reached';
  end if;

  v_test_length := p_attempt ->> 'testLength';

  v_breakdown := (
    select jsonb_agg(
      jsonb_build_object(
        'name',         e ->> 'name',
        'sectionKey',   e ->> 'sectionKey',
        'correct',      (e ->> 'correct')::int,
        'total',        (e ->> 'total')::int,
        'module2Path',  e ->> 'module2Path',
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

  v_scaled_score := (
    select coalesce(sum((e ->> 'scaled')::int), 0)
    from jsonb_array_elements(v_breakdown) e
  );

  insert into sat.test_attempts (
    user_id, student_name, test_length,
    total_correct, total_questions, scaled_score, section_breakdown
  ) values (
    v_user,
    p_attempt ->> 'studentName',
    v_test_length,
    (p_attempt ->> 'totalCorrect')::int,
    (p_attempt ->> 'totalQuestions')::int,
    v_scaled_score,
    v_breakdown
  )
  returning id into v_id;

  insert into sat.attempt_responses (
    attempt_id, user_id, section_key, section_name, position,
    question_id, skill, source, passage, prompt, choices,
    answer_index, explanation, chosen_index, is_correct,
    response_format, entered_value, correct_answer, answer_tolerance,
    module_index
  )
  select
    v_id, v_user,
    r ->> 'sectionKey',
    r ->> 'sectionName',
    (r ->> 'position')::int,
    r ->> 'questionId',
    r ->> 'skill',
    r ->> 'source',
    r ->> 'passage',
    r ->> 'prompt',
    r -> 'choices',
    (r ->> 'answerIndex')::int,
    r ->> 'explanation',
    nullif(r ->> 'chosenIndex', '')::int,
    case
      when coalesce(r ->> 'responseFormat', 'mcq') = 'spr' then
        sat.spr_is_correct(r ->> 'enteredValue', q.correct_answer, q.answer_tolerance)
      else
        (r ->> 'isCorrect')::boolean
    end,
    coalesce(r ->> 'responseFormat', 'mcq'),
    r ->> 'enteredValue',
    q.correct_answer,
    q.answer_tolerance,
    nullif(r ->> 'moduleIndex', '')::int
  from jsonb_array_elements(p_responses) as r
  left join sat.questions q on q.id = r ->> 'questionId';

  return v_id;
end;
$$;

grant execute on function sat.save_attempt(jsonb, jsonb) to authenticated;
```

- [ ] **Step 2: Save progress** (do not apply yet)

---

### Task 5: Apply migration + verify SQL parity (controller)

This task is for the controller (the orchestrator), not a subagent. Steps below are what the controller does.

- [ ] **Step 1: Pre-migration check** — confirm no positional draw_questions callers + no past full-test attempts

```sql
-- via Supabase MCP execute_sql, project falgykkspbtrwdcchayi
select count(*) as full_attempts from sat.test_attempts where test_length = 'full';
-- Expected: 0 (or very small; the user verifies pre-#11 there were no real full tests).
```

- [ ] **Step 2: Apply migration via Supabase MCP `apply_migration`**

Use the migration file content from Task 4. Project `falgykkspbtrwdcchayi`, name `sat_adaptive_schema`.

- [ ] **Step 3: Verify the schema deltas**

```sql
-- 320 rows now have difficulty='medium' as default; none have classified_at.
select count(*) as rows,
       count(*) filter (where difficulty = 'medium') as medium_count,
       count(*) filter (where classified_at is null) as unclassified
from sat.questions;

-- app_config has the new column.
select daily_attempt_limit, module2_threshold_pct from sat.app_config;

-- attempt_responses gained module_index (nullable).
select column_name, is_nullable
from information_schema.columns
where table_schema = 'sat' and table_name = 'attempt_responses'
  and column_name = 'module_index';
```

- [ ] **Step 4: Verify the scoring function parity**

```sql
-- Short tests still work identically (sub-project #10 invariant).
select sat.scale_section('rw', 14, 27, 'short', null) as rw_mid_short;     -- 530
select sat.scale_section('rw', 5, 10, 'short', null)  as rw_locked_half;   -- 530

-- Full tests use the new curves.
select sat.scale_section('rw',   0,  54, 'full', 'easier') as rw_e_floor,   -- 200
       sat.scale_section('rw',   54, 54, 'full', 'easier') as rw_e_ceil,    -- 600
       sat.scale_section('rw',   0,  54, 'full', 'harder') as rw_h_floor,   -- 430
       sat.scale_section('rw',   54, 54, 'full', 'harder') as rw_h_ceil,    -- 800
       sat.scale_section('math', 0,  44, 'full', 'easier') as math_e_floor, -- 200
       sat.scale_section('math', 44, 44, 'full', 'easier') as math_e_ceil,  -- 600
       sat.scale_section('math', 0,  44, 'full', 'harder') as math_h_floor, -- 430
       sat.scale_section('math', 44, 44, 'full', 'harder') as math_h_ceil;  -- 800

-- Reject (full, null).
select sat.scale_section('rw', 27, 54, 'full', null);
-- Expected: ERROR 'full-test scoring requires p_module2_path (got NULL)'
```

- [ ] **Step 5: Confirm no past full attempts mis-scored**

```sql
-- Any previous full attempts retain their old #10 scaled_score (no rescore).
-- The migration does not touch sat.test_attempts data.
select count(*), avg(scaled_score)
from sat.test_attempts
where test_length = 'full';
```

---

### Task 6: Commit 1

**Files in this commit:**
- `supabase/migrations/20260525050000_sat_adaptive_schema.sql` (new)
- `app/lib/scoring.ts` (modified)
- `app/lib/persistence/queries.ts` (modified)
- `app/lib/persistence/payload.ts` (modified)
- `app/lib/persistence/schema.ts` (modified)
- `scripts/check-scoring.ts` (modified)

**Files NOT in this commit:** any UI, any test runner, AI generator, n8n workflows, docs.

- [ ] **Step 1: Final pre-commit checks**

```bash
pnpm type-check                      # clean
pnpm dlx tsx scripts/check-scoring.ts # green
pnpm dlx tsx scripts/check-payload.ts # green
pnpm lint                            # clean
```

- [ ] **Step 2: Stage + commit**

```bash
git add supabase/migrations/20260525050000_sat_adaptive_schema.sql \
        app/lib/scoring.ts \
        app/lib/persistence/queries.ts \
        app/lib/persistence/payload.ts \
        app/lib/persistence/schema.ts \
        scripts/check-scoring.ts
```

Use the PowerShell BOM-less here-string commit-message pattern with this body:

```
feat(adaptive): schema + 4 adaptive curves + scale_section extension

Sub-project #11 commit 1 - data layer for adaptive test delivery:
- sat.questions gains difficulty (default 'medium') + classified_at
- sat.attempt_responses gains module_index
- sat.app_config gains module2_threshold_pct (default 60)
- sat.draw_questions extended with p_skill + p_difficulty + p_count
- sat.scale_section gains p_module2_path; rejects (full, NULL)
- sat.save_attempt recreated to write module2Path + module_index
- 4 new TS curves (RW_FULL_EASIER, RW_FULL_HARDER, MATH_FULL_EASIER,
  MATH_FULL_HARDER); scoreFullSection helper
- Persistence types + zod schema accept moduleIndex / module2Path
- Payload mapper sets both to null (commit 2 wires them through)
- check-scoring.ts parity battery extended (4 new curves + locked
  quadrant rows + path-inequality assertions)
- CURVE_VERSION bumped to 'dsat-pt1-2024-09+adaptive'

Verified: type-check + lint clean; check-scoring (4 new curves) green;
check-payload green; SQL parity spot-checks for all 8 quadrant
endpoints + the (full, NULL) rejection.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Chunk 2: Commit 2 — module-based test runner

### Task 7: `SECTION_CONFIG` refactor + grep `fullCount`

**Files:**
- Modify: `app/lib/questions.ts`
- Modify: stragglers found by grep

- [ ] **Step 1: Grep for `fullCount`**

```bash
grep -rn "fullCount" app scripts 2>/dev/null
```

Expected hits (likely): `app/lib/questions.ts`, `app/lib/scoring.ts`, `scripts/check-scoring.ts`. Maybe also `app/lib/test.ts` if it computes `pool.length` (which is unrelated).

- [ ] **Step 2: Update `SECTION_CONFIG`**

```ts
export const SECTION_CONFIG = {
  rw:   { name: 'Reading & Writing', shortCount: 10, moduleSize: 27, modulesPerSection: 2, secsPerQ: 90  },
  math: { name: 'Math',              shortCount: 10, moduleSize: 22, modulesPerSection: 2, secsPerQ: 105 },
} as const;

export function fullSectionCount(s: SectionKey): number {
  const c = SECTION_CONFIG[s];
  return c.moduleSize * c.modulesPerSection;   // 54 / 44
}
```

`fullCount` is gone.

- [ ] **Step 3: Fix `scoring.ts` references**

In `scoring.ts`:
- `projectShort` line `const fullCount = SECTION_CONFIG[section].fullCount;` → `const fullCount = SECTION_CONFIG[section].moduleSize;`. (Variable name stays; the source changes.)

- [ ] **Step 4: Fix `check-scoring.ts` references**

Update assertions referencing `SECTION_CONFIG.rw.fullCount` → `SECTION_CONFIG.rw.moduleSize` (same numeric value 27 / 22).

- [ ] **Step 5: type-check; expect failures only in test.ts**

```bash
pnpm type-check
```

Remaining errors should be in `app/lib/test.ts` consumers — which Task 8 rewrites.

- [ ] **Step 6: Save progress**

---

### Task 8: `Test` / `TestSection` / `TestModule` types + `buildTest`

**Files:**
- Modify: `app/lib/test.ts`

- [ ] **Step 1: Replace interfaces**

```ts
export interface TestModule {
  index: number;            // 0 or 1
  questions: Question[];    // moduleSize entries, shuffled
  timeLimit: number;        // moduleSize × secsPerQ
}

export interface TestSection {
  key: SectionKey;
  name: string;
  modules: TestModule[];    // length 1 for short, 2 for full (Module 2 appended after routing)
  module2Path?: 'easier' | 'harder';
}

export interface Test {
  name: string;
  length: TestLength;
  sections: TestSection[];
}

export function sectionQuestions(s: TestSection): Question[] {
  return s.modules.flatMap((m) => m.questions);
}
```

`TestSection.questions` is gone.

- [ ] **Step 2: Rewrite `buildTest`**

For short tests: produce one module per section (length-1 `modules` array). For full tests: produce one module (Module 1) per section; Module 2 is appended lazily after routing.

```ts
// module1Bank is optional — when omitted, buildTest falls back to BANK
// (the offline-fallback path in useTestSession.start()'s catch branch).
// The fallback synthesizes a per-section bank by filtering+shuffling BANK.
export function buildTest(
  name: string,
  testLength: TestLength,
  module1Bank?: Record<SectionKey, Question[]>,
): Test {
  const bank = module1Bank ?? buildFallbackBank();
  const sections: TestSection[] = SECTION_ORDER.map((secKey) => {
    const cfg = SECTION_CONFIG[secKey];
    const moduleSize = testLength === 'short' ? cfg.shortCount : cfg.moduleSize;
    const questions = bank[secKey].slice(0, moduleSize).map(shuffleChoices);
    return {
      key: secKey,
      name: cfg.name,
      modules: [{ index: 0, questions, timeLimit: moduleSize * cfg.secsPerQ }],
    };
  });
  return { name: name || 'Student', length: testLength, sections };
}

// Offline-fallback bank: shuffle BANK per section. Difficulty isn't
// represented in BANK; the resulting Module 1 is whatever order falls
// out of shuffle (acceptable for the fallback — the real composition
// rule only applies when the pool draw succeeded).
function buildFallbackBank(): Record<SectionKey, Question[]> {
  return {
    rw:   shuffle(DEFAULT_BANK.filter((q) => q.section === 'rw')),
    math: shuffle(DEFAULT_BANK.filter((q) => q.section === 'math')),
  };
}

// Lazy append of Module 2 after routing.
export function appendModule2(
  test: Test,
  secIdx: number,
  drawn: Question[],
  path: 'easier' | 'harder',
): Test {
  const sec = test.sections[secIdx];
  const cfg = SECTION_CONFIG[sec.key];
  const moduleSize = cfg.moduleSize;
  const questions = drawn.slice(0, moduleSize).map(shuffleChoices);
  const m2: TestModule = { index: 1, questions, timeLimit: moduleSize * cfg.secsPerQ };
  const newSections = test.sections.map((s, i) =>
    i === secIdx ? { ...s, modules: [s.modules[0], m2], module2Path: path } : s,
  );
  return { ...test, sections: newSections };
}
```

- [ ] **Step 3: Rewrite `computeResults`**

The responses matrix is now `[section][module][question]`. For full tests, `correct` is summed across both modules; the path comes from `section.module2Path`.

```ts
import { scoreSection, projectShort, scoreComposite, scoreFullSection } from './scoring';

export function computeResults(
  test: Test,
  responses: ResponseValue[][][],  // [section][module][question]
): Results {
  let totalCorrect = 0;
  let totalQ = 0;
  const perSection = test.sections.map((sec, si) => {
    let correct = 0;
    let total = 0;
    sec.modules.forEach((mod, mi) => {
      mod.questions.forEach((q, qi) => {
        const v = responses[si]?.[mi]?.[qi];
        if (q.response_format === 'spr') {
          if (typeof v === 'string' && q.correct_answer &&
              isSprCorrect(v, q.correct_answer, q.answer_tolerance ?? null)) correct++;
        } else if (typeof v === 'number' && v === q.answerIndex) correct++;
      });
      total += mod.questions.length;
    });
    totalCorrect += correct;
    totalQ += total;

    if (test.length === 'short') {
      const p = projectShort(sec.key, correct, total);
      return { name: sec.name, sectionKey: sec.key, correct, total, scaled: p.scaled, projectedRaw: p.projectedRaw };
    }
    // Full test: must have a path (set by appendModule2). Type-system
    // doesn't enforce it; we throw if it's missing because the score
    // would be undefined.
    if (!sec.module2Path) {
      throw new Error(`computeResults: full-test section ${sec.key} missing module2Path`);
    }
    return {
      name: sec.name,
      sectionKey: sec.key,
      correct,
      total,
      scaled: scoreFullSection(sec.key, correct, sec.module2Path),
      module2Path: sec.module2Path,
    };
  });
  const pct = totalQ ? totalCorrect / totalQ : 0;
  const scaled = scoreComposite(
    perSection[0]?.scaled ?? 200,
    perSection[1]?.scaled ?? 200,
  );
  return { perSection, pct, scaled };
}
```

Update `Results.perSection[]` type to include `module2Path?: 'easier' | 'harder'`.

- [ ] **Step 4: Save progress**

---

### Task 9: `pool.ts` — `drawShortTest`, `drawFullTest`, `drawModule2`, `fillSlot`

**Files:**
- Modify: `app/lib/pool.ts`

- [ ] **Step 1: Rename + add new exports**

Existing `drawTestQuestions(testLength: TestLength)` → split:

```ts
// Short-test draw is unchanged behaviour: one pool call per section.
export async function drawShortTest(): Promise<Record<SectionKey, Question[]>> {
  // ... existing logic, but return per-section bank ...
}

// Full test Module 1: section-composed (9 easy + 9 medium + 9 hard for R&W;
// 8/7/7 for Math). Returns per-section banks.
export async function drawFullTestModule1(): Promise<Record<SectionKey, Question[]>> {
  const result: Record<SectionKey, Question[]> = { rw: [], math: [] };
  for (const sec of SECTION_ORDER) {
    const drawn = new Set<string>();
    const slots = MODULE1_COMPOSITION[sec];  // see constant below
    const collected: Question[] = [];
    for (const slot of slots) {
      const qs = await fillSlot(sec, slot.difficulty, slot.count, drawn);
      qs.forEach((q) => drawn.add(q.id));
      collected.push(...qs);
    }
    result[sec] = collected;
  }
  return result;
}

// Module 2: drawn lazily after Module 1 submission with the chosen path.
export async function drawModule2(
  section: SectionKey,
  path: 'easier' | 'harder',
): Promise<Question[]> {
  const drawn = new Set<string>();
  const primaryDifficulty = path === 'easier' ? 'easy' : 'hard';
  const cfg = SECTION_CONFIG[section];
  const moduleSize = cfg.moduleSize;
  const primaryCount = Math.round(moduleSize * 0.7);  // 19 (R&W), 15 (Math)
  const mediumCount = moduleSize - primaryCount;       // 8 (R&W), 7 (Math)
  const primary = await fillSlot(section, primaryDifficulty, primaryCount, drawn);
  primary.forEach((q) => drawn.add(q.id));
  const medium = await fillSlot(section, 'medium', mediumCount, drawn);
  return [...primary, ...medium];
}

// 3-tier fallback: primary difficulty → medium → any-difficulty.
// Invariant: returns exactly `count` questions (or fewer only on cold start).
async function fillSlot(
  section: SectionKey,
  primary: 'easy' | 'medium' | 'hard',
  count: number,
  alreadyDrawn: Set<string>,
): Promise<Question[]> {
  // Tier 1
  const t1 = await rpcDraw(section, primary, count);
  if (t1.length >= count) return t1.slice(0, count);
  // Tier 2: medium backfill (unless primary === 'medium')
  const need2 = count - t1.length;
  const t2 = primary === 'medium' ? [] : await rpcDraw(section, 'medium', need2);
  const combined = [...t1, ...t2].filter((q) => !alreadyDrawn.has(q.id));
  if (combined.length >= count) return combined.slice(0, count);
  // Tier 3: any difficulty
  const need3 = count - combined.length;
  const t3 = await rpcDraw(section, null, need3);
  return [...combined, ...t3.filter((q) => !alreadyDrawn.has(q.id))].slice(0, count);
}

async function rpcDraw(
  section: SectionKey,
  difficulty: 'easy' | 'medium' | 'hard' | null,
  count: number,
): Promise<Question[]> {
  const supabase = createBrowserClient();  // existing helper
  const { data, error } = await supabase.schema('sat').rpc('draw_questions', {
    p_section: section,
    p_skill: null,
    p_difficulty: difficulty,
    p_count: count,
  });
  if (error) throw error;
  return (data ?? []).map(rowToQuestion);
}

// Composition table — Module 1 fixed mix.
const MODULE1_COMPOSITION: Record<SectionKey, { difficulty: 'easy' | 'medium' | 'hard'; count: number }[]> = {
  rw:   [{ difficulty: 'easy', count: 9 }, { difficulty: 'medium', count: 9 }, { difficulty: 'hard', count: 9 }],
  math: [{ difficulty: 'easy', count: 8 }, { difficulty: 'medium', count: 7 }, { difficulty: 'hard', count: 7 }],
};
```

- [ ] **Step 2: Type-check**

- [ ] **Step 3: Save progress**

---

### Task 10: `useTestSession.ts` — module FSM + per-module timer

**Files:**
- Modify: `app/hooks/useTestSession.ts`
- Modify: `app/lib/config.ts` (add `getModule2ThresholdPct`)

- [ ] **Step 1: Add `getModule2ThresholdPct` to `config.ts`**

```ts
export async function getModule2ThresholdPct(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .from('app_config')
    .select('module2_threshold_pct')
    .single();
  if (error || !data) return 60;  // safe default
  return data.module2_threshold_pct;
}
```

- [ ] **Step 2: Rewrite state + transitions in `useTestSession.ts`**

State changes:
- `modIdx: number` (0 = Module 1, 1 = Module 2)
- `responses: ResponseValue[][][]` (3-D: section × module × question)
- `remaining: number[][]` (2-D: section × module timer)

New action: `submitModule()` replaces `submitSection()`. Module 1 submit triggers routing + lazy Module 2 draw + appendModule2 to test state. Module 2 submit (or short-test single-module submit) advances section or finishes.

```ts
const submitModule = async () => {
  if (!test) return;
  if (test.length === 'short') {
    // Short tests have one module per section; behave like the old submitSection.
    return advanceSectionOrFinish();
  }
  const sec = test.sections[secIdx];
  if (modIdx === 0) {
    const correct = countCorrectInModule(sec.modules[0], responses[secIdx][0]);
    const threshold = await getModule2ThresholdPct();
    const moduleSize = SECTION_CONFIG[sec.key].moduleSize;
    // `>= ceil(moduleSize * threshold/100)` is the Harder path; `<` is Easier.
    const cutoff = Math.ceil(moduleSize * threshold / 100);
    const path: 'easier' | 'harder' = correct >= cutoff ? 'harder' : 'easier';
    setLoading(true);
    try {
      const drawn = await drawModule2(sec.key, path);
      setTest((t) => appendModule2(t!, secIdx, drawn, path));
      setResponses((r) => withModule2ResponseSlots(r, secIdx, drawn.length));
      setRemaining((rem) => withModule2Timer(rem, secIdx, drawn.length * SECTION_CONFIG[sec.key].secsPerQ));
      setModIdx(1);
      setQIdx(0);
    } finally {
      setLoading(false);
    }
    return;
  }
  // Module 2 done.
  advanceSectionOrFinish();
};
```

Helpers `withModule2ResponseSlots` / `withModule2Timer` are local pure functions that extend the matrices.

Per-module timer: the existing setInterval reads `remaining[secIdx][modIdx]` and writes back; time-up calls `submitModule()`.

- [ ] **Step 3: Update `start()` to use the new draw helpers**

```ts
const drawn = testLength === 'short'
  ? await drawShortTest()
  : await drawFullTestModule1();
const t = buildTest(trimmed, testLength, drawn);
setResponses(t.sections.map((s) => s.modules.map((m) => new Array(m.questions.length).fill(null))));
setRemaining(t.sections.map((s) => s.modules.map((m) => m.timeLimit)));
```

- [ ] **Step 4: Save progress**

---

### Task 11: Update payload mapper + check-payload

**Files:**
- Modify: `app/lib/persistence/payload.ts`
- Modify: `scripts/check-payload.ts`

- [ ] **Step 1: Payload mapper — wire the new fields**

```ts
// Inside toAttemptPayload:
const attemptResponses: AttemptResponsePayload[] = [];
for (let si = 0; si < test.sections.length; si++) {
  const section = test.sections[si];
  let absolutePos = 0;
  for (let mi = 0; mi < section.modules.length; mi++) {
    const mod = section.modules[mi];
    for (let qi = 0; qi < mod.questions.length; qi++) {
      const q = mod.questions[qi];
      const v = responses[si]?.[mi]?.[qi] ?? null;
      // ... existing per-question payload build ...
      attemptResponses.push({
        sectionKey: section.key,
        // ... existing fields ...
        position: absolutePos,
        moduleIndex: test.length === 'short' ? null : mi,
        // ...
      });
      absolutePos++;
    }
  }
}

// Section breakdown — pull module2Path from results.perSection (computeResults sets it).
return {
  // ...
  sectionBreakdown: results.perSection.map((s) => ({
    name: s.name,
    sectionKey: s.sectionKey,
    correct: s.correct,
    total: s.total,
    module2Path: s.module2Path ?? null,
  })),
  // ...
};
```

- [ ] **Step 2: Update `check-payload.ts`**

The synthesis at the top of the script needs the 3-D responses matrix:

```ts
const responses: ResponseValue[][][] = test.sections.map((sec) =>
  sec.modules.map((mod) => mod.questions.map((q, qi) => {
    // existing logic, mirror to module-aware position
  })),
);
```

Plus a new assertion:
```ts
for (const r of payload.responses) {
  if (payload.testLength === 'short') {
    assert(r.moduleIndex === null, `moduleIndex null on short response`);
  } else {
    assert(r.moduleIndex === 0 || r.moduleIndex === 1, `moduleIndex 0|1 on full response`);
  }
}
```

For short tests the section breakdown's `module2Path` should be null:
```ts
for (const entry of payload.sectionBreakdown) {
  if (payload.testLength === 'short') {
    assert(entry.module2Path === null || entry.module2Path === undefined,
      'sectionBreakdown.module2Path null/absent for short tests');
  }
}
```

- [ ] **Step 3: Run check-payload + type-check**

```bash
pnpm type-check                       # clean
pnpm dlx tsx scripts/check-payload.ts # green
pnpm dlx tsx scripts/check-scoring.ts # green
pnpm lint                             # clean
```

All four must pass.

- [ ] **Step 4: Save progress**

---

### Task 12: Update legacy consumers (QuestionNavigator, ResultsScreen, TestScreen, SatPractice)

**Files:**
- Modify: `app/components/QuestionNavigator.tsx`
- Modify: `app/components/ResultsScreen.tsx`
- Modify: `app/components/TestScreen.tsx` (references `section.questions[qIdx]` line 31, `section.questions.length` lines 47 + 81)
- Modify: `app/components/SatPractice.tsx` (references `section.questions.length` line 53)
- (Other files surfaced by type-check)

- [ ] **Step 1: Run type-check; list remaining errors**

```bash
pnpm type-check
```

Each error is likely a `section.questions.map(...)` or `section.questions.length` reference. Replace with:
- `sectionQuestions(section)` for a flat list
- `section.modules.flatMap((m) => m.questions)` inline
- `section.modules.reduce((n, m) => n + m.questions.length, 0)` for counts

- [ ] **Step 2: Fix each**

For UI components that need per-module separation (the Navigator after this commit), add a basic "Module 1" / "Module 2" subgroup. Light styling — commit 5 polishes it further.

- [ ] **Step 3: type-check clean**

```bash
pnpm type-check
```

Must be clean before committing.

---

### Task 13: Commit 2

**Files in this commit:**
- `app/lib/questions.ts` (SECTION_CONFIG refactor)
- `app/lib/test.ts` (Test shape + buildTest + computeResults + buildFallbackBank)
- `app/lib/pool.ts` (drawShortTest / drawFullTestModule1 / drawModule2 / fillSlot)
- `app/hooks/useTestSession.ts` (module FSM)
- `app/lib/config.ts` (getModule2ThresholdPct)
- `app/lib/persistence/payload.ts` (mapper wires the new fields)
- `app/lib/scoring.ts` (fullCount → moduleSize reference)
- `scripts/check-scoring.ts` (fullCount → moduleSize, including the
  `midRw = SECTION_CONFIG.rw.fullCount / 2` references at lines 65-66)
- `scripts/check-payload.ts` (3-D responses + new asserts)
- `app/components/QuestionNavigator.tsx`
- `app/components/ResultsScreen.tsx`
- `app/components/TestScreen.tsx` (section.questions consumer)
- `app/components/SatPractice.tsx` (section.questions consumer)
- (Any other type-check stragglers — Task 12 Step 1 surfaces these)

- [ ] **Step 1: Pre-commit gates**

```bash
pnpm type-check                       # clean
pnpm dlx tsx scripts/check-scoring.ts # green
pnpm dlx tsx scripts/check-payload.ts # green
pnpm lint                             # clean
```

- [ ] **Step 2: Stage + commit (PowerShell BOM-less message pattern)**

Message body:
```
feat(adaptive): module-based test runner

Sub-project #11 commit 2 - test runner becomes module-aware:
- SECTION_CONFIG refactor (moduleSize + modulesPerSection, dropped
  fullCount); fullSectionCount helper
- Test / TestSection / TestModule shape; sectionQuestions helper
- buildTest produces Module 1 only; appendModule2 lazy-extends
  after routing
- computeResults branches on test.length: short → projectShort/
  scoreSection (unchanged), full → scoreFullSection with the
  section's module2Path
- pool.ts: drawShortTest / drawFullTestModule1 / drawModule2 /
  fillSlot (3-tier difficulty fallback preserving the moduleSize
  invariant)
- useTestSession: 3-D responses matrix, 2-D timer matrix, modIdx
  state, submitModule with routing-on-Module-1-submit
- config.ts: getModule2ThresholdPct
- payload mapper wires moduleIndex (per response) + module2Path
  (per section breakdown)
- check-payload assertions extended

Verified: type-check + lint clean; check-scoring + check-payload
green.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Chunk 3: Commit 3 — AI generator emits difficulty

### Task 14: Ollama prompt + zod schema

**Files:**
- Modify: `app/lib/ai/schema.ts`
- Modify: `app/lib/ai/ollama.ts`

- [ ] **Step 1: zod requires `difficulty`**

```ts
// In both MCQ and SPR variants of generatedQuestionSchema:
difficulty: z.enum(['easy', 'medium', 'hard']),
```

The `GeneratedQuestion` type now requires the field.

- [ ] **Step 2: Update Ollama prompt(s)**

In `app/lib/ai/ollama.ts`, append to the existing instruction block in both `generateMcqBatch` and `generateSprBatch` prompts:

```
Also include a "difficulty" field, one of "easy", "medium", or "hard":
- "easy": a single computational or recall step; one common skill.
- "medium": two steps or a less common skill.
- "hard": multi-step reasoning, careful reading, or nuanced inference.
```

Update the example JSON in each prompt to include `"difficulty": "medium"` (or appropriate).

- [ ] **Step 3: Update `generate.ts`**

```ts
// In runGeneration, when inserting the row:
{
  // ... existing fields ...
  difficulty: q.difficulty,
  classified_at: new Date().toISOString(),  // generator-tagged at insert time
}
```

The thinnest-first picker becomes per-`(section, skill, difficulty)`. The `SKILL_FLOOR` (3) now applies per cell.

```ts
const depth = new Map<string, number>();
for (const q of enabled) {
  const key = `${q.section}|${q.skill}|${q.difficulty}`;
  depth.set(key, (depth.get(key) ?? 0) + 1);
}
const belowFloor = (['rw', 'math'] as const).some((section) =>
  SKILLS[section].some((skill) =>
    (['easy', 'medium', 'hard'] as const).some((diff) =>
      (depth.get(`${section}|${skill}|${diff}`) ?? 0) < SKILL_FLOOR,
    ),
  ),
);
```

Targets are now `(section, skill, difficulty)` triples, and the picker requests the missing difficulty:

```ts
const target = thinnest;  // { section, skill, difficulty, have }
const candidates = await provider.generateQuestions(
  target.section, target.skill, PER_SKILL_BATCH, /*useSpr*/ false,
  target.difficulty,  // NEW: pass the target difficulty into the prompt
);
```

Add a `targetDifficulty` parameter to `provider.generateQuestions`.

- [ ] **Step 4: type-check + check-scoring + check-payload**

All three must pass.

- [ ] **Step 5: Save progress**

---

### Task 15: n8n generator workflow update

**Files (external):**
- n8n workflow `jDjJIthvf6EyKwgR` (SAT Question Generator)

- [ ] **Step 0: Follow the standard n8n MCP discovery flow**

Before writing code, the subagent:
1. Calls `mcp__abi-n8n__get_sdk_reference` to read the SDK patterns.
2. Calls `mcp__abi-n8n__get_workflow_details` with `jDjJIthvf6EyKwgR` to read the current Plan Batches / Parse Candidates / Insert Question node code.
3. Calls `mcp__abi-n8n__search_nodes` for any new node types needed (likely none — the existing workflow already has all required nodes).
4. Calls `mcp__abi-n8n__get_node_types` for those nodes' exact parameters.
5. Writes the updated workflow code.
6. Calls `mcp__abi-n8n__validate_workflow` to confirm.
7. Calls `mcp__abi-n8n__update_workflow` to save.

- [ ] **Step 1: Update Plan Batches node**

Add a `targetDifficulty` selection (matching the JS picker logic) and pass it to the prompt. Plan Batches becomes:

```js
// Pseudo:
const depth = countByCell(questions, ['section', 'skill', 'difficulty']);
const thinnest = pickThinnestTriple(depth, SKILLS);
const prompt = buildPromptFor(thinnest.section, thinnest.skill, thinnest.difficulty);
// difficulty appears in the prompt instructions AND in the example JSON
```

- [ ] **Step 2: Update Parse Candidates node**

Add `difficulty` to the zod-like validation (n8n's JS version). Reject candidates missing `difficulty` or with values outside the 3-tier set.

- [ ] **Step 3: Update Insert Question node**

Insert payload includes `difficulty` and `classified_at: <now>`.

- [ ] **Step 4: Validate workflow**

Use `mcp__abi-n8n__validate_workflow` to confirm structure. Save via `update_workflow`. **Note**: secrets are reset to placeholders on every update; the controller reminds the user to re-paste.

---

### Task 16: Commit 3

**Files in this commit:**
- `app/lib/ai/schema.ts`
- `app/lib/ai/ollama.ts`
- `app/lib/ai/provider.ts`
- `app/lib/ai/generate.ts`

The n8n workflow change is external — not in git. The plan calls it out so the controller validates + updates the workflow as part of this task.

- [ ] **Step 1: Pre-commit gates**

```bash
pnpm type-check; pnpm dlx tsx scripts/check-scoring.ts; pnpm dlx tsx scripts/check-payload.ts; pnpm lint
```

- [ ] **Step 2: Stage + commit**

Message:
```
feat(ai): generator emits difficulty + thinnest-first per-difficulty

Sub-project #11 commit 3 - the AI question generator (Ollama + n8n)
now tags each generated question with difficulty:
- generatedQuestionSchema requires difficulty: 'easy'|'medium'|'hard'
- Ollama prompts include difficulty calibration instructions
- generate.ts picks thinnest (section, skill, difficulty) triple;
  SKILL_FLOOR applies per cell
- provider.generateQuestions gains targetDifficulty argument
- Insert path stamps difficulty + classified_at

n8n workflow jDjJIthvf6EyKwgR updated in the same pass (external);
secrets reset on update_workflow per the standing pattern.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

- [ ] **Step 3: Tell the user to re-paste the n8n secrets**

(Controller responsibility; surface this after the commit lands.)

---

## Chunk 4: Commit 4 — backfill workflow + admin override

### Task 17: SAT Difficulty Classifier workflow

**External: new n8n workflow.**

- [ ] **Step 1: Build via n8n MCP**

Workflow shape:
1. **Manual Trigger**
2. **Read batch from Supabase** (HTTP node, REST API, `select * from sat.questions where classified_at is null limit 20`)
3. **SplitInBatches v3** (loop over 20 rows; output 0 done, output 1 loop)
4. **HTTP request to Ollama** with the classification prompt
5. **Code node** — parse difficulty + write back via Supabase REST
6. **HTTP request: PATCH** `sat.questions?id=eq.{id}` with `{difficulty, classified_at: now()}`

The classification prompt:
```
Classify this Digital SAT question's difficulty as exactly one of
"easy", "medium", or "hard". Output ONLY the bare word, nothing else.

- easy: a single computational or recall step; one common skill.
- medium: two steps or a less common skill.
- hard: multi-step reasoning, careful reading, or nuanced inference.

Question:
{prompt}

Choices:
{choices}
```

Use `mcp__abi-n8n__create_workflow_from_code`. Name: `SAT Difficulty Classifier`.

- [ ] **Step 2: Document the workflow ID + run instructions**

After creation, note the workflow URL/ID. The user runs it once after commit 6 lands.

---

### Task 18: Admin difficulty override

**Files:**
- Modify: `app/lib/admin/actions.ts`
- Modify: `app/(app)/admin/questions/[id]/page.tsx`
- Modify: `app/(app)/admin/questions/page.tsx`

- [ ] **Step 1: Add `setQuestionDifficulty` server action**

In `app/lib/admin/actions.ts`:

```ts
'use server';
export async function setQuestionDifficulty(
  id: string,
  difficulty: 'easy' | 'medium' | 'hard',
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .schema('sat')
    .from('questions')
    .update({ difficulty })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
```

- [ ] **Step 2: Add a difficulty dropdown to the question detail page**

In `app/(app)/admin/questions/[id]/page.tsx`, add a form that POSTs to `setQuestionDifficulty`. Render as a small dropdown alongside the existing enable/disable toggle.

- [ ] **Step 3: Add a difficulty filter chip to the listing page**

In `app/(app)/admin/questions/page.tsx`, add a difficulty filter alongside the existing section/status filters. Pass `difficulty` as a search param; filter rows in `listQuestions(...)`.

- [ ] **Step 4: type-check + lint**

---

### Task 19: Commit 4

**Files in this commit:**
- `app/lib/admin/actions.ts`
- `app/(app)/admin/questions/[id]/page.tsx`
- `app/(app)/admin/questions/page.tsx`
- `app/lib/admin/queries.ts` (if `listQuestions` signature changes to accept difficulty filter)

Message:
```
feat(admin): difficulty backfill workflow + admin override

Sub-project #11 commit 4 - admin tools for the new difficulty tier:
- New n8n workflow "SAT Difficulty Classifier" (external) — runs
  LLM classification across all sat.questions rows with
  classified_at IS NULL; idempotent
- setQuestionDifficulty server action (requireAdmin + service-role)
- /admin/questions/[id] gets a difficulty dropdown
- /admin/questions gets a difficulty filter chip

The classifier workflow runs manually; user triggers it after this
commit lands to populate the existing 320 rows.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Chunk 5: Commit 5 — UI (module indicator + path badge)

### Task 20: TestScreen module indicator

**Files:**
- Modify: `app/components/TestScreen.tsx`
- Maybe: `app/components/QuestionNavigator.tsx` for further polish

- [ ] **Step 1: Header gets Module-X-of-Y indicator + path badge**

In TestScreen, after the section name, render:
```
Reading & Writing  ·  Module 1 of 2          [timer]
Reading & Writing  ·  Module 2 of 2  ·  Adaptive: Harder   [timer]
```

Reads `test.sections[secIdx].modules.length` for the "of N" and `modIdx` for "of Y". When `modIdx === 1 && sec.module2Path`, render the path badge (muted slate).

- [ ] **Step 2: For short tests, show no module label**

`if (test.length === 'short') return <h1>{sec.name}</h1>`. Don't confuse short-test users.

---

### Task 21: AttemptCard + ResultsScreen + attempt review page

**Files:**
- Modify: `app/components/AttemptCard.tsx`
- Modify: `app/components/ResultsScreen.tsx`
- Modify: `app/(app)/dashboard/attempts/[id]/page.tsx`

- [ ] **Step 1: AttemptCard — show path on full attempts**

In the chip list, when `s.module2Path` is set, append `(Harder)` or `(Easier)` to the chip:
```tsx
{s.sectionKey === 'rw' ? 'R&W' : 'Math'} {s.scaled}
{s.module2Path && (
  <span className="ml-1 text-slate-500">
    ({s.module2Path === 'harder' ? 'Harder' : 'Easier'})
  </span>
)}
```

The "Full" / "Short" badge already exists — leave that.

- [ ] **Step 2: ResultsScreen — caption line per section card**

Under the per-section scaled score, when `module2Path` is set, add:
```
Module 2: Harder path
```

For short tests, no caption.

- [ ] **Step 3: attempt review page header**

Same caption line in the per-section card.

- [ ] **Step 4: type-check + lint**

---

### Task 22: Commit 5

**Files:**
- `app/components/TestScreen.tsx`
- `app/components/AttemptCard.tsx`
- `app/components/ResultsScreen.tsx`
- `app/(app)/dashboard/attempts/[id]/page.tsx`
- (Any other UI files affected)

Message:
```
feat(ui): module indicator + adaptive path badges

Sub-project #11 commit 5 - UI surfaces the module + path:
- TestScreen header shows "Module 1 of 2" / "Module 2 of 2" plus
  "Adaptive: Easier" or "Adaptive: Harder" when in Module 2
- Short tests skip the module label (single-module experience)
- AttemptCard chips append (Harder)/(Easier) on full attempts
- ResultsScreen per-section cards add a "Module 2: <path> path"
  caption when set
- Attempt review page header matches the same layout

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

---

## Chunk 6: Commit 6 — docs

### Task 23: CLAUDE.md additions

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add check-scoring/check-payload lines if missing** (likely already present from #10)

- [ ] **Step 2: Add architecture entries**

```markdown
- [app/lib/scoring.ts](app/lib/scoring.ts) — also exports the four
  adaptive curves (`RW_FULL_EASIER_CURVE`, `RW_FULL_HARDER_CURVE`,
  `MATH_FULL_EASIER_CURVE`, `MATH_FULL_HARDER_CURVE`) plus
  `scoreFullSection(section, raw, path)` for full-test scoring.
- [app/lib/pool.ts](app/lib/pool.ts) — `drawShortTest`,
  `drawFullTestModule1`, `drawModule2`, `fillSlot`. The last is the
  3-tier difficulty fallback (primary → medium → any).
- [app/lib/config.ts](app/lib/config.ts) — `getModule2ThresholdPct()`
  reads `sat.app_config.module2_threshold_pct` (default 60).
```

- [ ] **Step 3: Add a "Adaptive Test Structure sub-project gotchas" section**

After the Score Validity gotchas:

```markdown
## Adaptive Test Structure sub-project gotchas

The adaptive sub-project has landed: each full-test section is delivered
as Module 1 (fixed, mixed difficulty) → Module 2 (Easier or Harder
based on Module 1 score). Short tests stay non-adaptive.

- **`sat.scale_section(p_section, p_correct, p_total, p_test_length, p_module2_path)`
  requires a non-null path for full tests** — it raises rather than
  silently mis-scoring. If you see `'full-test scoring requires
  p_module2_path (got NULL)'` in logs, the bug is upstream
  (forgotten zod field, stale payload mapper). Short tests pass null
  deliberately; full tests must always pass `'easier'` or `'harder'`.
- **Four new curves (`RW_FULL_EASIER`, `RW_FULL_HARDER`,
  `MATH_FULL_EASIER`, `MATH_FULL_HARDER`) mirror SQL `array[]` literals
  inside `sat.scale_section`'s full-test branch.** Same drift discipline
  as the short curves. The `check-scoring.ts` parity battery covers
  all six curves; the path-inequality assertion (Harder ≥ Easier at
  every raw count) guards calibration direction.
- **`SECTION_CONFIG.fullCount` is gone — use `moduleSize` (per-module
  question count) + `modulesPerSection` (currently always 2).**
  `fullSectionCount(section)` returns `moduleSize * modulesPerSection`
  (54 R&W / 44 Math). Anywhere the old `fullCount` was used got renamed
  to `moduleSize` because they were 1:1 numerically.
- **Module 2 question draw is lazy** — runs server-side after Module 1
  submit, with the path determined client-side from
  `sat.app_config.module2_threshold_pct`. The runner shows a brief
  loading state while the draw happens. If the tab closes mid-test,
  the in-progress attempt is lost (same as today).
- **The per-skill floor gate is now per-difficulty.** Each `(section,
  skill, difficulty)` cell needs ≥ 3 enabled questions before the floor
  stops firing. After backfill, the existing 320 rows are all
  `difficulty='medium'`; the easy/hard cells start at 0 and refill via
  the generator until the SAT Difficulty Classifier workflow runs.
- **Routing threshold is `sat.app_config.module2_threshold_pct` (default
  60).** Admin-configurable. The cutoff math is
  `ceil(moduleSize * threshold / 100)` — so 60% with moduleSize=27
  means 16 correct → Easier, 17 correct → Harder. Math: 13 → Easier,
  14 → Harder.
- **`fillSlot` 3-tier fallback preserves the moduleSize invariant.**
  Tier 1 = requested difficulty; Tier 2 = medium backfill; Tier 3 =
  any-difficulty. Every call returns exactly `moduleSize` questions
  (or fewer ONLY on cold start, where `BANK` fallback kicks in).
- **`sat.questions.difficulty` defaults to `'medium'`** to keep
  backward compatibility when the column was added. The SAT Difficulty
  Classifier n8n workflow re-classifies rows whose `classified_at is
  null`. Until that workflow runs, every existing row reads as medium
  → the easy/hard pool is whatever the generator has produced since
  commit 3.
```

- [ ] **Step 4: Update the existing "Scaled score is now a real..." Things-That-Bite entry**

Replace it with a tighter version that acknowledges the adaptive scoring:

```markdown
- **Scaled score is a real (per-section, per-path) curve, server-trusted.**
  Short tests use the existing #10 curves (`RW_CURVE` / `MATH_CURVE`).
  Full tests use one of four #11 curves (`RW_FULL_EASIER` /
  `RW_FULL_HARDER` / `MATH_FULL_EASIER` / `MATH_FULL_HARDER`) selected
  by `module2Path` per section. `sat.save_attempt` computes the
  composite; the client's `scaledScore` field is ignored. The
  composite is the sum of per-section scaled values (200-800 + 200-800
  = 400-1600).
```

---

### Task 24: README.md additions

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update Scoring section**

Add a paragraph about adaptive scoring:

```markdown
For **full tests**, the score depends on which Module 2 path you took.
Module 1 score determines whether you continue with the Easier or
Harder Module 2; the scaled score for that section reflects that
path. Easier-path scores cap around 600 per section; Harder-path
scores can reach 800. Short tests are non-adaptive and use the
single-module curve.
```

- [ ] **Step 2: Add an "Adaptive Test Structure" section**

After Scoring:

```markdown
## Adaptive Test Structure

Full tests deliver each section in **two modules** back-to-back —
exactly like the real Digital SAT:

- **Module 1**: a fixed mixed-difficulty set (1/3 easy + 1/3 medium +
  1/3 hard). 27 questions for R&W, 22 for Math.
- **Module 2**: drawn after Module 1 submit. Two paths:
  - **Easier** — if you got below the threshold in Module 1
  - **Harder** — if you got at or above the threshold

The routing threshold is configurable in admin settings (default
60%). The path is shown in the test UI ("Adaptive: Harder") and on
the results page. Short tests do not use modules — they're a
non-adaptive practice variant.
```

- [ ] **Step 3: Update file map**

Add entries for the new files / migrations.

---

### Task 25: Commit 6 + push

**Files:**
- `CLAUDE.md`
- `README.md`

- [ ] **Step 1: Final pre-commit gates**

```bash
pnpm type-check; pnpm dlx tsx scripts/check-scoring.ts; pnpm dlx tsx scripts/check-payload.ts; pnpm lint
```

- [ ] **Step 2: Stage + commit**

Message:
```
docs(adaptive): document the adaptive test structure sub-project

Sub-project #11 commit 6 - documentation:
- CLAUDE.md: new "Adaptive Test Structure sub-project gotchas"
  section; updated Things-That-Bite scaled-score entry to acknowledge
  the path-aware model; new architecture entries for scoring.ts /
  pool.ts / config.ts
- README.md: Scoring section adds the adaptive path explanation;
  new "Adaptive Test Structure" section; file map updates

The "near real-world SAT" roadmap is now complete:
#8 Skill Coverage / #9 Format Parity (SPR) / #10 Score Validity /
#11 Adaptive Test Structure.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
```

- [ ] **Step 3: Push**

```bash
git push origin main
```

- [ ] **Step 4: Tell the user**

- 6 commits landed.
- The SAT Difficulty Classifier n8n workflow is built but NOT run automatically. The user runs it manually once via "Execute workflow" in the n8n UI to backfill the 320 existing rows.
- The generator workflow secrets reset on update — user re-pastes.
- Vercel auto-deploys.

---

## Acceptance (matches spec)

By end of commit 6:
- `pnpm type-check`, `pnpm lint` clean.
- `scripts/check-scoring.ts`, `scripts/check-payload.ts` green.
- Migration applied; SQL parity spot-checks pass.
- New full-test attempt: Module 1 → submit → Module 2 with path → submit → composite in expected range.
- Admin question detail shows difficulty + override; pool listing filters by difficulty.
- The SAT Difficulty Classifier workflow exists in n8n and is runnable; user invokes it manually.

---

## Risk recap

| Risk | Mitigation |
|---|---|
| Curve transcription bugs | `check-scoring.ts` enforces length / endpoints / monotonicity / range / path inequality; locked-quadrant rows for each (section, path). |
| JS↔SQL drift on curves | Same discipline as #10; six curves now (2 short + 4 full); battery covers all six. |
| Type-check breakage during commit 2 | Commit 1 leaves UI broken; commit 2 fixes every consumer. type-check is green at end of each commit. |
| `(full, null)` mis-scoring | The function raises rather than fallthrough. The zod schema requires `module2Path` for full attempts (commit 1's `.nullable().optional()` covers backward-compat). |
| Question pool capacity (3× per-cell) | Generator continues 24/7; the SAT Difficulty Classifier reclassifies the 320 existing rows. Acceptance includes "user has run the classifier to completion". |
| n8n secrets reset | User re-pastes after each `update_workflow`. Controller surfaces this prominently after commit 3. |
| Lost mid-test attempts | Same as today — no mid-test state persistence. Out of scope. |

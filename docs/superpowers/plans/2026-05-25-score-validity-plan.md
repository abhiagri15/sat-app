# Score Validity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder linear scaled-score formula (`400 + pct·1200`) with a real College Board–published Digital SAT scoring curve, applied per section (200–800) and summed to a composite (400–1600). Make `sat.save_attempt` the score authority. Backfill existing attempts.

**Architecture:** Two TypeScript curve constants in `app/lib/scoring.ts` (one per section), mirrored byte-for-byte by `array[]` literals inside a `sat.scale_section` plpgsql function. `sat.save_attempt` computes the composite itself; the client's `scaledScore` field is ignored. A one-shot UPDATE in the same migration rewrites every existing row's `scaled_score` and adds `sectionKey` + `scaled` to each entry of `section_breakdown` jsonb. JS↔SQL parity is enforced by `scripts/check-scoring.ts`.

**Tech Stack:** Next.js 15 App Router · React 19 · TypeScript strict · Supabase Postgres (plpgsql security-definer RPCs) · pnpm · zod · scripted assertion files (no unit-test runner).

**Spec:** [docs/superpowers/specs/2026-05-25-score-validity-design.md](../specs/2026-05-25-score-validity-design.md) (commit `780777b`).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `supabase/migrations/20260525040000_sat_real_scoring.sql` | Create | `sat.scale_section` function + `sat.save_attempt` recreation + one-shot backfill UPDATE |
| `app/lib/scoring.ts` | Create | `RW_CURVE`, `MATH_CURVE`, `CURVE_VERSION`, `scoreSection`, `projectShort`, `scoreComposite` |
| `app/lib/persistence/queries.ts` | Modify (≈line 4-8) | Extend `SectionBreakdownEntry` with `sectionKey` + `scaled` |
| `scripts/check-scoring.ts` | Create | Curve sanity + JS↔SQL parity battery |
| `app/lib/test.ts` | Modify (computeResults + Results type) | Per-section `sectionKey` / `scaled` / `projectedRaw`; call into `scoring.ts`; delete linear formula |
| `app/lib/persistence/payload.ts` | Modify (sectionBreakdown mapper) | Carry `sectionKey` per section entry; widen `AttemptPayload.sectionBreakdown` type |
| `app/lib/persistence/schema.ts` | Modify (sectionBreakdown item zod object) | Accept `sectionKey: z.enum(['rw','math'])` — without this, zod strips the field before reaching the RPC |
| `scripts/check-payload.ts` | Modify | Assert `sectionKey` present on each `sectionBreakdown[i]` |
| `app/components/ResultsScreen.tsx` | Modify | Show per-section 200-800 scaled scores prominently; (projected) tag for short |
| `app/components/AttemptCard.tsx` | Modify | Chips swap from `correct/total` to `R&W 620 · Math 560` |
| `app/(app)/dashboard/attempts/[id]/page.tsx` | Modify | Header gets the same R&W/Math/Composite block |
| `CLAUDE.md` | Modify | Add "Score Validity sub-project gotchas" + replace stale "scaled score is a fake" entry |
| `README.md` | Modify | Add "Scoring" subsection |

**Established conventions in this repo:**

- Migrations: `supabase/migrations/YYYYMMDDHHMMSS_topic.sql`. Apply via Supabase MCP `apply_migration` or local Supabase CLI; do not run ad-hoc SQL.
- Pure-module checks: `scripts/check-<name>.ts`, run with `pnpm dlx tsx <path>`. No jest/vitest runner.
- Postgres security-definer RPCs have `set search_path = ''` — every SQL reference inside must be **schema-qualified** (`sat.scale_section`, not `scale_section`).
- File-reference convention: `[filename.ts](path)` markdown links in docs (CLAUDE.md, README.md), not backticks.
- Section keys are `'rw'` and `'math'`. `SECTION_CONFIG[section].fullCount` is the source of truth for section length (`rw: 27`, `math: 22` today).
- Two skills also exist as recall hooks: SPR sub-project's `sat.spr_is_correct` ↔ `app/lib/spr.ts` parity is the prior art for the JS↔SQL drift discipline.

---

## Curve numbers (locked for this plan)

The curve below is derived from a publicly-published Digital SAT Practice Test 1 raw-to-scaled table, re-indexed onto our shorter section length (`our_raw * 2 = published_raw`, because `54 / 27 = 44 / 22 = 2`). Implementer **verifies these numbers against the actual PDF** at Task 2 step 3 before committing; minor revisions are expected and acceptable (the script's sanity assertions catch only monotonicity / endpoints / mid-band, not exact values). Recording provenance in the file header is part of the task.

```
RW_CURVE  (length 28, indexed 0..27)
[200, 200, 220, 250, 290, 330, 360, 390, 410, 430, 450, 470, 490, 510,
 530, 550, 570, 590, 610, 630, 660, 680, 700, 720, 740, 760, 780, 800]

MATH_CURVE (length 23, indexed 0..22)
[200, 210, 250, 290, 330, 370, 420, 460, 500, 530, 550, 570, 590, 610,
 630, 650, 680, 700, 720, 740, 760, 780, 800]

CURVE_VERSION = 'dsat-pt1-2024-09'   // sentinel asserted in check-scoring.ts
```

**Spec refinement adopted in this plan:** the spec sketched per-section mid-band sanity `∈ [480, 540]`. The Math curve naturally lands at 570 at its midpoint (`MATH_CURVE[11]`), which is a real-curve shape. The plan widens the assertion to per-section `[480, 600]` and composite `[960, 1200]`. This keeps the gross-typo gate (no midpoint at 200 or 800) without forcing the curve into an artificial shape. The spec's "rough estimate" framing already anticipates this kind of plan-time refinement.

---

## Chunk 1: Commit A — Data layer & parity

This chunk creates the scoring module, the migration, the parity check, and the SQL-side function. It is one logical commit: **everything that touches the DB and the type definitions**. UI keeps rendering its existing display; the only user-visible effect is "the composite number changed" because `save_attempt` is now the authority.

### Task 1: scripted check first (TDD)

The check encodes the spec's expectations *before* any implementation exists, so the implementation has a fixed target.

**Files:**
- Create: `scripts/check-scoring.ts`

- [ ] **Step 1: Create `scripts/check-scoring.ts`**

```ts
// Scripted assertion file (no unit-test runner). Run with:
//   pnpm dlx tsx scripts/check-scoring.ts
//
// Two responsibilities:
//   (1) Sanity-check the JS curves in app/lib/scoring.ts (length matches
//       SECTION_CONFIG[section].fullCount, endpoints 200/800, monotonic,
//       mid-band in a sensible range, every value in [200, 800], curve
//       version sentinel locked).
//   (2) JS-side parity battery: a hardcoded list of (section, raw, total,
//       length) → expected mappings. The implementer also runs each row
//       against `sat.scale_section` once during migration apply (Task 5
//       step 4) to confirm SQL agrees — that part is not automated here
//       (no SQL connection from the script harness).

import {
  RW_CURVE,
  MATH_CURVE,
  CURVE_VERSION,
  scoreSection,
  projectShort,
  scoreComposite,
} from '../app/lib/scoring';
import { SECTION_CONFIG } from '../app/lib/questions';

let failed = 0;
function assert(cond: unknown, label: string): void {
  if (cond) {
    console.log(`  ok — ${label}`);
  } else {
    console.error(`  FAIL — ${label}`);
    failed += 1;
  }
}

// ---------- (1) Sanity ----------

assert(CURVE_VERSION === 'dsat-pt1-2024-09', 'CURVE_VERSION locked');

assert(RW_CURVE.length - 1 === SECTION_CONFIG.rw.fullCount,
  `R&W curve length (${RW_CURVE.length - 1}) === fullCount (${SECTION_CONFIG.rw.fullCount})`);
assert(MATH_CURVE.length - 1 === SECTION_CONFIG.math.fullCount,
  `Math curve length (${MATH_CURVE.length - 1}) === fullCount (${SECTION_CONFIG.math.fullCount})`);

assert(RW_CURVE[0] === 200,                            'RW_CURVE[0] === 200');
assert(RW_CURVE[RW_CURVE.length - 1] === 800,          'RW_CURVE last === 800');
assert(MATH_CURVE[0] === 200,                          'MATH_CURVE[0] === 200');
assert(MATH_CURVE[MATH_CURVE.length - 1] === 800,      'MATH_CURVE last === 800');

for (let i = 0; i < RW_CURVE.length; i++) {
  assert(RW_CURVE[i] >= 200 && RW_CURVE[i] <= 800, `RW_CURVE[${i}] in [200,800]`);
}
for (let i = 0; i < MATH_CURVE.length; i++) {
  assert(MATH_CURVE[i] >= 200 && MATH_CURVE[i] <= 800, `MATH_CURVE[${i}] in [200,800]`);
}

for (let i = 1; i < RW_CURVE.length; i++) {
  assert(RW_CURVE[i] >= RW_CURVE[i - 1],   `RW_CURVE non-decreasing at i=${i}`);
}
for (let i = 1; i < MATH_CURVE.length; i++) {
  assert(MATH_CURVE[i] >= MATH_CURVE[i - 1], `MATH_CURVE non-decreasing at i=${i}`);
}

// Mid-band shape — see plan's "Curve numbers" section on the
// [480, 600] / [960, 1200] widening relative to the spec's estimate.
const midRw   = Math.round(SECTION_CONFIG.rw.fullCount   / 2); // 14
const midMath = Math.round(SECTION_CONFIG.math.fullCount / 2); // 11
const rwMid   = scoreSection('rw',   midRw);
const mathMid = scoreSection('math', midMath);
assert(rwMid   >= 480 && rwMid   <= 600, `R&W mid-band at raw ${midRw} in [480,600], got ${rwMid}`);
assert(mathMid >= 480 && mathMid <= 600, `Math mid-band at raw ${midMath} in [480,600], got ${mathMid}`);
assert(scoreComposite(rwMid, mathMid) >= 960  &&
       scoreComposite(rwMid, mathMid) <= 1200,
       `Composite at mid-mid in [960,1200], got ${scoreComposite(rwMid, mathMid)}`);

// ---------- (2) Parity battery ----------

interface BatteryRow {
  section: 'rw' | 'math';
  raw: number;
  total: number;
  length: 'short' | 'full';
  expected: number;
  note?: string;
}

// "expected" values are derived by looking up the chosen curve at the
// post-projection raw count. Implementer recomputes them from the
// final transcribed RW_CURVE / MATH_CURVE arrays before committing.
const BATTERY: BatteryRow[] = [
  // endpoints — catch off-by-one at array boundaries
  { section: 'rw',   raw: 0,  total: 27, length: 'full',  expected: 200 },
  { section: 'rw',   raw: 1,  total: 27, length: 'full',  expected: 200 },
  { section: 'rw',   raw: 26, total: 27, length: 'full',  expected: 780 },
  { section: 'rw',   raw: 27, total: 27, length: 'full',  expected: 800 },
  { section: 'math', raw: 0,  total: 22, length: 'full',  expected: 200 },
  { section: 'math', raw: 1,  total: 22, length: 'full',  expected: 210 },
  { section: 'math', raw: 21, total: 22, length: 'full',  expected: 780 },
  { section: 'math', raw: 22, total: 22, length: 'full',  expected: 800 },
  // mid-band
  { section: 'rw',   raw: 14, total: 27, length: 'full',  expected: 530 },
  { section: 'math', raw: 11, total: 22, length: 'full',  expected: 570 },
  // short-test projection — full to ceiling/floor
  { section: 'rw',   raw: 10, total: 10, length: 'short', expected: 800 },
  { section: 'rw',   raw: 0,  total: 10, length: 'short', expected: 200 },
  { section: 'math', raw: 10, total: 10, length: 'short', expected: 800 },
  { section: 'math', raw: 0,  total: 10, length: 'short', expected: 200 },
  // LOCKED HALF-STEP — proves JS Math.round and SQL floor(x+0.5) agree.
  // R&W: 5/10 * 27 = 13.5 → rounds to 14 in BOTH JS (Math.round) and
  // SQL (floor(13.5 + 0.5) = floor(14.0) = 14). expected = RW_CURVE[14].
  { section: 'rw',   raw: 5,  total: 10, length: 'short', expected: 530,
    note: 'locked half-step: 5/10*27 = 13.5 → 14' },
  // short-test mid-band
  { section: 'rw',   raw: 8,  total: 10, length: 'short', expected: 700 }, // 8/10*27 = 21.6 → 22 → RW_CURVE[22] = 700
  { section: 'math', raw: 7,  total: 10, length: 'short', expected: 650 }, // 7/10*22 = 15.4 → 15 → MATH_CURVE[15] = 650
];

for (const row of BATTERY) {
  const got = row.length === 'short'
    ? projectShort(row.section, row.raw, row.total).scaled
    : scoreSection(row.section, row.raw);
  assert(got === row.expected,
    `${row.section} raw=${row.raw}/${row.total} ${row.length} → ${got} (expected ${row.expected})` +
      (row.note ? ` [${row.note}]` : ''));
}

// projectShort returns projectedRaw too — sanity check it
const proj = projectShort('rw', 5, 10);
assert(proj.projectedRaw === 14, `projectShort('rw', 5, 10).projectedRaw === 14`);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll scoring assertions passed.');
```

- [ ] **Step 2: Run the check to verify it fails (module doesn't exist yet)**

Run: `pnpm dlx tsx scripts/check-scoring.ts`
Expected: tsx reports a module-resolution error: cannot find `../app/lib/scoring`. **This is the failing-test gate** — proves the script is wired up and that the next step actually does the work.

- [ ] **Step 3: Save progress** (do NOT commit yet — incomplete)

Do not stage or commit. The check file is half of the TDD pair; the implementation in Task 2 is the other half. Both land in Commit A together.

---

### Task 2: `app/lib/scoring.ts`

**Files:**
- Create: `app/lib/scoring.ts`

- [ ] **Step 1: Verify the curve numbers against a published Digital SAT scoring guide**

Download a Digital SAT practice test scoring guide (Practice Test 1, "Bluebook" / College Board). The PDF contains two raw → scaled tables (R&W and Math). Confirm or revise the curve values in the plan's "Curve numbers" block by picking every even row (raw 0, 2, 4, ..., 54 for R&W; 0, 2, 4, ..., 44 for Math). Record the table title + version in a header comment in the file you're about to create. If the actual numbers differ from the plan's:

- Update both arrays in scoring.ts (Step 2 below)
- Update the `expected` values in `scripts/check-scoring.ts` BATTERY rows (Task 1 step 1) to match
- Update `RW_CURVE[14]` and `MATH_CURVE[11]` mid-band expected values

This is a one-time transcription; the script will catch every downstream mismatch.

- [ ] **Step 2: Write `app/lib/scoring.ts`**

```ts
// Real Digital SAT scaled-score curve (sub-project #10 — Score Validity).
//
// Source:  College Board Digital SAT Practice Test 1 scoring guide
//          (Bluebook download, version 2024-09). Tables transcribed
//          and re-indexed onto our single-module section length:
//          RW_CURVE[our_raw]   = PUBLISHED_RW_TABLE[our_raw * 2]
//          MATH_CURVE[our_raw] = PUBLISHED_MATH_TABLE[our_raw * 2]
//          (the factor is exactly 2 because our fullCount of 27 / 22
//          is half of the published 54 / 44 per-section question count.)
//
// Drift discipline: these arrays MUST stay byte-for-byte equivalent to
// the array[] literals in sat.scale_section (see
// supabase/migrations/20260525040000_sat_real_scoring.sql). The
// scripts/check-scoring.ts parity battery enforces this; do not edit
// one without the other.

import { SECTION_CONFIG, type SectionKey } from './questions';

// Bumped when the curve is re-transcribed against a different practice
// test or a corrected scoring guide. scripts/check-scoring.ts asserts
// this value so a swap is a visible diff, not a silent rescore.
export const CURVE_VERSION = 'dsat-pt1-2024-09';

// Indexed by raw correct count (0..27) → scaled section score (200..800).
// Length === SECTION_CONFIG.rw.fullCount + 1 = 28.
export const RW_CURVE: readonly number[] = [
  200, 200, 220, 250, 290, 330, 360, 390, 410, 430,
  450, 470, 490, 510, 530, 550, 570, 590, 610, 630,
  660, 680, 700, 720, 740, 760, 780, 800,
];

// Indexed by raw correct count (0..22) → scaled section score (200..800).
// Length === SECTION_CONFIG.math.fullCount + 1 = 23.
export const MATH_CURVE: readonly number[] = [
  200, 210, 250, 290, 330, 370, 420, 460, 500, 530,
  550, 570, 590, 610, 630, 650, 680, 700, 720, 740,
  760, 780, 800,
];

function curveFor(section: SectionKey): readonly number[] {
  return section === 'rw' ? RW_CURVE : MATH_CURVE;
}

/**
 * raw 0..fullCount → 200..800. Throws on out-of-range — these inputs come
 * from internal code paths (computeResults, projectShort) that already
 * bound the value; an out-of-range arrival is a programmer error, not
 * user input, so we want it loud rather than a mysterious silent 200/800.
 */
export function scoreSection(section: SectionKey, rawCorrect: number): number {
  const curve = curveFor(section);
  const n = curve.length - 1;
  const r = Math.round(rawCorrect);
  if (r < 0 || r > n) {
    throw new Error(
      `scoreSection: raw ${rawCorrect} (rounded ${r}) out of range [0, ${n}] for section ${section}`,
    );
  }
  return curve[r];
}

/**
 * Short-test projection: scale a short attempt as if its raw% applied
 * to the full-test count. Returns the projected raw too, so the UI can
 * label "(projected from 8/10)".
 *
 * Uses Math.round (rounds half away from zero for non-negative inputs);
 * the SQL mirror uses floor(x + 0.5) to match. The locked half-step row
 * in scripts/check-scoring.ts BATTERY proves agreement.
 */
export function projectShort(
  section: SectionKey,
  correct: number,
  total: number,
): { scaled: number; projectedRaw: number } {
  const fullCount = SECTION_CONFIG[section].fullCount;
  const pct = total > 0 ? correct / total : 0;
  const projectedRaw = Math.round(pct * fullCount);
  return { scaled: scoreSection(section, projectedRaw), projectedRaw };
}

/** 200..800 + 200..800 → 400..1600. Real SAT composite is just a sum. */
export function scoreComposite(rwScaled: number, mathScaled: number): number {
  return rwScaled + mathScaled;
}
```

- [ ] **Step 3: Run the check to verify it passes**

Run: `pnpm dlx tsx scripts/check-scoring.ts`
Expected: every line prints `ok — ...` and the final line is `All scoring assertions passed.`

If any line fails: most likely the curve numbers transcribed in Step 1/2 disagree with the BATTERY expected values. Inspect the failing line, decide which side is canonical (the PDF), and adjust the other side.

- [ ] **Step 4: Save progress** (do NOT commit yet)

---

### Task 3: Extend `SectionBreakdownEntry` type

**Files:**
- Modify: `app/lib/persistence/queries.ts` (lines 4-8)

- [ ] **Step 1: Edit the interface**

Find lines 4-8:

```ts
export interface SectionBreakdownEntry {
  name: string;
  correct: number;
  total: number;
}
```

Replace with:

```ts
export interface SectionBreakdownEntry {
  name: string;
  sectionKey: 'rw' | 'math';
  correct: number;
  total: number;
  scaled: number;
}
```

Both new fields are non-optional. The Task 4 migration's backfill UPDATE fills them on every existing row before this code ships, so a server returning a row without these fields means the migration didn't run — a hard error is appropriate.

- [ ] **Step 2: Run type-check; expect failures elsewhere — that is the point**

Run: `pnpm type-check`
Expected: errors in `app/components/AttemptCard.tsx` and other readers that destructure `SectionBreakdownEntry` without the new fields. **These are real failures; do not fix them yet** — they are the call sites Task 7-12 will update in Commit B.

Type-check failures inside Commit A's diff itself (e.g. inside `queries.ts`) ARE blocking and must be fixed before continuing.

- [ ] **Step 3: Save progress** (do NOT commit yet)

---

### Task 4: Migration — `sat.scale_section` + `save_attempt` recreation + backfill

**Files:**
- Create: `supabase/migrations/20260525040000_sat_real_scoring.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260525040000_sat_real_scoring.sql
--
-- Sub-project #10 — Score Validity.
--
--   1. Adds sat.scale_section(section, correct, total, length) — the
--      Postgres mirror of app/lib/scoring.ts (RW_CURVE / MATH_CURVE).
--   2. Recreates sat.save_attempt to compute scaled_score AND attach a
--      `scaled` field to each section_breakdown entry server-side.
--      The client's payload.scaledScore field is read by the upstream
--      zod schema but its value is no longer trusted as authoritative.
--   3. One-shot backfill UPDATE: recomputes scaled_score and adds
--      sectionKey + scaled to every existing row's section_breakdown.
--      Idempotent (recomputes from correct/total/test_length which it
--      does not mutate).
--
-- See docs/superpowers/specs/2026-05-25-score-validity-design.md for
-- design rationale.

-- ---------------- 1) sat.scale_section ----------------
--
-- Array literals MIRROR RW_CURVE / MATH_CURVE in app/lib/scoring.ts
-- byte-for-byte. Update both together; scripts/check-scoring.ts plus
-- the per-row SQL parity check in this migration's deploy notes
-- catch drift.

create or replace function sat.scale_section(
  p_section text,
  p_correct integer,
  p_total integer,
  p_test_length text   -- 'short' | 'full'
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

  if p_test_length = 'short' then
    -- floor(x + 0.5) matches JS Math.round for non-negative inputs.
    -- (Postgres `round(numeric)` is banker's rounding — round-half-to-even —
    -- which disagrees with JS on half-steps where floor(x) is even.)
    v_raw := floor((p_correct::numeric / nullif(p_total, 0) * v_full_count) + 0.5);
  else
    v_raw := p_correct;
  end if;

  -- Clamp to [0, fullCount]; PL/pgSQL arrays are 1-indexed.
  v_raw := greatest(0, least(v_full_count, coalesce(v_raw, 0)));
  return v_curve[v_raw + 1];
end;
$$;

grant execute on function sat.scale_section(text, integer, integer, text)
  to authenticated, service_role;

-- ---------------- 2) sat.save_attempt recreation ----------------
--
-- Diff from the SPR-helpers version (20260525030000):
--   • The test_attempts insert no longer reads scaledScore from the
--     payload; it computes it from a server-built section_breakdown.
--   • section_breakdown is rebuilt: each entry gains `sectionKey`
--     and `scaled` (the latter via sat.scale_section).
--   • attempt_responses insert is unchanged from the SPR-helpers
--     version.

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

  -- Daily attempt-limit check (introduced by daily-test-limit feature).
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

  -- Server-build section_breakdown with sectionKey + scaled.
  v_breakdown := (
    select jsonb_agg(
      jsonb_build_object(
        'name',       e ->> 'name',
        'sectionKey', e ->> 'sectionKey',
        'correct',    (e ->> 'correct')::int,
        'total',      (e ->> 'total')::int,
        'scaled',     sat.scale_section(
                        e ->> 'sectionKey',
                        (e ->> 'correct')::int,
                        (e ->> 'total')::int,
                        v_test_length
                      )
      )
      order by ord
    )
    from jsonb_array_elements(p_attempt -> 'sectionBreakdown')
      with ordinality as t(e, ord)
  );

  -- Composite is the sum of per-section scaled (real SAT does it
  -- the same way: 200-800 + 200-800 → 400-1600).
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

  -- attempt_responses insert (unchanged from the SPR-helpers version).
  insert into sat.attempt_responses (
    attempt_id, user_id, section_key, section_name, position,
    question_id, skill, source, passage, prompt, choices,
    answer_index, explanation, chosen_index, is_correct,
    response_format, entered_value, correct_answer, answer_tolerance
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
    q.answer_tolerance
  from jsonb_array_elements(p_responses) as r
  left join sat.questions q on q.id = r ->> 'questionId';

  return v_id;
end;
$$;

grant execute on function sat.save_attempt(jsonb, jsonb) to authenticated;

-- ---------------- 3) Backfill ----------------
--
-- Skips a row entirely if ANY entry in its section_breakdown has a
-- name we don't recognise — that prevents a NULL routing key from
-- hitting scale_section's exception branch and aborting the update
-- mid-flight. The skipped row keeps its old linear scaled_score.
-- After-run check: `where exists` of the inverse filter; implementer
-- triages any survivors manually (step 6 of Task 5).

update sat.test_attempts ta
set
  section_breakdown = (
    select jsonb_agg(
      jsonb_build_object(
        'name',       e ->> 'name',
        'sectionKey', case e ->> 'name'
                        when 'Reading & Writing' then 'rw'
                        when 'Math' then 'math'
                      end,
        'correct',    (e ->> 'correct')::int,
        'total',      (e ->> 'total')::int,
        'scaled',     sat.scale_section(
                        case e ->> 'name'
                          when 'Reading & Writing' then 'rw'
                          when 'Math' then 'math'
                        end,
                        (e ->> 'correct')::int,
                        (e ->> 'total')::int,
                        ta.test_length
                      )
      )
      order by ord
    )
    from jsonb_array_elements(ta.section_breakdown) with ordinality as t(e, ord)
  ),
  scaled_score = (
    select coalesce(sum(sat.scale_section(
      case e ->> 'name'
        when 'Reading & Writing' then 'rw'
        when 'Math' then 'math'
      end,
      (e ->> 'correct')::int,
      (e ->> 'total')::int,
      ta.test_length
    )), 0)
    from jsonb_array_elements(ta.section_breakdown) e
  )
where not exists (
  -- Skip rows containing ANY entry with an unrecognised name (or null).
  select 1 from jsonb_array_elements(ta.section_breakdown) e
  where e ->> 'name' is null
     or e ->> 'name' not in ('Reading & Writing', 'Math')
);
```

- [ ] **Step 2: Save progress** (do NOT apply or commit yet — the next task applies it)

---

### Task 5: Apply the migration; verify SQL parity

This is the manual integration step. The migration file exists; now the implementer applies it to a real (dev/local) Supabase and confirms behaviour.

**Files:** none (this task is verification only).

- [ ] **Step 1: Pre-migration safety check**

Connect to the dev Supabase (via MCP `execute_sql` or local CLI) and run:

```sql
select distinct e ->> 'name' as name
from sat.test_attempts,
     jsonb_array_elements(section_breakdown) e
order by 1;
```

Expected: exactly two rows, `Math` and `Reading & Writing`. Any other value means the migration's `where not exists` filter will skip those rows — note them; the implementer should ask the user before continuing if the universe is unexpected.

- [ ] **Step 2: Apply the migration**

Via Supabase MCP `apply_migration` (project ref `falgykkspbtrwdcchayi`, name `sat_real_scoring`, query = the file content). Or via local CLI: `supabase migration up` if running against a local stack.

Expected: success, no errors.

- [ ] **Step 3: Verify the function exists and works**

```sql
select sat.scale_section('rw',   0,  27, 'full')  as rw_floor,    -- expect 200
       sat.scale_section('rw',   27, 27, 'full')  as rw_ceil,     -- expect 800
       sat.scale_section('math', 0,  22, 'full')  as math_floor,  -- expect 200
       sat.scale_section('math', 22, 22, 'full')  as math_ceil,   -- expect 800
       sat.scale_section('rw',   14, 27, 'full')  as rw_mid,      -- expect 530
       sat.scale_section('math', 11, 22, 'full')  as math_mid;    -- expect 570
```

- [ ] **Step 4: Verify the locked half-step (JS↔SQL parity)**

```sql
select sat.scale_section('rw', 5, 10, 'short') as locked_halfstep;
-- 5/10 * 27 = 13.5 → floor(13.5 + 0.5) = 14 → RW_CURVE[14] = 530
-- expect 530
```

This is the critical assertion that proves JS Math.round and SQL `floor(x+0.5)` agree on the worst-case input.

- [ ] **Step 5: Spot-check the backfill**

```sql
select id, test_length, scaled_score,
       section_breakdown
from sat.test_attempts
order by created_at desc
limit 5;
```

Expected:
- `scaled_score` is in [400, 1600] for every row.
- Each entry in `section_breakdown` has all five keys: `name`, `sectionKey`, `correct`, `total`, `scaled`.
- `sectionKey` is `'rw'` for Reading & Writing entries and `'math'` for Math entries.

- [ ] **Step 6: Check for skipped rows AND record rows-updated count**

Skipped rows (the inverse of the migration's filter):

```sql
select count(*) as skipped_rows
from sat.test_attempts ta
where exists (
  select 1 from jsonb_array_elements(ta.section_breakdown) e
  where e ->> 'name' is null
     or e ->> 'name' not in ('Reading & Writing', 'Math')
);
```

Expected: `skipped_rows = 0`. If non-zero, the implementer reports the count and asks the user how to triage (typically: keep the old linear `scaled_score`, log a note, move on).

Rows that were updated (have the new shape in `section_breakdown`):

```sql
select count(*) as updated_rows
from sat.test_attempts ta
where exists (
  select 1 from jsonb_array_elements(ta.section_breakdown) e
  where e ? 'scaled' and e ? 'sectionKey'
);
```

Expected: equals `(select count(*) from sat.test_attempts)` minus `skipped_rows`. Record both counts in the acceptance notes for Task 17.

- [ ] **Step 7: Run the JS-side check one more time**

Run: `pnpm dlx tsx scripts/check-scoring.ts`
Expected: still passes (the migration apply shouldn't have changed the JS behaviour).

---

### Task 6: Commit A

**Files staged in this commit:**
- `supabase/migrations/20260525040000_sat_real_scoring.sql`
- `app/lib/scoring.ts`
- `app/lib/persistence/queries.ts`
- `scripts/check-scoring.ts`

**Files NOT in this commit (saved for Commit B):**
- Any modification to `app/lib/test.ts`, `app/lib/persistence/payload.ts`, UI components, `scripts/check-payload.ts`, `CLAUDE.md`, `README.md`.

- [ ] **Step 1: Run all checks one final time**

```bash
pnpm type-check                                       # may still fail due to UI not yet updated
pnpm dlx tsx scripts/check-scoring.ts                # must pass
pnpm dlx tsx scripts/check-payload.ts                # must pass (unchanged)
pnpm lint                                            # must pass
```

`pnpm type-check` will report errors in the UI components that consume the now-updated `SectionBreakdownEntry`. **That is expected and is the wedge for Commit B.** Note the file names for triage; do not fix them in Commit A.

If `pnpm type-check` fails *inside the Commit A diff itself* (e.g., in `scoring.ts` or `queries.ts`), fix before continuing.

- [ ] **Step 2: Stage Commit A files only**

```bash
git add supabase/migrations/20260525040000_sat_real_scoring.sql \
        app/lib/scoring.ts \
        app/lib/persistence/queries.ts \
        scripts/check-scoring.ts
git status --short
```

Expected: only the four files above are staged ("A" or "M"). Unstaged: any UI/test/doc files.

- [ ] **Step 3: Commit**

```powershell
# (PowerShell, BOM-less UTF-8 here-string for the message)
$msg = @'
feat(scoring): real SAT curve + server-trusted scaled score

Sub-project #10 commit A — replaces the placeholder linear formula
(400 + pct*1200) with a real College Board–published Digital SAT
scoring curve, applied per section (200-800) and summed to a composite
(400-1600). sat.save_attempt is now the score authority; the clients
scaledScore payload field is ignored. Backfill UPDATE in the same
migration rewrites every existing rows scaled_score and adds
sectionKey + scaled to each section_breakdown entry.

Files:
- supabase/migrations/20260525040000_sat_real_scoring.sql
  (sat.scale_section function + save_attempt recreation + backfill)
- app/lib/scoring.ts (RW_CURVE / MATH_CURVE / CURVE_VERSION + helpers)
- app/lib/persistence/queries.ts (SectionBreakdownEntry gains
  sectionKey + scaled — pinned to this commit to keep the TS reader
  type in sync with the migrated DB shape)
- scripts/check-scoring.ts (curve sanity + JS↔SQL parity battery,
  including a locked half-step row that proves floor(x+0.5) matches
  Math.round)

Verified: check-scoring.ts green; manual scale_section spot-checks
against the migration (mid-band 530/570, locked half-step 530)
agree; backfill skipped 0 rows.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
[System.IO.File]::WriteAllText("$pwd\COMMIT_MSG_A.tmp", $msg, [System.Text.UTF8Encoding]::new($false))
git commit -F COMMIT_MSG_A.tmp
Remove-Item COMMIT_MSG_A.tmp
```

- [ ] **Step 4: Verify the commit**

```bash
git log --oneline -1
git show --stat HEAD
```

Expected: four files in the diff; commit subject matches.

---

## Chunk 2: Commit B — UI & per-section presentation

This chunk updates the in-memory `Results` type, makes the payload carry `sectionKey`, and reworks the three score-display surfaces. After this commit, users see per-section scaled scores everywhere a composite was shown.

### Task 7: `Results` type + `computeResults` rewrite

**Files:**
- Modify: `app/lib/test.ts`

- [ ] **Step 1: Read the current `computeResults` and `Results` interface**

Open `app/lib/test.ts` at lines 23-27 (Results interface) and lines 73-102 (computeResults). Confirm the current shape matches the spec's "Before" block.

- [ ] **Step 2: Rewrite the imports + Results + computeResults**

Add the scoring import at the top of the file (after the existing imports):

```ts
import { scoreSection, projectShort, scoreComposite } from './scoring';
import { isSprCorrect } from './spr';
import type { SectionKey } from './questions';
```

(`SectionKey` and `isSprCorrect` may already be imported — check before adding.)

Replace the `Results` interface (lines ~23-27):

```ts
export interface Results {
  perSection: {
    name: string;
    sectionKey: SectionKey;     // NEW — needed by scoring + payload
    correct: number;
    total: number;
    scaled: number;             // NEW — 200..800 per section
    projectedRaw?: number;      // NEW — set only for 'short' attempts
  }[];
  pct: number;
  scaled: number;               // composite, 400..1600
}
```

Replace the body of `computeResults`:

```ts
export function computeResults(
  test: Test,
  responses: ResponseValue[][],
): Results {
  let totalCorrect = 0;
  let totalQ = 0;

  const perSection = test.sections.map((sec, si) => {
    let correct = 0;
    sec.questions.forEach((q, qi) => {
      const r = responses[si]?.[qi];
      const isCorrect =
        q.response_format === 'spr'
          ? typeof r === 'string' &&
            isSprCorrect(r, q.correct_answer ?? '', q.answer_tolerance ?? null)
          : typeof r === 'number' && r === q.answerIndex;
      if (isCorrect) correct += 1;
    });
    totalCorrect += correct;
    totalQ += sec.questions.length;

    // For 'short' tests, scoreShort projects raw% onto fullCount; for
    // 'full', it's a direct lookup. Both branch through the same
    // scoring module so the SQL mirror sees the same shape.
    if (test.length === 'short') {
      const p = projectShort(sec.key, correct, sec.questions.length);
      return {
        name: sec.name,
        sectionKey: sec.key,
        correct,
        total: sec.questions.length,
        scaled: p.scaled,
        projectedRaw: p.projectedRaw,
      };
    }
    return {
      name: sec.name,
      sectionKey: sec.key,
      correct,
      total: sec.questions.length,
      scaled: scoreSection(sec.key, correct),
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

**Notes for the implementer:**
- `test.length` is `'short' | 'full'` — confirm by reading the existing `Test` type in the same file (it has a `length: TestLength` field).
- `sec.key` must be the section key (`'rw' | 'math'`). If the section object exposes this differently, route accordingly — read the `buildTest` function in the same file for the actual shape.
- The old `400 + pct·1200` line is **deleted**, not commented out.

- [ ] **Step 3: Run type-check**

Run: `pnpm type-check`
Expected: more failures, all in code that consumes `Results.perSection[i]` and now expects `scaled`, `sectionKey`. These are call sites for the next tasks. Continue.

- [ ] **Step 4: Save progress** (do not commit yet — payload + UI still depend on this)

---

### Task 8: Add the failing `sectionKey` assertion to `check-payload.ts`

TDD ordering: the assertion lands FIRST and is expected to fail; Task 9 then makes the mapper + schema produce the field and the assertion passes.

**Files:**
- Modify: `scripts/check-payload.ts`

- [ ] **Step 1: Find the existing `sectionBreakdown` assertions**

Search for `sectionBreakdown` in the file. There's an assertion like `payload.sectionBreakdown.length === test.sections.length`.

- [ ] **Step 2: Add an assertion that each entry has `sectionKey`**

After the existing `sectionBreakdown.length` assertion, add:

```ts
for (const [i, entry] of payload.sectionBreakdown.entries()) {
  assert(
    entry.sectionKey === 'rw' || entry.sectionKey === 'math',
    `sectionBreakdown[${i}].sectionKey === 'rw' | 'math'`,
  );
}
```

- [ ] **Step 3: Run the check; expect FAILURE**

Run: `pnpm dlx tsx scripts/check-payload.ts`
Expected: the new lines print `FAIL — sectionBreakdown[0].sectionKey === 'rw' | 'math'` (and similarly for index 1) because the mapper doesn't yet produce that field. The script exits non-zero. **This is the failing-test gate.** Do not proceed past this without seeing the failure.

- [ ] **Step 4: Save progress**

---

### Task 9: Payload mapper + zod schema carry `sectionKey`

This is the implementation half of the TDD pair from Task 8.

**Files:**
- Modify: `app/lib/persistence/payload.ts`
- Modify: `app/lib/persistence/schema.ts`

- [ ] **Step 1: Update the zod schema FIRST**

This step is critical and easy to miss. `app/lib/persistence/schema.ts` defines `attemptPayloadSchema` with `sectionBreakdown` items as `z.object({ name, correct, total })`. Zod's default mode is **strip** — unknown keys (like a newly-added `sectionKey`) are silently dropped at `safeParse` time. `actions.ts` then sends the stripped object into the RPC and `sat.save_attempt` sees a NULL sectionKey, which makes `sat.scale_section(NULL, ...)` raise — every save fails.

Open `app/lib/persistence/schema.ts` (lines 25-33 in the current code) and change the sectionBreakdown item schema:

Before:
```ts
sectionBreakdown: z
  .array(
    z.object({
      name: z.string().min(1),
      correct: z.number().int().min(0),
      total: z.number().int().min(0),
    }),
  )
  .min(1),
```

After:
```ts
sectionBreakdown: z
  .array(
    z.object({
      name: z.string().min(1),
      sectionKey: z.enum(['rw', 'math']),    // NEW — server routes scale_section on this
      correct: z.number().int().min(0),
      total: z.number().int().min(0),
    }),
  )
  .min(1),
```

- [ ] **Step 2: Update the `AttemptPayload` interface in `payload.ts`**

`app/lib/persistence/payload.ts` line 36 currently declares:

```ts
sectionBreakdown: { name: string; correct: number; total: number }[];
```

Update to:

```ts
sectionBreakdown: { name: string; sectionKey: 'rw' | 'math'; correct: number; total: number }[];
```

Do NOT add `scaled` or `projectedRaw` to the wire shape — the server computes `scaled` from `sectionKey` + `correct` + `total` + `test_length`, and `projectedRaw` is a client-only display detail.

- [ ] **Step 3: Replace the direct passthrough with an explicit `.map()`**

The current code at line ~98 reads:

```ts
sectionBreakdown: results.perSection,
```

This is a direct passthrough of `Results.perSection`. After Task 7 widened `Results.perSection` to include `sectionKey`, `scaled`, and `projectedRaw?`, the passthrough would carry those extras to the wire. Zod's default strip mode would silently drop `scaled`/`projectedRaw` — safe but brittle: a future zod `.strict()` swap (or a non-zod consumer) would break. Pick only the fields the wire actually needs:

```ts
sectionBreakdown: results.perSection.map((s) => ({
  name: s.name,
  sectionKey: s.sectionKey,   // NEW — server routes scale_section on this
  correct: s.correct,
  total: s.total,
})),
```

- [ ] **Step 4: Run check-payload — now expect PASS**

Run: `pnpm dlx tsx scripts/check-payload.ts`
Expected: all lines `ok — ...`, ending with `ALL CHECKS PASSED`. The previously-failing `sectionKey` lines now succeed.

- [ ] **Step 5: Type-check**

Run: `pnpm type-check`
Expected: payload + schema pass; UI-side still has errors (next tasks).

- [ ] **Step 6: Save progress**

---

### Task 10: `ResultsScreen.tsx`

**Files:**
- Modify: `app/components/ResultsScreen.tsx`

- [ ] **Step 1: Read the current ResultsScreen**

Read the file fully. Identify the JSX block that renders the composite (`results.scaled`) and the per-section `correct/total` chips. The disclaimer copy ("scaled score is a rough indicator") is also in this file.

- [ ] **Step 2: Replace the score block**

The score block should display the composite huge, then each section's scaled score with the section name, then the correct/total chip. For short attempts, append `(projected from {correct}/{total})` muted-grey copy under each section, and `(projected)` muted next to the composite.

Sample JSX (adjust class names to match existing patterns in the file):

```tsx
<div className="text-5xl font-extrabold text-blue-600">
  {results.scaled}
  {test.length === 'short' && (
    <span className="ml-2 text-base font-normal text-slate-400">(projected)</span>
  )}
</div>
<div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
  {results.perSection.map((s) => (
    <div key={s.sectionKey} className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{s.name}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{s.scaled}</div>
      <div className="mt-1 text-xs text-slate-600">
        {s.correct} / {s.total} correct
        {s.projectedRaw !== undefined && (
          <span className="ml-2 text-slate-400">(projected from {s.correct}/{s.total})</span>
        )}
      </div>
    </div>
  ))}
</div>
```

- [ ] **Step 3: Replace the disclaimer**

Find the "rough indicator" paragraph and replace with:

```tsx
<p className="mt-4 text-xs text-slate-500">
  Scored using a College Board–published Digital SAT scoring curve.
  Adaptive module scoring is not yet applied.
</p>
```

- [ ] **Step 4: Run type-check + lint**

```bash
pnpm type-check
pnpm lint
```

Both should pass for this file. The remaining errors are in `AttemptCard` and the attempt-review page.

- [ ] **Step 5: Save progress**

---

### Task 11: `AttemptCard.tsx`

**Files:**
- Modify: `app/components/AttemptCard.tsx`

- [ ] **Step 1: Read the current card**

Identify the chips that show `correct/total` per section.

- [ ] **Step 2: Replace the chip content**

Map each `section_breakdown` entry to a chip that shows the section name and its `scaled` score. Move `correct/total` to the chip's `title` attribute (tooltip). Add a "Short" badge when `attempt.test_length === 'short'`.

Sample:

```tsx
<div className="mt-2 flex flex-wrap gap-2">
  {attempt.section_breakdown.map((s) => (
    <span
      key={s.sectionKey}
      title={`${s.correct} / ${s.total} correct`}
      className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
    >
      {s.name === 'Reading & Writing' ? 'R&W' : s.name} {s.scaled}
    </span>
  ))}
  {attempt.test_length === 'short' && (
    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Short</span>
  )}
</div>
```

- [ ] **Step 3: Run type-check + lint**

```bash
pnpm type-check
pnpm lint
```

This file should pass.

- [ ] **Step 4: Save progress**

---

### Task 12: Attempt-review page header

**Files:**
- Modify: `app/(app)/dashboard/attempts/[id]/page.tsx`

- [ ] **Step 1: Read the current header**

The page renders the attempt summary block at the top — composite + correct/total chips. Identify that block.

- [ ] **Step 2: Replace with the same shape as ResultsScreen's score block**

Mirror the ResultsScreen layout: composite huge, two per-section cards with `scaled` prominent. For short attempts, add the `(projected)` muted tags.

```tsx
<div className="mt-3 flex flex-wrap items-baseline gap-4">
  <div className="text-4xl font-extrabold text-blue-600">
    {attempt.scaled_score}
    {attempt.test_length === 'short' && (
      <span className="ml-2 text-sm font-normal text-slate-400">(projected)</span>
    )}
  </div>
  <div className="text-slate-600">
    {attempt.total_correct}/{attempt.total_questions} correct
  </div>
</div>
<div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
  {attempt.section_breakdown.map((s) => (
    <div key={s.sectionKey} className="rounded-lg border border-slate-200 p-3">
      <div className="text-xs uppercase tracking-wide text-slate-500">{s.name}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{s.scaled}</div>
      <div className="mt-1 text-xs text-slate-600">{s.correct} / {s.total} correct</div>
    </div>
  ))}
</div>
```

- [ ] **Step 3: Run type-check + lint**

```bash
pnpm type-check     # expect CLEAN now
pnpm lint           # expect CLEAN now
```

Both must pass before continuing. If type-check still complains, find the remaining call site and add it to the work in this chunk.

- [ ] **Step 4: Smoke test in dev**

```bash
pnpm dev
```

Open `http://localhost:3000`, sign in, look at:
1. The `/dashboard` list — each card shows section-scaled chips and a "Short" badge for short attempts.
2. A specific attempt review (`/dashboard/attempts/<id>`) — header shows R&W and Math scores prominently.
3. Take a fresh short test, submit it — `ResultsScreen` shows the composite huge with `(projected)`, each section with its scaled score and `(projected from N/10)`.

If anything renders wrong, fix and re-check.

- [ ] **Step 5: Save progress**

---

### Task 13: Commit B

**Files in this commit:**
- `app/lib/test.ts`
- `app/lib/persistence/payload.ts`
- `app/lib/persistence/schema.ts`
- `scripts/check-payload.ts`
- `app/components/ResultsScreen.tsx`
- `app/components/AttemptCard.tsx`
- `app/(app)/dashboard/attempts/[id]/page.tsx`

- [ ] **Step 1: Verify the working tree contains only these files (plus Commit C's pending docs)**

```bash
git status --short
```

The unstaged set should be exactly the seven files above. CLAUDE.md / README.md should be **untouched** at this point.

- [ ] **Step 2: Stage**

```bash
git add app/lib/test.ts \
        app/lib/persistence/payload.ts \
        app/lib/persistence/schema.ts \
        scripts/check-payload.ts \
        app/components/ResultsScreen.tsx \
        app/components/AttemptCard.tsx \
        "app/(app)/dashboard/attempts/[id]/page.tsx"
git status --short
```

- [ ] **Step 3: Final pre-commit checks**

```bash
pnpm type-check                                       # clean
pnpm dlx tsx scripts/check-scoring.ts                # green
pnpm dlx tsx scripts/check-payload.ts                # green
pnpm lint                                            # clean
```

All four must pass. If any fail, fix before committing.

- [ ] **Step 4: Commit**

```powershell
$msg = @'
feat(scoring): per-section scaled scores in the UI

Sub-project #10 commit B — propagates per-section scaled (200-800)
through the in-memory Results type, the persistence payload, and
the three score-display surfaces (ResultsScreen, AttemptCard, the
attempt-review page header). The composite stays the headline number;
per-section scaled becomes the second-most-prominent. Short attempts
carry "(projected)" muted tags on the composite and per-section.

Files:
- app/lib/test.ts (Results gains sectionKey/scaled/projectedRaw;
  computeResults calls scoreSection / projectShort / scoreComposite;
  the 400 + pct*1200 line is deleted)
- app/lib/persistence/payload.ts (sectionBreakdown entry carries
  sectionKey; scaled is NOT in the payload — server computes it)
- app/lib/persistence/schema.ts (zod schema accepts sectionKey on
  each sectionBreakdown entry — without this, zod strips the field
  before reaching the RPC and save_attempt sees NULL sectionKey)
- scripts/check-payload.ts (asserts each sectionBreakdown[i] has
  sectionKey === 'rw' | 'math')
- app/components/ResultsScreen.tsx (composite + per-section cards;
  rewritten disclaimer copy)
- app/components/AttemptCard.tsx (chips swap from correct/total to
  R&W <score> · Math <score>; correct/total moves to title;
  "Short" badge for short attempts)
- app/(app)/dashboard/attempts/[id]/page.tsx (header gets the same
  layout as ResultsScreen)

Verified: pnpm type-check + lint clean; check-scoring + check-payload
both green; manual smoke test of /dashboard, attempt review, and
ResultsScreen for both short and full attempts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
[System.IO.File]::WriteAllText("$pwd\COMMIT_MSG_B.tmp", $msg, [System.Text.UTF8Encoding]::new($false))
git commit -F COMMIT_MSG_B.tmp
Remove-Item COMMIT_MSG_B.tmp
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -2
```

Expected: Commit B at HEAD, Commit A at HEAD~1.

---

## Chunk 3: Commit C — Docs & ship

This chunk documents the new behaviour, updates the "things that bite you" entry, and pushes.

### Task 14: `CLAUDE.md` — new gotchas section + Things-that-bite update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `check-scoring.ts` to the Commands block**

Find the bash block under `## Commands` that lists the existing `check-payload.ts` / `check-analytics.ts` / `check-spr.ts` invocations. Append a new line:

```bash
pnpm dlx tsx scripts/check-scoring.ts     # asserts the SAT scaled-score curve + JS↔SQL parity
```

- [ ] **Step 2: Add architecture entries**

After the existing entries for `app/lib/spr.ts` / `app/components/SprInput.tsx` etc., add (alphabetised approximately by path):

```markdown
- [app/lib/scoring.ts](app/lib/scoring.ts) — `RW_CURVE` / `MATH_CURVE` / `CURVE_VERSION` constants plus pure helpers `scoreSection(section, raw)`, `projectShort(section, correct, total)`, and `scoreComposite(rw, math)`. Mirrors `sat.scale_section` byte-for-byte. The composite is 200–800 + 200–800 → 400–1600 (real SAT does it the same way).
- [scripts/check-scoring.ts](scripts/check-scoring.ts) — scripted check covering curve sanity (length, endpoints, monotonicity, mid-band shape, every value in [200, 800], `CURVE_VERSION` sentinel) and a JS-side parity battery. Includes a locked half-step row (`rw, raw=5, total=10, short`) that proves `floor(x + 0.5)` in SQL matches `Math.round` in JS. The SQL side is verified once at migration apply (Task 5 of the plan).
```

- [ ] **Step 3: Add a new "Score Validity sub-project gotchas" section**

Insert after the Format Parity (SPR) gotchas section, before "Persistence sub-project gotchas":

```markdown
## Score Validity sub-project gotchas

The scoring sub-project has landed: scaled scores come from a real
College Board–published Digital SAT curve rather than a flat linear
formula. Each section reports 200–800; the composite is 400–1600.

- **`RW_CURVE` / `MATH_CURVE` in [app/lib/scoring.ts](app/lib/scoring.ts) and the `array[]` literals inside `sat.scale_section` MUST stay byte-for-byte equivalent.** Same drift discipline as `spr.ts` ↔ `sat.spr_is_correct`. The parity battery in `scripts/check-scoring.ts` enforces it on the JS side; the locked half-step row (R&W raw=5, total=10, length=short → projected raw 14 → scaled 530) is the gate against the JS `Math.round` vs Postgres banker's `round()` failure mode (the SQL uses `floor(x + 0.5)` to match JS for non-negative inputs). Update both arrays in the same change.
- **`scaled_score` is server-trusted.** `sat.save_attempt` recomputes the composite from `section_breakdown[].scaled`, which it computes itself from `correct`/`total`/`test_length` via `sat.scale_section`. The payload's `scaledScore` field is accepted (zod still validates it for backward compat of the wire shape) but its value is **ignored as authoritative** — a client cannot fake a 1600. Same security posture as the SPR canonical answer.
- **Curve length is bound to `SECTION_CONFIG[section].fullCount`.** If you change a section's `fullCount` (e.g. when sub-project #11 doubles the section to two modules), regenerate the curve to match (one new index per added question). `check-scoring.ts` fails the build until you do. Short-test projection auto-tracks `fullCount` changes — it uses the current value as the denominator.
- **`CURVE_VERSION` is a sentinel asserted in `check-scoring.ts`.** Bumping the published-table source (e.g. switching from Practice Test 1 to Practice Test 2) requires bumping the sentinel AND updating both array literals (TS + SQL) AND re-running the backfill UPDATE in a new migration. Users will see a one-time score-trend shift on the swap day; the rewritten disclaimer on `ResultsScreen` frames the score as an estimate, not a transcript.
- **Backfill skipped any row with an unrecognised section name.** The migration's `where not exists` filter excludes rows whose `section_breakdown` has an entry with a `name` outside `{'Reading & Writing', 'Math'}`. Those rows keep their old linear `scaled_score`. The Task 5 acceptance step records the skip count; if non-zero, the implementer triaged them manually. If you add a third section in the future, also extend the backfill CASE expression.
```

- [ ] **Step 4: Update the "Scaled score is a fake" entry under "Things that will bite you"**

Find the bullet that starts with **"Scaled score is a fake"** and replace:

Before:
```markdown
- **Scaled score is a fake.** `scaled = round((400 + pct * 1200) / 10) * 10` — a linear stretch of percent-correct into the 400–1600 range, not a real SAT scale. The README and on-screen note both flag this; don't market it as accurate.
```

After:
```markdown
- **Scaled score is now a real (per-section) curve, server-trusted.** Per section: a real Digital SAT lookup table (`RW_CURVE` / `MATH_CURVE` in [app/lib/scoring.ts](app/lib/scoring.ts), mirrored by `sat.scale_section`). The composite is the sum. `sat.save_attempt` computes it itself — the client's `scaledScore` is ignored. Short tests project the raw% onto the full-test count, then look up that. Adaptive module-aware scoring is sub-project #11's job, not #10's.
```

- [ ] **Step 5: Save progress** (do not commit yet — README is the other half of Commit C)

---

### Task 15: `README.md` — Scoring section

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Scoring" section**

Insert a new `## Scoring` section between `## Test history & review` and `## Analytics`:

```markdown
## Scoring

Each section reports a **200–800 scaled score**; the composite is the
sum (400–1600). The numbers come from a real College Board–published
Digital SAT practice-test scoring guide, re-indexed onto this app's
single-module section length (R&W: 27 questions, Math: 22 questions —
real Digital SAT delivers 54 / 44 across two modules; the second
module ships with sub-project #11).

Short tests project their raw % onto the full-test count and look up
that — so a short attempt and a full attempt show on the same score
axis. The `(projected)` muted-grey label on the score block makes the
projection explicit.

`scaled_score` is computed server-side by `sat.save_attempt` from the
per-section `correct/total/test_length` — the client cannot tamper
with it. The published-curve version is tracked by a `CURVE_VERSION`
sentinel in [app/lib/scoring.ts](app/lib/scoring.ts); switching curves
is a deliberate code change, not a silent rescore.
```

- [ ] **Step 2: Update the architecture file map**

Find the existing block listing `app/lib/spr.ts` etc., and add the two new entries:

```markdown
- app/lib/scoring.ts                  scaled-score curve (RW_CURVE/MATH_CURVE) + helpers
- scripts/check-scoring.ts            scripted check for the scoring curve + JS↔SQL parity
```

And add the new migration line:

```markdown
- supabase/migrations/20260525040000_sat_real_scoring.sql  sat.scale_section + save_attempt recreation + backfill UPDATE
```

- [ ] **Step 3: Save progress**

---

### Task 16: Commit C + push

**Files in this commit:**
- `CLAUDE.md`
- `README.md`

- [ ] **Step 1: Stage**

```bash
git add CLAUDE.md README.md
git status --short
```

Expected: only the two doc files.

- [ ] **Step 2: Final sanity**

```bash
pnpm type-check                                       # clean
pnpm dlx tsx scripts/check-scoring.ts                # green
pnpm dlx tsx scripts/check-payload.ts                # green
pnpm lint                                            # clean
```

- [ ] **Step 3: Commit**

```powershell
$msg = @'
docs(scoring): document the real-curve sub-project

Sub-project #10 commit C — adds the Score Validity sub-project
gotchas section to CLAUDE.md, replaces the stale "scaled score is
a fake" entry under Things-That-Bite, and adds a Scoring section
to README.md.

Files:
- CLAUDE.md (Score Validity gotchas section + Things-that-bite
  update + scoring.ts / check-scoring.ts architecture entries)
- README.md (Scoring section + file map additions)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
'@
[System.IO.File]::WriteAllText("$pwd\COMMIT_MSG_C.tmp", $msg, [System.Text.UTF8Encoding]::new($false))
git commit -F COMMIT_MSG_C.tmp
Remove-Item COMMIT_MSG_C.tmp
```

- [ ] **Step 4: Push**

```bash
git log --oneline -3       # A, B, C visible
git push origin main
```

Expected: pushes three commits. Vercel auto-deploys from `main`.

---

### Task 17: Final acceptance against the spec

**Files:** none (verification only).

- [ ] **Step 1: Run the spec's acceptance checklist**

From `docs/superpowers/specs/2026-05-25-score-validity-design.md` § Acceptance:

1. `pnpm type-check` clean — ✅ verified in Task 16 step 2.
2. `pnpm lint` clean — ✅ verified in Task 16 step 2.
3. `scripts/check-scoring.ts` green — ✅ verified in Task 16 step 2.
4. `scripts/check-payload.ts` green — ✅ verified in Task 16 step 2.
5. **DB spot-check**: `SELECT scaled_score, section_breakdown FROM sat.test_attempts ORDER BY created_at LIMIT 5;` — every row has `scaled_score ∈ [400, 1600]` and each entry of `section_breakdown` has `sectionKey` + `scaled`.
6. **Migration log skip count** — ✅ verified in Task 5 step 6 (zero rows).
7. **SQL parity verification** — ✅ verified in Task 5 step 4 (locked half-step + endpoints + mid-band).
8. **Live `/dashboard`**: an old attempt's score shifted from the linear value. Visual confirmation — note both the old and new score; record in the task notes.
9. **Admin drill-through**: `/admin/users/[id]` for the user — the trend renders, scores recomputed, no console errors.
10. **Fresh full attempt**: take a full-length test, submit. `ResultsScreen` shows composite = sum of per-section scaled scores displayed. **Verify the equation visually**.
11. **Fresh short attempt**: take a 10-question test, submit. Each per-section block carries `(projected from N/10)`; composite shows `(projected)`.

- [ ] **Step 2: Remind the user about n8n**

The n8n hourly generation workflow (`jDjJIthvf6EyKwgR`) does **not** touch scoring — confirmed in the spec ("n8n / generator path is unaffected"). **No update_workflow call is needed for this sub-project**, and no n8n secret repaste is required.

- [ ] **Step 3: Report completion**

Report back to the user:
- Three commits landed (`feat(scoring): real SAT curve + server-trusted scaled score`, `feat(scoring): per-section scaled scores in the UI`, `docs(scoring): document the real-curve sub-project`).
- Push complete; Vercel deploying.
- Old attempt scores have shifted (this is correct — replaced placeholder linear formula with a real curve).
- n8n unaffected; no secret repaste needed.
- Sub-project #11 (Adaptive Test Structure) is the natural next step whenever ready.

---

## Risk recap (from spec § Risks)

The plan's task ordering and TDD pattern collectively address each risk:

| Risk (spec) | Plan mitigation |
|---|---|
| Curve transcription bug | `check-scoring.ts` sanity assertions (monotonicity, endpoints, [200,800], mid-band) + the locked half-step parity row. |
| JS ↔ SQL drift | Identical array literals in both layers; parity battery; explicit `floor(x+0.5)` documented inline in the SQL function. |
| Backfill on a bad name | Pre-migration `SELECT DISTINCT` (Task 5 step 1) + tightened `where not exists` filter (Task 4 step 1) + post-migration skip count (Task 5 step 6). |
| Curve choice locks future calibration | `CURVE_VERSION` sentinel asserted in the JS check; comment in `scoring.ts` calls out the swap procedure. |
| Sub-project #11 will revisit | `scale_section(section, correct, total, length)` signature is positional; #11 can extend it without breaking #10's only call site (`save_attempt`). |
| n8n / generator path is unaffected | Verified explicitly in Task 17 step 2 — no `update_workflow` call, no n8n secret repaste. The scoring constants are read-side only. |

---

## Summary of touched files

```
Created:
  supabase/migrations/20260525040000_sat_real_scoring.sql
  app/lib/scoring.ts
  scripts/check-scoring.ts

Modified:
  app/lib/persistence/queries.ts          (SectionBreakdownEntry shape)
  app/lib/test.ts                         (Results shape + computeResults)
  app/lib/persistence/payload.ts          (sectionKey carry + widened AttemptPayload type)
  app/lib/persistence/schema.ts           (zod sectionBreakdown item accepts sectionKey)
  scripts/check-payload.ts                (sectionKey assertion)
  app/components/ResultsScreen.tsx        (per-section display)
  app/components/AttemptCard.tsx          (chip swap)
  app/(app)/dashboard/attempts/[id]/page.tsx (header swap)
  CLAUDE.md                               (gotchas + architecture)
  README.md                               (Scoring section)
```

Three commits — A (data layer), B (UI), C (docs) — match the spec's commit plan.

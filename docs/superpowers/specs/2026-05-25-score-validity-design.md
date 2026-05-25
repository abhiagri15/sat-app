# Sub-project #10 — Score Validity Design

**Status:** Draft, pending spec review.
**Owner:** Abi.
**Date:** 2026-05-25.

## Goal

Replace the current placeholder linear scaled-score formula with a **real
College Board–published Digital SAT scoring curve**, applied per section
(200–800) and summed to a composite (400–1600). The composite is computed
**server-side** during `sat.save_attempt`, mirroring the security posture
we just adopted for the SPR canonical answer. Existing attempts are
backfilled to the new curve so the score-trend chart stays continuous.

## Non-goals (for clarity)

These belong to **sub-project #11 (Adaptive Test Structure)**, not #10:

- Separate Module-1 vs Module-2 curves (the adaptive pivot).
- Per-question difficulty-weighted scoring (item response theory).
- Variable-length section curves (the real Digital SAT delivers 27+27
  R&W modules; we keep one flat curve over `SECTION_CONFIG[section].fullCount`).

Also out of scope **even for #11**:

- Concordance to a paper SAT (different test, different curve).
- "What-if" simulators ("if I'd gotten 3 more right, what would my score be?").

## Background — why the current score is wrong

`app/lib/test.ts:computeResults` currently computes:

```ts
const pct = totalQ ? totalCorrect / totalQ : 0;
const scaled = Math.round((400 + pct * 1200) / 10) * 10;
```

That is a flat percent-to-1600 line. The real Digital SAT scoring guide
for, e.g., Practice Test 1 shows the middle band is much shallower than
the extremes — a student scoring raw 27/54 on R&W (exactly 50%) earns
**~500–510 scaled**, not the ~800 our linear formula gives. The
endpoints are also wrong: raw 0 is the 200 floor (not 400 from `400 +
0·1200`), and a near-perfect raw is the 800 ceiling (not 1600). The
result: every user's current `scaled_score` is materially off — at the
middle of the range, by ~200 composite points.

This sub-project ships the **lowest-fidelity correct** model: a
per-section lookup table. It still doesn't account for question
difficulty (real SAT uses IRT) — but it captures the right shape
end-to-end, which is the single biggest gap.

## Architecture

Five surfaces change. Order of layering matters because backfill needs
the function to exist.

```
                      ┌──────────────────────────────────────┐
                      │  app/lib/scoring.ts                  │
                      │   • RW_CURVE / MATH_CURVE constants  │
                      │   • scoreSection(s, raw)             │
                      │   • projectShort(s, c, total)        │
                      │   • scoreComposite(rw, math)         │
                      └──────────────────────────────────────┘
                              │             │
                              │             │ imported by
                              │             ▼
                              │   app/lib/test.ts (computeResults)
                              │
                              │ asserted parity-equal to
                              ▼
                      ┌──────────────────────────────────────┐
                      │  sat.scale_section(section, c, t, l) │ ◀── byte-for-byte
                      │  (immutable plpgsql, array literals) │     equivalent
                      └──────────────────────────────────────┘
                              │
                              │ called by
                              ▼
                      ┌──────────────────────────────────────┐
                      │  sat.save_attempt(payload)           │
                      │   • builds section_breakdown with    │
                      │     a `scaled` field per section     │
                      │   • computes composite from sum      │
                      │   • IGNORES payload.scaledScore      │
                      └──────────────────────────────────────┘
                              │
                              │ also run once on existing rows
                              ▼
                      ┌──────────────────────────────────────┐
                      │  Backfill UPDATE in the same         │
                      │  migration; idempotent               │
                      └──────────────────────────────────────┘
```

UI surfaces (`ResultsScreen`, `AttemptCard`, attempt review page) read
the new per-section `scaled` from `section_breakdown` and surface it as
the headline number. `ScoreTrend` stays composite-only.

## Data model

### `app/lib/scoring.ts` — new file

Two TypeScript constants and four pure functions. No I/O, no dependencies
beyond `SECTION_CONFIG`.

```ts
import { SECTION_CONFIG, type SectionKey } from './questions';

// Each array is indexed by raw correct count → scaled section score.
// Length === SECTION_CONFIG[section].fullCount + 1 (so RW_CURVE[0]
// = score for 0 correct, RW_CURVE[N] = score for N correct).
//
// Values are derived from a College Board–published Digital SAT
// Practice Test scoring guide (see "Curve sourcing" below). The exact
// numbers below are PLACEHOLDERS; the implementation plan fills them
// in from the chosen practice test.
export const RW_CURVE: readonly number[] = [
  200, 200, 210, /* ... */, 800,
];

export const MATH_CURVE: readonly number[] = [
  200, 200, 210, /* ... */, 800,
];

function curveFor(section: SectionKey): readonly number[] {
  return section === 'rw' ? RW_CURVE : MATH_CURVE;
}

/**
 * raw 0..fullCount → 200..800. Throws on out-of-range — these inputs come
 * from internal code paths (`computeResults`, `projectShort`) that already
 * bound the value; an out-of-range arrival is a programmer error, not
 * a user input, so we want it loud rather than a mysterious silent 200/800.
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

/** 200..800 + 200..800 → 400..1600 (real SAT does it the same way). */
export function scoreComposite(rwScaled: number, mathScaled: number): number {
  return rwScaled + mathScaled;
}
```

### Curve sourcing

The implementation plan picks **one** published practice test (Digital
SAT Practice Test 1 from College Board) and uses its raw-to-scaled
table as the source. Rationale:

- A real published table is a known-good shape, not our guess.
- A single source means the JS / SQL parity check has one truth.
- Future revisions (a newer scoring guide) are a one-commit swap.

**Critical: the published curve must be re-indexed onto our shorter
section length.** The College Board curves are published for the full
real-SAT section sizes (R&W: 54 questions, Math: 44 questions). Our
sections are a single module (`SECTION_CONFIG.rw.fullCount = 27`,
`SECTION_CONFIG.math.fullCount = 22`) until sub-project #11 adds the
second module. So we map our raw → published raw before lookup:

```
published_raw = round(our_raw * PUBLISHED_TOTAL / OUR_FULL_COUNT)
RW_CURVE[our_raw]   = PUBLISHED_RW_TABLE[ round(our_raw * 54 / 27) ]   // = our_raw * 2
MATH_CURVE[our_raw] = PUBLISHED_MATH_TABLE[ round(our_raw * 44 / 22) ] // = our_raw * 2
```

The factor lands at exactly 2× for our current `fullCount`s, so the
re-index is a clean every-other-row pick. The plan's transcription
step records this rule inline at the top of each array with a comment
naming the source PDF and the re-index multiplier. When #11 bumps
`fullCount` to the full 54/44, the re-index multiplier becomes 1 and
the array length doubles — that change ships with #11, not #10.

The plan also records a **curve version sentinel** at the top of
`scoring.ts`, e.g. `export const CURVE_VERSION = 'dsat-pt1-2024-09'`,
and `check-scoring.ts` asserts the value — making a curve swap a
deliberate diff rather than a silent rescore.

### `app/lib/test.ts:Results`

```ts
export interface Results {
  perSection: {
    name: string;             // existing
    sectionKey: SectionKey;   // NEW — needed by scale_section routing
    correct: number;          // existing
    total: number;            // existing
    scaled: number;           // NEW — 200..800
    projectedRaw?: number;    // NEW — set only for short attempts
  }[];
  pct: number;                // unchanged (used by analytics)
  scaled: number;             // composite, 400..1600
}
```

The old `400 + pct * 1200` line is **deleted** from `computeResults`,
not commented out. For a `'full'` test, `scaled = scoreSection(key, correct)`;
for `'short'`, `scaled = projectShort(key, correct, total).scaled` and
`projectedRaw` is set. `Results.scaled` becomes
`scoreComposite(perSection[0].scaled, perSection[1].scaled)`.

### `sat.scale_section` SQL function

```sql
create or replace function sat.scale_section(
  p_section text,
  p_correct integer,
  p_total integer,
  p_test_length text   -- 'short' | 'full'
) returns integer
language plpgsql
immutable
as $$
declare
  v_curve integer[];
  v_full_count integer;
  v_raw integer;
begin
  -- One array literal per section. MIRRORS RW_CURVE / MATH_CURVE in
  -- app/lib/scoring.ts byte-for-byte. Update both together; the
  -- check-scoring.ts script asserts they agree.
  if p_section = 'rw' then
    v_curve := array[200, 200, 210, /* ... */, 800];
  elsif p_section = 'math' then
    v_curve := array[200, 200, 210, /* ... */, 800];
  else
    raise exception 'sat.scale_section: unknown section %', p_section;
  end if;

  v_full_count := array_length(v_curve, 1) - 1;

  if p_test_length = 'short' then
    -- Project raw% onto the full-test count, same as projectShort.
    -- MUST use floor(x + 0.5) — Postgres `round(numeric)` is banker's
    -- rounding (round-half-to-even, so 0.5 → 0, 2.5 → 2), but JS
    -- `Math.round` rounds half away from zero (0.5 → 1, 2.5 → 3).
    -- Using `floor(x + 0.5)` matches JS for non-negative inputs, which
    -- is what we have here (correct, total, full_count are all ≥ 0).
    -- check-scoring.ts asserts a half-step case to lock this parity in.
    v_raw := floor((p_correct::numeric / nullif(p_total, 0) * v_full_count) + 0.5);
  else
    v_raw := p_correct;
  end if;

  -- Clamp to [0, fullCount]; PL/pgSQL arrays are 1-indexed.
  v_raw := greatest(0, least(v_full_count, coalesce(v_raw, 0)));
  return v_curve[v_raw + 1];
end;
$$;
```

`immutable` lets Postgres constant-fold inside `jsonb_agg`. Marker, mostly.

### `sat.save_attempt` — recreation

Same drop-and-create pattern we used to add SPR support. The relevant
change is the `section_breakdown` assembly:

```sql
v_breakdown := (
  select jsonb_agg(
    jsonb_build_object(
      'name', e ->> 'name',
      'sectionKey', e ->> 'sectionKey',
      'correct', (e ->> 'correct')::int,
      'total', (e ->> 'total')::int,
      'scaled', sat.scale_section(
        e ->> 'sectionKey',
        (e ->> 'correct')::int,
        (e ->> 'total')::int,
        v_test_length
      )
    )
    order by ord
  )
  from jsonb_array_elements(p_attempt -> 'sectionBreakdown') with ordinality as t(e, ord)
);

v_scaled_score := (
  select coalesce(sum((e ->> 'scaled')::int), 0)
  from jsonb_array_elements(v_breakdown) e
);
```

`p_attempt -> 'scaledScore'` is read by the existing zod validation in
`app/lib/persistence/actions.ts` (for backward compat of the wire shape)
but the RPC **ignores it as authoritative** — it never appears in the
INSERT. A stale client cannot fake a 1600.

### `section_breakdown` jsonb shape

Before (per entry): `{ name, correct, total }`.
After (per entry): `{ name, sectionKey, correct, total, scaled }`.

- `sectionKey` is required for routing the scoring function. The
  client always knows it (it's on the in-memory `Test`); we propagate
  it through `toAttemptPayload`.
- `scaled` is filled by the RPC, not the client.

Old rows that pre-date this sub-project will be missing both fields.
The backfill (next section) fills them.

**TypeScript reader type pinned to the same commit as the migration.**
[app/lib/persistence/queries.ts](app/lib/persistence/queries.ts)
defines `SectionBreakdownEntry`:

```ts
// Before:
export interface SectionBreakdownEntry {
  name: string;
  correct: number;
  total: number;
}

// After (Commit A — ships with the migration):
export interface SectionBreakdownEntry {
  name: string;
  sectionKey: 'rw' | 'math';
  correct: number;
  total: number;
  scaled: number;
}
```

Both new fields are non-optional because the backfill fills them on
**every** existing row in the same migration. The dashboard / `AttemptCard`
already read `section_breakdown` via this type, so the type update lands
together with the SQL change — no in-between commit where the DB shape and
the TS shape disagree. If a rollback is ever needed, the rollback must
revert both the migration and the type change together.

## Backfill

A one-shot UPDATE in the same migration that adds `scale_section`. The
function exists by the time the UPDATE runs:

```sql
-- Recover sectionKey from the legacy `name` field. The only two values
-- ever produced in this app are "Reading & Writing" → 'rw' and
-- "Math" → 'math'. Future-proof: if a third section is ever added,
-- extend the CASE expression here AND in app/lib/test.ts /
-- SECTION_CONFIG.
update sat.test_attempts ta
set
  section_breakdown = (
    select jsonb_agg(
      jsonb_build_object(
        'name', e ->> 'name',
        'sectionKey', case e ->> 'name'
                        when 'Reading & Writing' then 'rw'
                        when 'Math' then 'math'
                      end,
        'correct', (e ->> 'correct')::int,
        'total', (e ->> 'total')::int,
        'scaled', sat.scale_section(
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
  -- Skip a row if ANY entry in its breakdown has an unrecognised name.
  -- A partially-recognised row would otherwise hit the CASE-without-ELSE
  -- (returning NULL), and scale_section(NULL, ...) would raise on the
  -- guard clause, aborting the entire UPDATE. This filter — *not exists
  -- an unknown* — keeps the migration atomic even against legacy typos.
  select 1 from jsonb_array_elements(ta.section_breakdown) e
  where e ->> 'name' is null
     or e ->> 'name' not in ('Reading & Writing', 'Math')
);
```

**Idempotency**: the UPDATE recomputes from `correct`/`total`/`test_length`,
which it does not mutate. Re-running it produces the same result. Safe
to apply twice if a deploy step fails partway and is re-run.

**Pre-migration check** (part of the plan): the implementer runs
`SELECT DISTINCT e ->> 'name' FROM sat.test_attempts, jsonb_array_elements(section_breakdown) e;`
and confirms the only two values are exactly `'Reading & Writing'` and
`'Math'`. Any other value (typo or future third section) will cause
the `where not exists` filter to skip those rows entirely — they
retain their old linear scaled_score. The implementer is expected
to report the count of skipped rows and decide whether a manual
fix-up is needed.

**Safety belt on `scale_section`**: the function itself also guards.
The plan's function body uses `raise exception 'sat.scale_section:
unknown section %', p_section` in the ELSE branch (rather than
returning NULL), so a programming bug that bypasses the migration
filter aborts the call rather than silently returning a bogus score.
The `nullif(p_total, 0)` guards against div-by-zero on malformed
short attempts; if that fires, `v_raw` is NULL and the final
`coalesce(v_raw, 0)` clamps to 200.

## UI changes

Five files touch. Listed in order of prominence.

### `app/components/ResultsScreen.tsx`

Layout becomes:

```
              1180                ← composite (huge)
        Reading & Writing 620     ← per-section, prominent
              Math        560
        24/35 correct overall      ← still shown, muted
```

For short attempts, each per-section block adds `(projected from 8/10)`
muted-grey copy pulled from `Results.perSection[i].projectedRaw`. The
composite gets a `(projected)` muted tag when `testLength === 'short'`.

The "scaled score is a rough indicator" disclaimer rewrites to:

> Scored using a College Board–published Digital SAT scoring curve.
> Adaptive module scoring is not yet applied.

### `app/components/AttemptCard.tsx`

Each card on `/dashboard` shows the composite as today. Chips below it
change from `R&W: 4/5 · Math: 7/10` to `R&W 620 · Math 560` (per-section
scaled). The `correct/total` per section moves to the card's tooltip
title, so it isn't lost. A small `Short` badge replaces per-section
projected tags in the card (kept clean at list density).

### `app/(app)/dashboard/attempts/[id]/page.tsx`

The header block uses the same R&W/Math/Composite layout as
ResultsScreen. The per-question review list below it is unchanged —
scoring is purely an aggregate concern.

### `app/components/analytics/ScoreTrend.tsx`

**Unchanged in #10.** The trend chart stays composite-only. A future
follow-up could add an R&W trend + Math trend on the same chart, but
that's a separate decision; the data is available
(`section_breakdown[].scaled`) when we want it.

### `app/(app)/admin/users/[id]/page.tsx`

No admin-specific change. `sat.admin_user_analytics` already reads
`section_breakdown`; once the backfill lands, the per-section `scaled`
field flows through automatically.

### `app/lib/persistence/payload.ts`

`toAttemptPayload` already builds `sectionBreakdown` from
`Results.perSection`. It must now also carry `sectionKey` per entry.
`scaled` is **not** in the payload — the server computes it.

```ts
sectionBreakdown: results.perSection.map((s) => ({
  name: s.name,
  sectionKey: s.sectionKey,   // NEW
  correct: s.correct,
  total: s.total,
})),
```

The `scaledScore` field at the top level of the payload is left
unchanged for backward compat (zod still validates it); the RPC
ignores its value.

## Tests

### `scripts/check-scoring.ts` — new file

Same harness pattern as `scripts/check-spr.ts`. Two responsibilities:

**1. Sanity assertions on the JS curve itself:**

- `RW_CURVE[0] === 200` and `RW_CURVE[RW_CURVE.length - 1] === 800`
  (same for Math).
- `RW_CURVE.length - 1 === SECTION_CONFIG.rw.fullCount` (= 27 today),
  and likewise for Math (= 22 today). Failing this assertion is what
  catches the curve-length / `fullCount` drift mentioned in the gotchas.
- Every curve value lies in `[200, 800]` (catches a typo that would
  later fail the `scaled_score BETWEEN 400 AND 1600` CHECK constraint
  on `sat.test_attempts`).
- Monotonic non-decreasing across each curve (catches transcription bugs).
- **Mid-band shape** — let `mid_rw = round(fullCount.rw / 2) = 14` and
  `mid_math = round(fullCount.math / 2) = 11` (using the same rounding
  rule as the rest of scoring). Then:
  - `scoreSection('rw', mid_rw)   ∈ [480, 540]`
  - `scoreSection('math', mid_math) ∈ [480, 540]`
  - Composite `scoreSection('rw', mid_rw) + scoreSection('math', mid_math) ∈ [960, 1080]`
  — i.e. exactly 2× the per-section bounds; consistent by construction.
  These ranges encode the real-SAT shape ("~50% raw is around 500
  scaled, not the 800 the old linear formula gave").
- **Curve version sentinel**: `CURVE_VERSION === 'dsat-pt1-2024-09'`
  (or whichever version the plan transcribes). A curve swap requires
  bumping this constant — the assertion makes that visible in the diff.

**2. JS ↔ SQL parity battery** — a hardcoded list of `(section, raw,
total, length) → expected` cases. The script asserts JS matches expected.
The same battery is rerun against `sat.scale_section` (see "SQL parity
verification" below) to confirm SQL agrees.

Sample battery rows (using actual `fullCount.rw = 27`, `fullCount.math = 22`):

```ts
// Endpoints (catch off-by-one at the array boundary)
{ section: 'rw',   raw: 0,  total: 27, length: 'full',  expected: 200 },
{ section: 'rw',   raw: 1,  total: 27, length: 'full',  expected: /* from curve */ },
{ section: 'rw',   raw: 26, total: 27, length: 'full',  expected: /* from curve */ },
{ section: 'rw',   raw: 27, total: 27, length: 'full',  expected: 800 },
{ section: 'math', raw: 0,  total: 22, length: 'full',  expected: 200 },
{ section: 'math', raw: 1,  total: 22, length: 'full',  expected: /* from curve */ },
{ section: 'math', raw: 21, total: 22, length: 'full',  expected: /* from curve */ },
{ section: 'math', raw: 22, total: 22, length: 'full',  expected: 800 },
// Mid-band
{ section: 'rw',   raw: 14, total: 27, length: 'full',  expected: /* in [480,540] */ },
{ section: 'math', raw: 11, total: 22, length: 'full',  expected: /* in [480,540] */ },
// Short-test projection
{ section: 'rw',   raw: 10, total: 10, length: 'short', expected: 800 },
{ section: 'rw',   raw: 0,  total: 10, length: 'short', expected: 200 },
{ section: 'rw',   raw: 8,  total: 10, length: 'short', expected: /* projection */ },
// LOCKED HALF-STEP — proves JS Math.round and SQL floor(x+0.5) agree.
// With math fullCount=22, raw=5/total=10 projects to round(11.0) = 11,
// not on a .5 boundary. So pick a case that IS:
// rw fullCount=27, raw=5/total=10 → 5/10*27 = 13.5 → must round to 14 in
// both JS and SQL. This row's expected = scoreSection('rw', 14).
{ section: 'rw',   raw: 5,  total: 10, length: 'short', expected: /* scoreSection('rw', 14) */ },
// Negative-direction half-step would be analogous; we only have non-negative
// inputs so one case suffices.
```

The script exits non-zero on any mismatch. CLAUDE.md Commands block
gains a new line: `pnpm dlx tsx scripts/check-scoring.ts`.

### `scripts/check-payload.ts` — update

The existing payload check is extended with assertions that every
`sectionBreakdown[i]` carries `sectionKey: 'rw' | 'math'` after the
mapper runs. The check passes a short test and asserts `payload.testLength
=== 'short'`; the scoring-side projection is left to `check-scoring.ts`.

## Documentation

### CLAUDE.md additions

A new **"Score Validity sub-project gotchas"** section, after the
Format Parity gotchas:

- **`RW_CURVE` / `MATH_CURVE` in `app/lib/scoring.ts` and the array literals in `sat.scale_section` MUST stay byte-for-byte equivalent.** Same drift discipline as `spr.ts` ↔ `sat.spr_is_correct`. `scripts/check-scoring.ts` enforces it.
- **`scaled_score` is server-trusted.** `sat.save_attempt` recomputes the composite from `section_breakdown[].scaled`. The payload's `scaledScore` field is accepted (zod still validates it) but ignored — a client cannot fake a 1600.
- **Curve length is bound to `SECTION_CONFIG[section].fullCount`.** If you change a section's `fullCount`, regenerate the curve to match (one new index per added question). `check-scoring.ts` fails the build until you do. Short-test projection auto-tracks fullCount changes (uses it as the denominator).

An update to the existing **"Scaled score is a fake"** entry in "Things
that will bite you" — replaced with the new gotcha that `scaled_score`
is now server-trusted and follows a real published curve.

### README.md

A new **"Scoring"** subsection between **"Test history & review"** and
**"Analytics"**, explaining:
- The composite is 400–1600, with each section 200–800.
- Scoring uses a College Board-published practice-test curve (citation in code).
- Short tests project their raw% onto the full-test count.
- The score is server-trusted; the RPC computes it.

## Risks

### Curve transcription bug

The lookup tables are filled by hand from a PDF. A single mistyped
number ships wrong scores until the next time we look at the table.
**Mitigation**: `check-scoring.ts` asserts monotonicity, endpoint
values (0→200, N→800), and the mid-range sanity window. A typo that
breaks monotonicity or moves an endpoint fails the script.

### JS ↔ SQL drift

We add a second pair of mirrored constants (the first was SPR). Same
drift risk; same mitigation (parity battery in `check-scoring.ts`).
Worse than SPR because the arrays are ~50 entries long, not a regex —
a single off-by-one re-indexes everything. The script's battery includes
asserts at indexes 0, 1, N-1, and N specifically to catch off-by-one.

### Backfill on a bad name

A legacy `section_breakdown` row with a typo'd section name would lose
its `scaled_score` (the `where exists` filter skips it). **Mitigation**:
pre-migration `SELECT DISTINCT` step in the plan; the implementer
confirms the universe is exactly `{'Reading & Writing', 'Math'}` before
running the migration.

### Curve choice locks future calibration

Pinning a specific practice-test scoring guide means our scores reflect
that test's particular difficulty. Once shipped, every user's existing
trend baseline is the Practice Test 1 curve; switching to Practice Test
2 later silently rescales everyone's history. **Mitigation**: the
`CURVE_VERSION` sentinel asserted in `check-scoring.ts` makes a curve
swap a visible diff. The plan documents the swap procedure: bump
`CURVE_VERSION`, update both array literals (TS + SQL), re-run the
backfill UPDATE (idempotent — see the Backfill section). Users will
see a one-time score-trend shift on the day of the swap; the rewritten
"scaled score" copy on `ResultsScreen` accepts this by framing the
score as an estimate, not a transcript.

### n8n / generator path is unaffected

The scoring constants are read-side only. The AI generator pipeline
(`app/lib/ai/generate.ts` and the n8n workflow at
`jDjJIthvf6EyKwgR`) does not consume scaled scores — it operates on
question content alone. No update_workflow call is required for this
sub-project. The SKILLS taxonomy ↔ Plan Batches drift discipline
documented in CLAUDE.md is unaffected.

### Sub-project #11 will revisit

`scale_section` takes `(section, correct, total, test_length)` today.
Sub-project #11 (adaptive scoring) will need to add a `module2_difficulty`
argument. **Mitigation**: the function signature is deliberately
positional-only; #11 adds a new overload or extends the existing one
with an optional argument. The existing call site (`save_attempt`) is
the only caller.

## Commit plan

Three commits, mirroring the SPR sub-project's data → app → docs split:

1. **`feat(scoring): real SAT curve + server-trusted scaled score`**
   - `supabase/migrations/20260525040000_sat_real_scoring.sql`
     (function + `save_attempt` recreation + backfill UPDATE)
   - `app/lib/scoring.ts` (constants + `CURVE_VERSION` + helpers)
   - `app/lib/persistence/queries.ts` (`SectionBreakdownEntry` gains
     `sectionKey` + `scaled` — pinned to this commit to keep the TS
     reader type in sync with the migrated DB shape)
   - `scripts/check-scoring.ts`
   - The UI keeps rendering the old display (composite-only); it just
     renders a different number now.

2. **`feat(scoring): per-section scaled scores in the UI`**
   - `app/lib/test.ts` (Results gains `sectionKey`, `scaled`, `projectedRaw`)
   - `app/lib/persistence/payload.ts` (carry `sectionKey`)
   - `scripts/check-payload.ts` (assert `sectionKey` on each entry)
   - `app/components/ResultsScreen.tsx`
   - `app/components/AttemptCard.tsx`
   - `app/(app)/dashboard/attempts/[id]/page.tsx`

3. **`docs(scoring): document the real-curve sub-project`**
   - CLAUDE.md additions + Things-that-bite update
   - README.md scoring subsection

## Acceptance

- `pnpm type-check` clean.
- `pnpm lint` clean.
- `scripts/check-scoring.ts` green (all curve sanity + parity assertions pass).
- `scripts/check-payload.ts` green.
- After migration apply: a manual `SELECT scaled_score, section_breakdown
  FROM sat.test_attempts ORDER BY created_at LIMIT 5;` shows each row
  has `scaled_score` in [400, 1600] and every `section_breakdown`
  entry has `sectionKey` and a `scaled` int field.
- The migration log reports the count of rows updated AND any
  skipped-by-`where not exists` rows (manual confirmation that the
  skip count is 0; if non-zero, the implementer triages those rows).
- **SQL parity verification** (one-off step in the plan): the
  implementer runs the same parity battery rows from
  `check-scoring.ts` against `sat.scale_section` via a `SELECT
  sat.scale_section('rw', 5, 10, 'short') AS got;` style query for
  each row and confirms `got` matches the expected value. Especially
  the locked half-step row.
- Live test on `/dashboard`: an old attempt's score has shifted (this
  is expected and correct — the new curve replaces the placeholder).
- The admin user-analytics drill-through (`/admin/users/[id]`) shows
  the recomputed scores for the inspected user; the trend line shape
  changes but the chart still renders without errors (no admin-side
  code path expects the old linear formula).
- A fresh full-length attempt: the composite on `ResultsScreen` equals
  the sum of the two per-section scaled scores displayed.
- A short attempt: each per-section block shows `(projected from N/10)`
  and the composite shows `(projected)`.

## Out-of-band followups

- A future R&W trend + Math trend twin-line chart on `/analytics`
  (the data is available in `section_breakdown[].scaled`).
- A configurable curve via an admin setting (low value until we have a
  second curve to switch between; deferred).
- An "estimated score uncertainty" band on the trend chart (e.g.
  ±50 composite) — would require a real IRT model; out of scope.

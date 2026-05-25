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

// "expected" values are derived from the locked curve arrays in
// scoring.ts (Task 2). If you change either side, recompute.
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

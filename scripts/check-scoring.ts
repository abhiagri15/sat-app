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
import {
  RW_FULL_EASIER_CURVE,
  RW_FULL_HARDER_CURVE,
  MATH_FULL_EASIER_CURVE,
  MATH_FULL_HARDER_CURVE,
  scoreFullSection,
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

assert(CURVE_VERSION === 'dsat-pt1-2024-09+adaptive', 'CURVE_VERSION locked');

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

// ---------- New curves (sub-project #11) ----------

const FULL_CURVES = [
  { name: 'RW_FULL_EASIER',   curve: RW_FULL_EASIER_CURVE,   expectedLen: 55, endpoint: [200, 600] as const },
  { name: 'RW_FULL_HARDER',   curve: RW_FULL_HARDER_CURVE,   expectedLen: 55, endpoint: [430, 800] as const },
  { name: 'MATH_FULL_EASIER', curve: MATH_FULL_EASIER_CURVE, expectedLen: 45, endpoint: [200, 600] as const },
  { name: 'MATH_FULL_HARDER', curve: MATH_FULL_HARDER_CURVE, expectedLen: 45, endpoint: [430, 800] as const },
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

// Path inequality — Harder ≥ Easier at every raw count.
for (let i = 0; i < RW_FULL_EASIER_CURVE.length; i++) {
  assert(RW_FULL_HARDER_CURVE[i] >= RW_FULL_EASIER_CURVE[i],
    `RW_FULL_HARDER[${i}] >= RW_FULL_EASIER[${i}]`);
}
for (let i = 0; i < MATH_FULL_EASIER_CURVE.length; i++) {
  assert(MATH_FULL_HARDER_CURVE[i] >= MATH_FULL_EASIER_CURVE[i],
    `MATH_FULL_HARDER[${i}] >= MATH_FULL_EASIER[${i}]`);
}

// scoreFullSection: locked quadrant rows.
assert(scoreFullSection('rw',   0,  'easier') === 200,    'rw/easier raw 0 → 200');
assert(scoreFullSection('rw',   54, 'easier') === 600,    'rw/easier raw 54 → 600');
assert(scoreFullSection('rw',   0,  'harder') === 430,    'rw/harder raw 0 → 430');
assert(scoreFullSection('rw',   54, 'harder') === 800,    'rw/harder raw 54 → 800');
assert(scoreFullSection('math', 0,  'easier') === 200,    'math/easier raw 0 → 200');
assert(scoreFullSection('math', 44, 'easier') === 600,    'math/easier raw 44 → 600');
assert(scoreFullSection('math', 0,  'harder') === 430,    'math/harder raw 0 → 430');
assert(scoreFullSection('math', 44, 'harder') === 800,    'math/harder raw 44 → 800');

// Path inequality at the routing-cutoff neighborhood (raw 17 for R&W).
assert(scoreFullSection('rw', 17, 'harder') > scoreFullSection('rw', 17, 'easier'),
  'rw raw 17 harder > easier (path inequality)');

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

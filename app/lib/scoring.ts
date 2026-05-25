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

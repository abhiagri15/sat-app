// Student-Produced Response (SPR) answer parser and comparator.
//
// SPR questions ask the student to type a numeric answer instead of picking
// from 4 choices. The grader needs to accept multiple equivalent forms of
// the same number (0.5 == 1/2) and optionally a tolerance for decimal answers
// that would otherwise be infinite (e.g. 1/3 ≈ 0.33).
//
// This file is the JS-side parser used by the test runner (to show "your
// answer was right/wrong" on review) and the generator (to self-verify SPR
// questions before insert). The Postgres-side equivalents in
// supabase/migrations/20260525030000_sat_spr_helpers.sql (sat.spr_to_numeric,
// sat.spr_is_correct) MUST stay behaviourally in sync — sat.save_attempt
// trusts the Postgres comparator for the is_correct boolean stored per row.

export interface ParsedSpr {
  /** Canonical numeric value, used for tolerance compare. */
  value: number;
  /** Original (trimmed) input. */
  raw: string;
  /** True iff the input was a clean integer or simple fraction (no float). */
  isExact: boolean;
}

const INT_OR_DECIMAL = /^-?(\d+(\.\d+)?|\.\d+)$/;
const SIMPLE_FRACTION = /^-?\d+\/\d+$/;

/**
 * Parses an SPR-style answer string into its numeric value plus metadata.
 *
 * Accepts:
 *   - integer:  "7", "-5", "0"
 *   - decimal:  "3.14", "-0.5", ".5"
 *   - fraction: "1/2", "-3/4", "7/12"
 *
 * Rejects (returns null):
 *   - empty / whitespace only
 *   - mixed numbers ("1 1/2") — match real SAT, which interprets a space as
 *     an end of answer, not a mixed-number separator
 *   - scientific notation ("1e3")
 *   - anything non-numeric
 *   - division by zero
 */
export function parseSpr(input: string): ParsedSpr | null {
  if (input == null) return null;
  const raw = input.trim();
  if (raw.length === 0) return null;

  if (INT_OR_DECIMAL.test(raw)) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    // Integer is exact; decimal is approximate by definition.
    const isExact = !raw.includes('.');
    return { value, raw, isExact };
  }

  if (SIMPLE_FRACTION.test(raw)) {
    const [num, den] = raw.split('/').map(Number);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    return { value: num / den, raw, isExact: true };
  }

  return null;
}

/**
 * Returns true iff the student's entered SPR answer matches the canonical one.
 *
 * Order of checks:
 *   1. Exact string equality (after trim) — handles cases the canonical answer
 *      already encodes student-friendly form (e.g. canonical is "1/2" and the
 *      student typed "1/2").
 *   2. Both sides parse to numbers — compare with tolerance if provided,
 *      otherwise compare for strict equality.
 *
 * tolerance:
 *   - null / undefined → strict numeric equality (matches the Postgres helper)
 *   - number → abs(entered - canonical) <= tolerance accepted
 *
 * Mirrors sat.spr_is_correct in the database — keep them aligned when
 * editing either.
 */
export function isSprCorrect(
  entered: string,
  canonical: string,
  tolerance: number | null | undefined,
): boolean {
  if (entered == null || canonical == null) return false;
  if (entered.trim() === canonical.trim()) return true;

  const e = parseSpr(entered);
  const c = parseSpr(canonical);
  if (!e || !c) return false;

  if (tolerance != null) {
    return Math.abs(e.value - c.value) <= tolerance;
  }
  return e.value === c.value;
}

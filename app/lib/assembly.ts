// Domain-weighted full-test assembly (pure logic — no I/O, no React).
//
// Given a section's per-difficulty composition (the existing 9/9/9 etc. slots),
// produce a domain×difficulty matrix that ALSO hits the official Digital SAT
// domain blueprint. Row sums == per-domain quotas (blueprint × module size),
// column sums == the difficulty slot counts. The draw layer (app/lib/pool.ts)
// then fills each non-zero cell from the pool, restricted to that domain's
// skills. Allocation is deterministic; question *selection* randomness lives in
// the draw_questions RPC.
//
// Covered by scripts/check-assembly.ts.

import { DOMAINS, DOMAIN_BLUEPRINT, type Domain, type SectionKey } from './questions';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface DifficultySlot {
  difficulty: Difficulty;
  count: number;
}

export interface DomainDifficultyCell {
  domain: Domain;
  difficulty: Difficulty;
  count: number;
}

// Largest-remainder apportionment: split `total` across `weights` (which sum to
// 100) into integers that sum exactly to `total`. Ties broken by index order
// for determinism.
export function largestRemainder(weights: number[], total: number): number[] {
  const raw = weights.map((w) => (w / 100) * total);
  const result = raw.map((x) => Math.floor(x));
  let remaining = total - result.reduce((a, b) => a + b, 0);
  const byFrac = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; remaining > 0; k++, remaining--) {
    result[byFrac[k].i] += 1;
  }
  return result;
}

// Per-domain question counts for a `moduleSize`-question module of `section`,
// in DOMAINS[section] order.
export function domainQuotas(section: SectionKey, moduleSize: number): number[] {
  const weights = DOMAINS[section].map((d) => {
    const w = DOMAIN_BLUEPRINT[section][d];
    if (w == null) throw new Error(`assembly: no blueprint weight for ${section}/${d}`);
    return w;
  });
  return largestRemainder(weights, moduleSize);
}

// Biproportional integer rounding: a matrix[rows][cols] whose row sums equal
// `rowMargins` and column sums equal `colMargins`. Requires the margins to have
// the same total. Seed each cell with floor(rowMargin*colMargin/N), then hand
// out the leftover units one at a time to the cell with the largest fractional
// remainder among cells whose row AND column still have a deficit (always
// feasible — a deficit row and deficit column always intersect at a usable
// cell).
export function biproportional(rowMargins: number[], colMargins: number[]): number[][] {
  const total = rowMargins.reduce((a, b) => a + b, 0);
  const colTotal = colMargins.reduce((a, b) => a + b, 0);
  if (total !== colTotal) {
    throw new Error(`assembly: margin totals differ (${total} vs ${colTotal})`);
  }
  const R = rowMargins.length;
  const C = colMargins.length;
  const raw = rowMargins.map((rm) => colMargins.map((cm) => (total === 0 ? 0 : (rm * cm) / total)));
  const matrix = raw.map((row) => row.map((x) => Math.floor(x)));
  const rowDef = rowMargins.map((rm, r) => rm - matrix[r].reduce((a, b) => a + b, 0));
  const colDef = colMargins.map((cm, c) => cm - matrix.reduce((a, row) => a + row[c], 0));

  let remaining = rowDef.reduce((a, b) => a + b, 0);
  while (remaining > 0) {
    let bestR = -1;
    let bestC = -1;
    let bestFrac = -1;
    for (let r = 0; r < R; r++) {
      if (rowDef[r] <= 0) continue;
      for (let c = 0; c < C; c++) {
        if (colDef[c] <= 0) continue;
        const frac = raw[r][c] - Math.floor(raw[r][c]);
        if (frac > bestFrac + 1e-12) {
          bestFrac = frac;
          bestR = r;
          bestC = c;
        }
      }
    }
    if (bestR < 0) break; // unreachable while remaining > 0; safety only
    matrix[bestR][bestC] += 1;
    rowDef[bestR] -= 1;
    colDef[bestC] -= 1;
    remaining -= 1;
  }
  return matrix;
}

// Allocate one module: returns the non-zero domain×difficulty cells. Row sums
// (per domain) follow the blueprint; column sums (per difficulty) equal the
// passed slot counts. Module size is the sum of the slot counts.
export function allocateModule(
  section: SectionKey,
  difficultySlots: DifficultySlot[],
): DomainDifficultyCell[] {
  const moduleSize = difficultySlots.reduce((a, s) => a + s.count, 0);
  const domains = DOMAINS[section];
  const rowMargins = domainQuotas(section, moduleSize);
  const colMargins = difficultySlots.map((s) => s.count);
  const matrix = biproportional(rowMargins, colMargins);

  const cells: DomainDifficultyCell[] = [];
  domains.forEach((domain, r) => {
    difficultySlots.forEach((slot, c) => {
      if (matrix[r][c] > 0) {
        cells.push({ domain, difficulty: slot.difficulty, count: matrix[r][c] });
      }
    });
  });
  return cells;
}

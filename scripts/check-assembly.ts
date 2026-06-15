// Scripted assertion file (no unit-test runner). Run with:
//   pnpm dlx tsx scripts/check-assembly.ts
//
// Covers app/lib/assembly.ts (domain-weighted full-test allocation) plus the
// SKILL_DOMAIN map in app/lib/questions.ts:
//   (1) SKILL_DOMAIN is exhaustive over SKILLS and maps each skill to a domain
//       valid for its section.
//   (2) domainQuotas sums to the module size and matches the blueprint.
//   (3) allocateModule satisfies BOTH margins (row == domain quotas, column ==
//       difficulty slot counts) for the real Module 1 / Module 2 configs.
//   (4) biproportional / largestRemainder edge cases.

import {
  largestRemainder,
  domainQuotas,
  biproportional,
  allocateModule,
  type DifficultySlot,
} from '../app/lib/assembly';
import {
  SKILLS,
  DOMAINS,
  SKILL_DOMAIN,
  SECTION_CONFIG,
  type SectionKey,
} from '../app/lib/questions';

let failed = 0;
function assert(cond: unknown, label: string): void {
  if (cond) {
    console.log(`  ok — ${label}`);
  } else {
    console.error(`  FAIL — ${label}`);
    failed += 1;
  }
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

// ---------- (1) SKILL_DOMAIN exhaustive + valid ----------
console.log('SKILL_DOMAIN coverage:');
for (const section of ['rw', 'math'] as SectionKey[]) {
  const validDomains = new Set<string>(DOMAINS[section]);
  for (const skill of SKILLS[section]) {
    const domain = SKILL_DOMAIN[skill];
    assert(domain !== undefined, `${section}: "${skill}" has a domain`);
    assert(domain !== undefined && validDomains.has(domain),
      `${section}: "${skill}" -> "${domain}" is valid for section`);
  }
}
// No stray keys beyond the SKILLS taxonomy.
const allSkills = new Set<string>([...SKILLS.rw, ...SKILLS.math]);
for (const key of Object.keys(SKILL_DOMAIN)) {
  assert(allSkills.has(key), `SKILL_DOMAIN key "${key}" exists in SKILLS`);
}

// ---------- (2) domainQuotas ----------
console.log('domainQuotas:');
{
  const rw = domainQuotas('rw', SECTION_CONFIG.rw.moduleSize); // 27
  assert(sum(rw) === SECTION_CONFIG.rw.moduleSize, `rw module quotas sum to 27 (got ${sum(rw)})`);
  assert(JSON.stringify(rw) === JSON.stringify([7, 8, 5, 7]),
    `rw 27 quotas == [7,8,5,7] (got ${JSON.stringify(rw)})`);

  const math = domainQuotas('math', SECTION_CONFIG.math.moduleSize); // 22
  assert(sum(math) === SECTION_CONFIG.math.moduleSize, `math module quotas sum to 22 (got ${sum(math)})`);
  assert(JSON.stringify(math) === JSON.stringify([8, 8, 3, 3]),
    `math 22 quotas == [8,8,3,3] (got ${JSON.stringify(math)})`);

  // Two modules approximate the full-section blueprint within +/-1 of ideal.
  const rwFull = rw.map((x) => x * 2);           // [14,16,10,14]
  const idealRw = [26, 28, 20, 26].map((w) => (w / 100) * 54);
  rwFull.forEach((c, i) => assert(Math.abs(c - idealRw[i]) <= 1.5,
    `rw full domain ${i}: ${c} within ~1 of ideal ${idealRw[i].toFixed(1)}`));
}

// ---------- (3) allocateModule satisfies both margins ----------
console.log('allocateModule margins:');
function checkModule(section: SectionKey, slots: DifficultySlot[], label: string): void {
  const cells = allocateModule(section, slots);
  const moduleSize = sum(slots.map((s) => s.count));
  const domains = DOMAINS[section];

  // total
  assert(sum(cells.map((c) => c.count)) === moduleSize,
    `${label}: cells sum to module size ${moduleSize}`);
  // all positive (allocateModule drops zero cells)
  assert(cells.every((c) => c.count > 0), `${label}: no non-positive cells`);

  // row margins == domain quotas
  const quotas = domainQuotas(section, moduleSize);
  domains.forEach((d, i) => {
    const got = sum(cells.filter((c) => c.domain === d).map((c) => c.count));
    assert(got === quotas[i], `${label}: domain "${d}" == ${quotas[i]} (got ${got})`);
  });
  // column margins == difficulty slot counts
  slots.forEach((slot) => {
    const got = sum(cells.filter((c) => c.difficulty === slot.difficulty).map((c) => c.count));
    assert(got === slot.count, `${label}: difficulty "${slot.difficulty}" == ${slot.count} (got ${got})`);
  });
}

// Module 1: R&W 9/9/9, Math 8/7/7
checkModule('rw', [
  { difficulty: 'easy', count: 9 },
  { difficulty: 'medium', count: 9 },
  { difficulty: 'hard', count: 9 },
], 'rw Module 1');
checkModule('math', [
  { difficulty: 'easy', count: 8 },
  { difficulty: 'medium', count: 7 },
  { difficulty: 'hard', count: 7 },
], 'math Module 1');

// Module 2: 70% primary + 30% medium. R&W easier-path 19 easy / 8 medium;
// Math harder-path 15 hard / 7 medium.
checkModule('rw', [
  { difficulty: 'easy', count: 19 },
  { difficulty: 'medium', count: 8 },
], 'rw Module 2 (easier)');
checkModule('math', [
  { difficulty: 'hard', count: 15 },
  { difficulty: 'medium', count: 7 },
], 'math Module 2 (harder)');

// ---------- (4) primitive edge cases ----------
console.log('largestRemainder / biproportional edges:');
assert(JSON.stringify(largestRemainder([25, 25, 25, 25], 10)) === JSON.stringify([3, 3, 2, 2]),
  'largestRemainder even-ish split sums to 10');
assert(sum(largestRemainder([35, 35, 15, 15], 7)) === 7, 'largestRemainder sums to 7');

{
  // biproportional: margins that do not divide evenly
  const m = biproportional([7, 8, 5, 7], [9, 9, 9]);
  assert(m.length === 4 && m.every((r) => r.length === 3), 'biproportional shape 4x3');
  assert(JSON.stringify(m.map(sum)) === JSON.stringify([7, 8, 5, 7]), 'biproportional row sums');
  const cols = [0, 1, 2].map((c) => sum(m.map((r) => r[c])));
  assert(JSON.stringify(cols) === JSON.stringify([9, 9, 9]), 'biproportional column sums');
  assert(m.every((r) => r.every((x) => x >= 0)), 'biproportional non-negative');
}
{
  // mismatched margin totals must throw
  let threw = false;
  try {
    biproportional([5, 5], [4, 4, 4]);
  } catch {
    threw = true;
  }
  assert(threw, 'biproportional throws on mismatched totals');
}
{
  // a zero column margin leaves that column empty
  const m = biproportional([3, 3], [6, 0]);
  assert(m[0][1] === 0 && m[1][1] === 0, 'zero column stays zero');
  assert(sum(m.map((r) => r[0])) === 6, 'all units land in the non-zero column');
}

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll assembly assertions passed.');

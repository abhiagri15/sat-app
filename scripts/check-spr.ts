// Scripted check for the SPR parser + comparator. No unit-test runner in this
// project (spec D8). Run: pnpm dlx tsx scripts/check-spr.ts
//
// Mirrors the assertions in sat.spr_to_numeric / sat.spr_is_correct so the
// client and server agree on every edge case. Add new acceptance/rejection
// cases here AND in the Postgres helper.

import { parseSpr, isSprCorrect } from '../app/lib/spr';

let failed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    failed++;
    console.error('FAIL:', msg);
  } else {
    console.log('  ok —', msg);
  }
}

// --- parseSpr — acceptance ---

assert(parseSpr('7')?.value === 7, 'integer "7" parses to 7');
assert(parseSpr('-5')?.value === -5, 'negative integer "-5" parses to -5');
assert(parseSpr('0')?.value === 0, 'zero "0" parses to 0');
assert(parseSpr('3.14')?.value === 3.14, 'decimal "3.14" parses to 3.14');
assert(parseSpr('-0.5')?.value === -0.5, 'negative decimal "-0.5" parses to -0.5');
assert(parseSpr('.5')?.value === 0.5, 'leading-dot decimal ".5" parses to 0.5');
assert(parseSpr('1/2')?.value === 0.5, 'fraction "1/2" parses to 0.5');
assert(parseSpr('-3/4')?.value === -0.75, 'negative fraction "-3/4" parses to -0.75');
assert(parseSpr('7/12')?.value !== undefined, 'fraction "7/12" parses');

// Integer / fraction are "exact"; decimal is not.
assert(parseSpr('7')?.isExact === true, '"7" reports isExact');
assert(parseSpr('1/2')?.isExact === true, '"1/2" reports isExact');
assert(parseSpr('3.14')?.isExact === false, '"3.14" reports !isExact');

// --- parseSpr — rejection ---

assert(parseSpr('') === null, 'empty string rejected');
assert(parseSpr('   ') === null, 'whitespace-only rejected');
assert(parseSpr('1 1/2') === null, 'mixed number "1 1/2" rejected (match real SAT)');
assert(parseSpr('abc') === null, 'non-numeric "abc" rejected');
assert(parseSpr('1.2.3') === null, 'malformed decimal "1.2.3" rejected');
assert(parseSpr('1/0') === null, 'division by zero "1/0" rejected');
assert(parseSpr('1e3') === null, 'scientific notation "1e3" rejected (match Postgres regex)');
assert(parseSpr('++7') === null, '"++7" rejected');

// Trimming is preserved.
assert(parseSpr('  7  ')?.value === 7, 'integer "  7  " trims to 7');
assert(parseSpr('  7  ')?.raw === '7', 'integer "  7  " raw is "7"');

// --- isSprCorrect — exact ---

assert(isSprCorrect('7', '7', null) === true, 'exact match "7"/"7"');
assert(isSprCorrect('1/2', '1/2', null) === true, 'exact match "1/2"/"1/2"');
assert(isSprCorrect('  3.14  ', '3.14', null) === true, 'trim-equal "  3.14  "/"3.14"');

// --- isSprCorrect — equivalent forms ---

assert(isSprCorrect('0.5', '1/2', null) === true, 'equivalent: 0.5 == 1/2');
assert(isSprCorrect('1/2', '0.5', null) === true, 'equivalent: 1/2 == 0.5');
assert(isSprCorrect('7.0', '7', null) === true, 'equivalent: 7.0 == 7');
assert(isSprCorrect('-3/4', '-0.75', null) === true, 'equivalent: -3/4 == -0.75');

// --- isSprCorrect — tolerance ---

assert(isSprCorrect('3.14', '3.1415', 0.01) === true, 'tolerance 0.01 accepts 3.14 vs 3.1415');
assert(isSprCorrect('3.14', '3.1415', null) === false, 'no tolerance rejects 3.14 vs 3.1415');
assert(isSprCorrect('3.10', '3.1415', 0.01) === false, 'tolerance 0.01 rejects 3.10 vs 3.1415');

// --- isSprCorrect — inequality ---

assert(isSprCorrect('5', '7', null) === false, 'inequality 5 != 7');
assert(isSprCorrect('1/2', '1/3', null) === false, 'inequality 1/2 != 1/3');
assert(isSprCorrect('', '7', null) === false, 'empty entry rejected');
assert(isSprCorrect('abc', '7', null) === false, 'garbage entry rejected');
assert(isSprCorrect('1 1/2', '1.5', null) === false, 'mixed-number entry rejected (parse fail)');

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll SPR assertions passed.');

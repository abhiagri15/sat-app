// Scripted check for app/lib/analytics/compute.ts (no unit-test runner — see CLAUDE.md).
// Run: pnpm dlx tsx scripts/check-analytics.ts
import {
  accuracyPct,
  sortSkillsWeakestFirst,
  focusAreas,
  summarize,
  type SkillStat,
} from '../app/lib/analytics/compute';
import type { AttemptSummary } from '../app/lib/persistence/queries';

function assert(cond: boolean, msg: string): void {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('  ok —', msg);
}

assert(accuracyPct(0, 0) === 0, 'accuracyPct(0,0) === 0');
assert(accuracyPct(1, 2) === 50, 'accuracyPct(1,2) === 50');
assert(accuracyPct(2, 3) === 67, 'accuracyPct(2,3) rounds to 67');

const skills: SkillStat[] = [
  { section: 'rw', skill: 'Words in Context', total: 10, correct: 9 },
  { section: 'rw', skill: 'Command of Evidence', total: 10, correct: 3 },
  { section: 'math', skill: 'Linear equations', total: 8, correct: 4 },
  { section: 'math', skill: 'Ratios', total: 4, correct: 2 },
];

const sorted = sortSkillsWeakestFirst(skills);
assert(sorted[0].skill === 'Command of Evidence', 'weakest skill sorts first (30%)');
assert(sorted[sorted.length - 1].skill === 'Words in Context', 'strongest sorts last (90%)');
assert(sorted[1].skill === 'Linear equations' && sorted[2].skill === 'Ratios',
  '50% tie broken by total desc (8 before 4)');

const focus = focusAreas(skills, 3);
assert(focus.length === 3, 'focusAreas returns 3');
assert(focus[0].skill === 'Command of Evidence', 'focus area 0 is the weakest');
assert(focusAreas([], 3).length === 0, 'focusAreas([]) is empty');

const attempts = [
  { scaled_score: 1200 },
  { scaled_score: 900 },
  { scaled_score: 1500 },
] as unknown as AttemptSummary[];
const sum = summarize(attempts, skills);
assert(sum.testsTaken === 3, 'summarize testsTaken === 3');
assert(sum.bestScore === 1500, 'summarize bestScore === 1500');
assert(sum.averageScore === 1200, 'summarize averageScore === 1200');
assert(sum.questionsAnswered === 32, 'summarize questionsAnswered === 32');

const empty = summarize([], []);
assert(empty.testsTaken === 0 && empty.bestScore === 0 && empty.averageScore === 0,
  'summarize([], []) is all zeros');

console.log('\nALL CHECKS PASSED');

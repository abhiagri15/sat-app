// Scripted check for app/lib/planner/compute.ts (no unit-test runner — see CLAUDE.md).
// Run: pnpm dlx tsx scripts/check-planner.ts
//
// Fixtures (spec §B Testing):
//   1. Rich history — all five slot rules fire; done-derivation flips items.
//   2. Zero history — no throw; the first-test item leads; drills are seeded.
//   3. Near vs far test date — full-test slot logic.
//   4. time_pressure vs careless miss mixes change the `why` string.
//   5. Overdue cap/sort + never-drilled surfacing.

import {
  buildWeekPlan,
  overdueSkills,
  paceSummary,
  type PlannerInputs,
} from '../app/lib/planner/compute';
import type { SkillStat } from '../app/lib/analytics/compute';
import type { PracticeSkillStat } from '../app/lib/practice/queries';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  passed += 1;
  console.log('  ok —', msg);
}

const TODAY = '2026-07-07';

function practice(
  skill: string,
  lastPracticed: string | null,
): PracticeSkillStat {
  return { skill, sessions: 1, questions: 8, correct: 4, lastPracticed };
}

// A baseline "no plan / no history" input we spread over for each fixture.
function base(): PlannerInputs {
  return {
    skills: [],
    practiceStats: {},
    missReasonMix: [],
    testsTaken: 0,
    lastTestAt: null,
    lastFullTestAt: null,
    recentScores: [],
    plan: null,
    thisWeek: { drilledSkills: [], shortTests: 0, fullTests: 0 },
    today: TODAY,
  };
}

// ===========================================================================
// Fixture 1 — rich history: all five slot rules fire
// ===========================================================================
console.log('\n[1] rich history — all five slot rules');

const richSkills: SkillStat[] = [
  // Weakest tested skills (focus areas #1, #2)
  { section: 'rw', skill: 'Command of Evidence', total: 12, correct: 3 }, // 25%
  { section: 'math', skill: 'Quadratics', total: 10, correct: 3 }, // 30%
  // A weak-but-not-weakest tested skill used for the miss/overdue rules
  { section: 'rw', skill: 'Transitions', total: 10, correct: 4 }, // 40%
  { section: 'math', skill: 'Percentages', total: 8, correct: 4 }, // 50%
  { section: 'math', skill: 'Functions', total: 8, correct: 5 }, // 62%
  // A strong skill that must NOT surface as overdue
  { section: 'rw', skill: 'Words in Context', total: 10, correct: 9 }, // 90%
];

const richInputs: PlannerInputs = {
  ...base(),
  skills: richSkills,
  practiceStats: {
    // Transitions practiced recently → NOT overdue (but it is the miss leader).
    Transitions: practice('Transitions', '2026-07-05'),
    // Percentages practiced long ago → overdue.
    Percentages: practice('Percentages', '2026-05-01'),
  },
  missReasonMix: [
    // Transitions has the most tagged misses → slot 3 "review your misses".
    { skill: 'Transitions', missReason: 'concept', cnt: 5 },
    { skill: 'Transitions', missReason: 'careless', cnt: 2 },
    { skill: 'Command of Evidence', missReason: 'time_pressure', cnt: 3 },
    { skill: 'Quadratics', missReason: 'careless', cnt: 2 },
  ],
  testsTaken: 4,
  lastTestAt: '2026-07-06',
  lastFullTestAt: '2026-06-01', // > 14 days ago → a full test is allowed
  recentScores: [1000, 1050, 1100, 1120],
  plan: { targetScore: 1400, testDate: '2026-08-30', sessionsPerWeek: 5 },
  thisWeek: { drilledSkills: [], shortTests: 0, fullTests: 0 },
  today: TODAY,
};

const richPlan = buildWeekPlan(richInputs);
assert(richPlan.length === 5, `rich plan fills 5 slots (got ${richPlan.length})`);

// Slot 1 & 2 = the two weakest tested skills.
assert(
  richPlan[0].kind === 'drill' && richPlan[0].skill === 'Command of Evidence',
  'slot 1 drills the weakest tested skill (Command of Evidence)',
);
assert(
  richPlan[1].kind === 'drill' && richPlan[1].skill === 'Quadratics',
  'slot 2 drills the 2nd-weakest tested skill (Quadratics)',
);

// Slot 3 = the skill with the most tagged misses (Transitions, 7 total).
assert(
  richPlan[2].kind === 'drill' && richPlan[2].skill === 'Transitions',
  'slot 3 is "review your misses" on the miss-leader (Transitions)',
);
assert(
  richPlan[2].label.startsWith('Review your misses'),
  'slot 3 label reads "Review your misses …"',
);

// Slot 4 = a test. Full test allowed (test date 54 days out, last full > 14d).
assert(richPlan[3].kind === 'test', 'slot 4 is a test');
assert(
  richPlan[3].label.includes('full'),
  'slot 4 is a FULL test (far test date + no recent full test)',
);
assert(richPlan[3].href === '/', 'test item links to "/"');

// Slot 5 = an overdue skill (Percentages: 50% + practiced > 14d ago).
assert(
  richPlan[4].kind === 'drill' && richPlan[4].skill === 'Percentages',
  'slot 5 fills from overdue skills (Percentages)',
);

// Drill hrefs point at the drill query.
assert(
  richPlan[0].href === '/practice/command-of-evidence?drill=1',
  'drill item links to /practice/<slug>?drill=1',
);

// --- done-derivation flips items ---
const richDone: PlannerInputs = {
  ...richInputs,
  thisWeek: {
    drilledSkills: ['Command of Evidence', 'Percentages'],
    shortTests: 0,
    fullTests: 1,
  },
};
const donePlan = buildWeekPlan(richDone);
assert(donePlan[0].done === true, 'done: Command of Evidence drill marked done (drilled this week)');
assert(donePlan[1].done === false, 'done: Quadratics drill still not done');
assert(donePlan[3].done === true, 'done: full-test slot marked done (fullTests > 0 this week)');
assert(donePlan[4].done === true, 'done: Percentages overdue drill marked done');

// ===========================================================================
// Fixture 2 — zero history: no throw, first-test item leads, seeded drills
// ===========================================================================
console.log('\n[2] zero history — seed plan');

const zeroInputs: PlannerInputs = {
  ...base(),
  plan: { targetScore: 1300, testDate: null, sessionsPerWeek: 4 },
};
let zeroPlan: ReturnType<typeof buildWeekPlan> = [];
try {
  zeroPlan = buildWeekPlan(zeroInputs);
} catch (e) {
  assert(false, `zero history must not throw (threw: ${String(e)})`);
}
assert(zeroPlan.length === 4, `zero-history plan fills 4 slots (got ${zeroPlan.length})`);
assert(
  zeroPlan[0].kind === 'test' && zeroPlan[0].label.toLowerCase().includes('first'),
  'zero history leads with a "first test" item',
);
assert(
  zeroPlan.slice(1).every((i) => i.kind === 'drill'),
  'remaining zero-history slots are seeded drills',
);
assert(
  zeroPlan.slice(1).every((i) => typeof i.slug === 'string' && i.href.includes('?drill=1')),
  'seeded drills carry a slug + drill href',
);
// With no plan at all, still no throw and still leads with the first test.
const zeroNoPlan = buildWeekPlan({ ...base() });
assert(
  zeroNoPlan.length >= 1 && zeroNoPlan[0].kind === 'test',
  'zero history with NO plan row still leads with a test item (default slots)',
);
// overdueSkills is empty with no tested skills, and must not throw.
assert(overdueSkills(zeroInputs).length === 0, 'overdueSkills([]) empty on zero history');

// ===========================================================================
// Fixture 3 — near vs far test date: full-test slot logic
// ===========================================================================
console.log('\n[3] near vs far test date');

// Shared rich-ish input but with only 2 focus skills so the test lands in slot 3.
const testDateBase: PlannerInputs = {
  ...base(),
  skills: [
    { section: 'rw', skill: 'Command of Evidence', total: 12, correct: 3 },
    { section: 'math', skill: 'Quadratics', total: 10, correct: 3 },
  ],
  missReasonMix: [], // no miss leader → slot 3 becomes the test
  testsTaken: 3,
  lastTestAt: '2026-07-06',
  recentScores: [1000, 1050, 1100],
  plan: { targetScore: 1400, testDate: null, sessionsPerWeek: 3 },
  today: TODAY,
};

// FAR test date + no recent full test → full test.
const farPlan = buildWeekPlan({
  ...testDateBase,
  lastFullTestAt: null,
  plan: { targetScore: 1400, testDate: '2026-09-01', sessionsPerWeek: 3 },
});
const farTest = farPlan.find((i) => i.kind === 'test')!;
assert(farTest.label.includes('full'), 'far test date + no full test → full-test slot');

// FAR test date but a full test taken 5 days ago → short test.
const farRecentFull = buildWeekPlan({
  ...testDateBase,
  lastFullTestAt: '2026-07-02',
  plan: { targetScore: 1400, testDate: '2026-09-01', sessionsPerWeek: 3 },
});
const farRecentTest = farRecentFull.find((i) => i.kind === 'test')!;
assert(
  farRecentTest.label.includes('short'),
  'far test date but a recent full test → short test',
);

// NEAR test date (10 days out) → short test regardless of full-test recency.
const nearPlan = buildWeekPlan({
  ...testDateBase,
  lastFullTestAt: null,
  plan: { targetScore: 1400, testDate: '2026-07-17', sessionsPerWeek: 3 },
});
const nearTest = nearPlan.find((i) => i.kind === 'test')!;
assert(nearTest.label.includes('short'), 'near test date (10d) → short test');

// No test date at all → short test (never full).
const noDatePlan = buildWeekPlan({ ...testDateBase, lastFullTestAt: null });
const noDateTest = noDatePlan.find((i) => i.kind === 'test')!;
assert(noDateTest.label.includes('short'), 'no test date → short test');

// Exactly 14 days out (boundary, inclusive) + no recent full → full test.
const boundaryPlan = buildWeekPlan({
  ...testDateBase,
  lastFullTestAt: null,
  plan: { targetScore: 1400, testDate: '2026-07-21', sessionsPerWeek: 3 },
});
const boundaryTest = boundaryPlan.find((i) => i.kind === 'test')!;
assert(boundaryTest.label.includes('full'), 'test date exactly 14 days out → full test (inclusive boundary)');

// ===========================================================================
// Fixture 4 — reason mixes change the `why` string
// ===========================================================================
console.log('\n[4] time_pressure vs careless vs evidence `why`');

function whyForDominant(reason: string): string {
  const inputs: PlannerInputs = {
    ...base(),
    skills: [{ section: 'math', skill: 'Quadratics', total: 10, correct: 4 }], // 40%
    missReasonMix: [{ skill: 'Quadratics', missReason: reason, cnt: 4 }],
    testsTaken: 2,
    recentScores: [1000, 1050],
    plan: { targetScore: 1300, testDate: null, sessionsPerWeek: 1 },
    today: TODAY,
  };
  const plan = buildWeekPlan(inputs);
  return plan[0].why;
}

const timeWhy = whyForDominant('time_pressure');
assert(/pacing/i.test(timeWhy), `time_pressure why mentions pacing (got: "${timeWhy}")`);
assert(/untimed/i.test(timeWhy), 'time_pressure why suggests drilling untimed');

const carelessWhy = whyForDominant('careless');
assert(
  /accuracy over speed/i.test(carelessWhy),
  `careless why says accuracy over speed (got: "${carelessWhy}")`,
);

const conceptWhy = whyForDominant('concept');
assert(
  /40% on tests/.test(conceptWhy) && /didn't know the concept/i.test(conceptWhy),
  `evidence why cites accuracy + dominant miss label (got: "${conceptWhy}")`,
);

// No tagged misses → plain accuracy phrasing, no miss-label clause.
const plainInputs: PlannerInputs = {
  ...base(),
  skills: [{ section: 'math', skill: 'Quadratics', total: 10, correct: 4 }],
  missReasonMix: [],
  testsTaken: 2,
  recentScores: [1000, 1050],
  plan: { targetScore: 1300, testDate: null, sessionsPerWeek: 1 },
  today: TODAY,
};
const plainWhy = buildWeekPlan(plainInputs)[0].why;
assert(
  /40% on tests/.test(plainWhy) && !/misses/.test(plainWhy),
  `no-miss why is plain accuracy (got: "${plainWhy}")`,
);

// ===========================================================================
// Fixture 5 — overdue cap/sort + never-drilled surfacing
// ===========================================================================
console.log('\n[5] overdue cap/sort + never-drilled');

// Nine weak tested skills (all < 75%), all never drilled → cap at 8, weakest first.
const overdueSkillsInput: SkillStat[] = [
  { section: 'rw', skill: 'Central Ideas', total: 10, correct: 1 }, // 10%
  { section: 'rw', skill: 'Inferences', total: 10, correct: 2 }, // 20%
  { section: 'rw', skill: 'Transitions', total: 10, correct: 3 }, // 30%
  { section: 'math', skill: 'Circles', total: 10, correct: 4 }, // 40%
  { section: 'math', skill: 'Exponents', total: 10, correct: 5 }, // 50%
  { section: 'math', skill: 'Functions', total: 10, correct: 6 }, // 60%
  { section: 'math', skill: 'Percentages', total: 10, correct: 7 }, // 70%
  { section: 'math', skill: 'Geometry (Area)', total: 0, correct: 0 }, // untested → excluded
  { section: 'math', skill: 'Probability', total: 10, correct: 7 }, // 70%
  { section: 'math', skill: 'Volume', total: 8, correct: 5 }, // 62%
  { section: 'rw', skill: 'Words in Context', total: 10, correct: 9 }, // 90% → NOT overdue
];

const overdueInputs: PlannerInputs = {
  ...base(),
  skills: overdueSkillsInput,
  practiceStats: {}, // none drilled → all never-drilled
  testsTaken: 5,
  today: TODAY,
};
const od = overdueSkills(overdueInputs);
assert(od.length === 8, `overdue capped at 8 (got ${od.length})`);
assert(od[0].skill === 'Central Ideas' && od[0].accuracy === 10, 'overdue sorted weakest first (Central Ideas 10%)');
assert(
  !od.some((o) => o.skill === 'Words in Context'),
  'strong skill (90%) excluded from overdue',
);
assert(
  od.every((o) => o.href.includes('?drill=1') && o.slug.length > 0),
  'overdue items carry slug + drill href',
);

// Recency gate: a weak skill practiced RECENTLY is NOT overdue; practiced long
// ago IS overdue; never-drilled IS overdue.
const recencyInputs: PlannerInputs = {
  ...base(),
  skills: [
    { section: 'math', skill: 'Circles', total: 10, correct: 4 }, // 40%, recent → not overdue
    { section: 'math', skill: 'Exponents', total: 10, correct: 4 }, // 40%, stale → overdue
    { section: 'math', skill: 'Functions', total: 10, correct: 4 }, // 40%, never drilled → overdue
  ],
  practiceStats: {
    Circles: practice('Circles', '2026-07-05'), // 2 days ago
    Exponents: practice('Exponents', '2026-06-01'), // > 14 days ago
  },
  testsTaken: 3,
  today: TODAY,
};
const recOd = overdueSkills(recencyInputs).map((o) => o.skill);
assert(!recOd.includes('Circles'), 'recently-practiced weak skill NOT overdue');
assert(recOd.includes('Exponents'), 'stale-practiced weak skill IS overdue (>14d)');
assert(recOd.includes('Functions'), 'never-drilled weak skill IS overdue');

// ===========================================================================
// Fixture 6 — paceSummary
// ===========================================================================
console.log('\n[6] paceSummary');

const pace3 = paceSummary({
  ...base(),
  recentScores: [1000, 1100, 1200, 1250], // avg of last 3 = 1183
  testsTaken: 4,
  plan: { targetScore: 1400, testDate: '2026-08-04', sessionsPerWeek: 4 },
  today: TODAY,
});
assert(pace3.current === 1183, `pace current = avg of last 3 (got ${pace3.current})`);
assert(pace3.target === 1400, 'pace target from plan');
assert(pace3.gap === 217, `pace gap = target - current (got ${pace3.gap})`);
assert(pace3.daysToTest === 28, `daysToTest = 28 (got ${pace3.daysToTest})`);
assert(pace3.weeksToTest === 4, `weeksToTest = 4 (got ${pace3.weeksToTest})`);
assert(pace3.paceNote.length > 0, 'paceNote is a non-empty sentence');

// Fewer than 3 scores → uses the last score.
const pace1 = paceSummary({ ...base(), recentScores: [990], testsTaken: 1, plan: { targetScore: 1200, testDate: null, sessionsPerWeek: 4 }, today: TODAY });
assert(pace1.current === 990, 'pace current = last score when < 3 scores');
assert(pace1.daysToTest === null && pace1.weeksToTest === null, 'no test date → null days/weeks');

// No scores → null current, sensible note.
const pace0 = paceSummary({ ...base(), plan: { targetScore: 1200, testDate: null, sessionsPerWeek: 4 } });
assert(pace0.current === null && pace0.gap === null, 'no scores → null current + gap');
assert(/take a test/i.test(pace0.paceNote), 'no-score paceNote prompts taking a test');

// At/above target → congratulatory, non-negative framing.
const paceAt = paceSummary({ ...base(), recentScores: [1450], testsTaken: 1, plan: { targetScore: 1400, testDate: '2026-07-21', sessionsPerWeek: 4 }, today: TODAY });
assert(paceAt.gap !== null && paceAt.gap <= 0, 'gap <= 0 when at/above target');
assert(/target/i.test(paceAt.paceNote), 'at-target note mentions the target');

console.log(`\nALL CHECKS PASSED (${passed} assertions)`);

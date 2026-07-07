// Scripted check for the AI lesson + guidance zod schemas (no unit-test runner
// — see CLAUDE.md). Two jobs:
//   1. DRIFT GUARD: every static lesson in LESSONS parses against lessonSchema.
//      The 35 static lessons are the contract-conforming baseline; if one fails
//      lessonSchema, the SCHEMA's bounds have drifted from the Lesson interface
//      (fix the schema, not the lesson).
//   2. GUIDANCE BOUNDS: a valid guidance object passes; representative
//      malformed fixtures (missing focus, 1-item focus, 5-item nextSteps,
//      39-char summary) each REJECT.
// Run: pnpm dlx tsx scripts/check-lesson-schema.ts
import { LESSONS } from '../app/lib/lessons/index';
import { lessonSchema } from '../app/lib/ai/lesson-schema';
import { guidanceSchema } from '../app/lib/ai/guidance-schema';

let passed = 0;

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  passed += 1;
}

// 1. Every static lesson parses against lessonSchema (schema-vs-authoring-bounds
//    drift guard).
for (const [skill, lesson] of Object.entries(LESSONS)) {
  const result = lessonSchema.safeParse(lesson);
  assert(
    result.success,
    `static lesson "${skill}" parses against lessonSchema` +
      (result.success ? '' : ` — ${JSON.stringify(result.error.issues)}`),
  );
}

// 2. Guidance fixtures.
const validGuidance = {
  summary:
    "You're improving on this skill, but rushed algebra steps keep costing you on harder items.",
  focus: [
    { point: 'Slow down on multi-step setups', why: 'Two recent misses skipped a distribution step.' },
    { point: 'Recheck the question stem', why: 'You solved for x when the prompt asked for 2x.' },
  ],
  nextSteps: ['Do 5 medium items untimed', 'Write each step out fully'],
};
assert(guidanceSchema.safeParse(validGuidance).success, 'valid guidance object passes');

// missing focus → REJECT
const { focus: _omitFocus, ...noFocus } = validGuidance;
assert(!guidanceSchema.safeParse(noFocus).success, 'guidance missing focus is rejected');

// 1-item focus → REJECT (min 2)
assert(
  !guidanceSchema.safeParse({ ...validGuidance, focus: [validGuidance.focus[0]] }).success,
  'guidance with 1-item focus is rejected',
);

// 5-item nextSteps → REJECT (max 4)
assert(
  !guidanceSchema.safeParse({
    ...validGuidance,
    nextSteps: ['a', 'b', 'c', 'd', 'e'],
  }).success,
  'guidance with 5-item nextSteps is rejected',
);

// 39-char summary → REJECT (min 40)
assert(
  !guidanceSchema.safeParse({ ...validGuidance, summary: 'x'.repeat(39) }).success,
  'guidance with 39-char summary is rejected',
);

console.log(`check-lesson-schema: ${passed} assertions passed`);

// Scripted check for toAttemptPayload — the project has no test runner (spec D8).
// Run: pnpm dlx tsx scripts/check-payload.ts
import { buildTest, computeResults } from '../app/lib/test';
import { toAttemptPayload } from '../app/lib/persistence/payload';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('  ok —', msg);
}

const test = buildTest('Test Student', 'short');

// section 0: every answer correct. section 1: first question skipped, rest wrong.
const responses: (number | null)[][] = test.sections.map((sec, si) =>
  sec.questions.map((q, qi) => {
    if (si === 0) return q.answerIndex;               // correct
    if (qi === 0) return null;                        // skipped
    return (q.answerIndex + 1) % q.choices.length;    // wrong
  }),
);

const results = computeResults(test, responses);
const payload = toAttemptPayload(test, responses, results, 'short');

const totalQ = test.sections.reduce((n, s) => n + s.questions.length, 0);
assert(payload.responses.length === totalQ,
  `responses count (${payload.responses.length}) === question count (${totalQ})`);
assert(payload.totalQuestions === totalQ, `totalQuestions === ${totalQ}`);
assert(payload.studentName === 'Test Student', 'studentName carried from test.name');
assert(payload.testLength === 'short', 'testLength carried through');
assert(payload.scaledScore >= 400 && payload.scaledScore <= 1600,
  `scaledScore ${payload.scaledScore} within 400..1600`);
assert(payload.sectionBreakdown.length === test.sections.length,
  'sectionBreakdown has one entry per section');

const sec0 = payload.responses.filter((r) => r.sectionKey === test.sections[0].key);
assert(sec0.length > 0 && sec0.every((r) => r.isCorrect),
  'every section-0 response isCorrect');

const skipped = payload.responses.find((r) => r.chosenIndex === null);
assert(skipped !== undefined, 'a skipped response exists');
assert(skipped!.isCorrect === false, 'skipped response has isCorrect === false');

const wrong = payload.responses.find((r) => r.chosenIndex !== null && !r.isCorrect);
assert(wrong !== undefined, 'an incorrect response exists');
assert(typeof wrong!.questionId === 'string' && wrong!.questionId.length > 0,
  'questionId is a non-empty string');
assert(wrong!.explanation.length > 0, 'explanation is non-empty');

console.log('\nALL CHECKS PASSED');

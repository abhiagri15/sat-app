// Scripted check for toAttemptPayload — the project has no test runner (spec D8).
// Run: pnpm dlx tsx scripts/check-payload.ts
import { buildTest, computeResults, isAnswered, sectionQuestions } from '../app/lib/test';
import { toAttemptPayload } from '../app/lib/persistence/payload';
import { attemptPayloadSchema } from '../app/lib/persistence/schema';
import type { ResponseValue } from '../app/lib/test';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('  ok —', msg);
}

const test = buildTest('Test Student', 'short');

// section 0: every answer correct. section 1: first question skipped, rest wrong.
// Responses are 3-D ([section][module][question]) per sub-project #11; short
// tests have one module per section so [si][0][qi] mirrors the old layout.
const responses: ResponseValue[][][] = test.sections.map((sec, si) =>
  sec.modules.map((mod) =>
    mod.questions.map((q, qi) => {
      if (si === 0) return q.answerIndex;               // correct
      if (qi === 0) return null;                        // skipped
      return (q.answerIndex + 1) % q.choices.length;    // wrong
    }),
  ),
);

const results = computeResults(test, responses);

// A timing matrix parallel to `responses`: question 0 of section 0 is left at 0
// (→ null on the wire), question 1 gets a real value (→ preserved). Everything
// else defaults to 0/null. Exercises both the "absent/0 → null" and the
// "present → number" branches of the mapper.
const timesMs: number[][][] = responses.map((sec, si) =>
  sec.map((mod, mi) =>
    mod.map((_v, qi) => (si === 0 && mi === 0 && qi === 1 ? 4200 : 0)),
  ),
);

const payload = toAttemptPayload(test, responses, results, 'short', false, timesMs);

const totalQ = test.sections.reduce((n, s) => n + sectionQuestions(s).length, 0);
assert(payload.responses.length === totalQ,
  `responses count (${payload.responses.length}) === question count (${totalQ})`);
assert(payload.totalQuestions === totalQ, `totalQuestions === ${totalQ}`);
assert(payload.studentName === 'Test Student', 'studentName carried from test.name');
assert(payload.testLength === 'short', 'testLength carried through');
assert(payload.scaledScore >= 400 && payload.scaledScore <= 1600,
  `scaledScore ${payload.scaledScore} within 400..1600`);
assert(payload.sectionBreakdown.length === test.sections.length,
  'sectionBreakdown has one entry per section');
for (const [i, entry] of payload.sectionBreakdown.entries()) {
  assert(
    entry.sectionKey === 'rw' || entry.sectionKey === 'math',
    `sectionBreakdown[${i}].sectionKey === 'rw' | 'math'`,
  );
}

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

// Sub-project #11 assertions: moduleIndex + module2Path discipline.
for (const r of payload.responses) {
  if (payload.testLength === 'short') {
    assert(r.moduleIndex === null,
      `short response moduleIndex === null (got ${r.moduleIndex}) for q=${r.questionId}`);
  } else {
    assert(r.moduleIndex === 0 || r.moduleIndex === 1,
      `full response moduleIndex in {0,1} (got ${r.moduleIndex}) for q=${r.questionId}`);
  }
}
for (const entry of payload.sectionBreakdown) {
  if (payload.testLength === 'short') {
    assert(entry.module2Path === null || entry.module2Path === undefined,
      `sectionBreakdown[${entry.sectionKey}].module2Path null/absent on short test`);
  }
}

// breaksUsed flows through (5th arg, required — no implicit default).
const payloadNoBreaks = toAttemptPayload(test, responses, results, 'short', false);
assert(payloadNoBreaks.breaksUsed === false, 'breaksUsed false when 5th arg is false');
const payloadWithBreaks = toAttemptPayload(test, responses, results, 'short', true);
assert(payloadWithBreaks.breaksUsed === true, 'breaksUsed true when 5th arg is true');

// --- SPR (grid-in) responses must pass wire validation ----------------------
// Regression guard: grid-in questions carry choices: [] and SPR-only fields.
// The wire schema must (1) accept empty choices and (2) preserve the SPR fields
// (responseFormat/enteredValue/...) rather than strip them — otherwise the RPC
// receives null and the whole attempt is rejected as invalid_payload.
const sprPayload = toAttemptPayload(test, responses, results, 'short', false);
sprPayload.responses[0] = {
  ...sprPayload.responses[0],
  choices: [],
  answerIndex: 0,
  chosenIndex: null,
  responseFormat: 'spr',
  enteredValue: '7',
  correctAnswer: '7',
  answerTolerance: null,
};
const sprParsed = attemptPayloadSchema.safeParse(sprPayload);
assert(sprParsed.success, 'SPR response (empty choices) passes wire validation');
if (sprParsed.success) {
  const r0 = sprParsed.data.responses[0] as Record<string, unknown>;
  assert(r0.responseFormat === 'spr', 'responseFormat preserved (not stripped by zod)');
  assert(r0.enteredValue === '7', 'enteredValue preserved (not stripped by zod)');
}

// An mcq response must still REQUIRE non-empty choices (don't over-loosen).
const mcqPayload = toAttemptPayload(test, responses, results, 'short', false);
mcqPayload.responses[0] = { ...mcqPayload.responses[0], responseFormat: 'mcq', choices: [] };
assert(
  !attemptPayloadSchema.safeParse(mcqPayload).success,
  'mcq response with empty choices is still rejected',
);

// --- Sub-project #15: per-question timeMs + figure snapshot -----------------
// The mapper writes timeMs (null when absent/0, the number when > 0) and
// figure (null when the question carries none). Both must survive the wire
// schema (strip-mode guard) and the cap must be enforced.
const timedPayload = toAttemptPayload(test, responses, results, 'short', false, timesMs);
const zeroTimeR = timedPayload.responses.find((r) => r.timeMs === null);
const setTimeR = timedPayload.responses.find((r) => r.timeMs === 4200);
assert(zeroTimeR !== undefined, 'a response with timeMs null (absent/0) exists');
assert(setTimeR !== undefined, 'a response with timeMs 4200 (measured) exists');
assert(
  timedPayload.responses.every((r) => r.figure === null),
  'every response carries figure === null (no figure on seed questions)',
);
const timedParsed = attemptPayloadSchema.safeParse(timedPayload);
assert(timedParsed.success, 'payload with timeMs + figure passes wire validation (strip-mode guard)');
if (timedParsed.success) {
  const parsedZero = timedParsed.data.responses.find((r) => r.timeMs === null);
  const parsedSet = timedParsed.data.responses.find((r) => r.timeMs === 4200);
  assert(parsedZero !== undefined, 'timeMs null preserved (not stripped by zod)');
  assert(parsedSet !== undefined, 'timeMs 4200 preserved (not stripped by zod)');
  assert(
    timedParsed.data.responses.every((r) => (r as Record<string, unknown>).figure === null),
    'figure field preserved (not stripped by zod)',
  );
}

// The cap (TIME_MS_CAP = 600000) is the airtight backstop: an over-cap value
// must be rejected by the schema.
const overCapPayload = toAttemptPayload(test, responses, results, 'short', false, timesMs);
overCapPayload.responses[0] = { ...overCapPayload.responses[0], timeMs: 600001 };
assert(
  !attemptPayloadSchema.safeParse(overCapPayload).success,
  'timeMs of 600001 (over TIME_MS_CAP) is rejected',
);

// --- Stale-tab back-compat (the 2026-07-07 lost-attempt bug) ----------------
// A tab loaded before the #15 deploy sends responses with NO timeMs/figure
// keys at all. nullable-without-optional rejected the whole save as terminal
// invalid_payload and two real student attempts were lost. The schema must
// accept the old shape (the RPC coalesces absent keys to null).
const oldClientPayload = toAttemptPayload(test, responses, results, 'short', false, timesMs);
oldClientPayload.responses = oldClientPayload.responses.map((r) => {
  const clone = { ...r } as Record<string, unknown>;
  delete clone.timeMs;
  delete clone.figure;
  return clone as unknown as (typeof oldClientPayload.responses)[number];
});
assert(
  attemptPayloadSchema.safeParse(oldClientPayload).success,
  'old-client payload (no timeMs/figure keys) is ACCEPTED',
);

// --- Shared isAnswered predicate (audit A6) ---------------------------------
// The single "answered" rule used by the runner's unanswered counts, the
// navigator, Check-Your-Work, and (inverted) the review "skipped" badge. A
// cleared SPR entry ("" or whitespace) is unanswered; mcq index 0 is answered.
assert(isAnswered(0) === true, 'isAnswered(0) — mcq index 0 counts as answered');
assert(isAnswered(null) === false, 'isAnswered(null) — unanswered');
assert(isAnswered('') === false, 'isAnswered("") — cleared SPR is unanswered');
assert(isAnswered('   ') === false, 'isAnswered(whitespace) — blank SPR is unanswered');
assert(isAnswered('3/4') === true, 'isAnswered("3/4") — a typed SPR entry is answered');

console.log('\nALL CHECKS PASSED');

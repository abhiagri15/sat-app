// Scripted check for toPracticePayload + practicePayloadSchema — the project has
// no test runner (spec D8). Run: pnpm dlx tsx scripts/check-practice-payload.ts
import { toPracticePayload, type DrillResult } from '../app/lib/practice/payload';
import { practicePayloadSchema } from '../app/lib/practice/schema';
import type { Question } from '../app/lib/questions';

let count = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  count += 1;
  console.log('  ok —', msg);
}

// --- Fixture: 2 mcq (one right, one wrong) + 1 spr -------------------------
const mcqRight: Question = {
  id: 'q-mcq-1',
  section: 'math',
  skill: 'Linear Equations',
  prompt: 'If 3x + 7 = 22, what is x?',
  choices: ['3', '5', '7', '15'],
  answerIndex: 1,
  explanation: 'Subtract 7, divide by 3.',
  source: 'seed',
  response_format: 'mcq',
  correct_answer: null,
  answer_tolerance: null,
};
const mcqWrong: Question = {
  id: 'q-mcq-2',
  section: 'math',
  skill: 'Linear Equations',
  prompt: 'If 2(x - 4) = 10, what is x?',
  choices: ['7', '9', '3', '5'],
  answerIndex: 1,
  explanation: 'Divide by 2, add 4.',
  source: 'ai',
  response_format: 'mcq',
  correct_answer: null,
  answer_tolerance: null,
};
const spr: Question = {
  id: 'q-spr-1',
  section: 'math',
  skill: 'Linear Equations',
  prompt: 'What is 3 + 4?',
  choices: [],
  answerIndex: 0,
  explanation: 'Add.',
  source: 'ai',
  response_format: 'spr',
  correct_answer: '7',
  answer_tolerance: null,
};

// Sub-project #15: DrillResult.timeMs — one null (unmeasured), the rest set.
const results: DrillResult[] = [
  { question: mcqRight, chosenIndex: 1, enteredValue: null, isCorrect: true, timeMs: null },
  { question: mcqWrong, chosenIndex: 0, enteredValue: null, isCorrect: false, timeMs: 3300 },
  { question: spr, chosenIndex: -1, enteredValue: '7', isCorrect: true, timeMs: 5100 },
];

const payload = toPracticePayload('11111111-1111-4111-8111-111111111111', 'math', 'Linear Equations', results);

// --- Assertion 1: mapper output ---------------------------------------------
assert(payload.total === 3, `total === 3 (got ${payload.total})`);
assert(payload.correct === 2, `correct === 2 (got ${payload.correct})`);
assert(
  payload.responses.every((r, i) => r.position === i),
  'positions are 0,1,2 in order',
);

const r0 = payload.responses[0];
assert(r0.responseFormat === 'mcq', 'response[0] is mcq');
assert(r0.choices.length > 0, 'mcq response[0] choices non-empty');
assert(r0.enteredValue === null, 'mcq response[0] enteredValue === null');
assert(r0.correctAnswer === null, 'mcq response[0] correctAnswer === null');
assert(r0.chosenIndex === 1, 'mcq response[0] chosenIndex preserved (1)');

const r2 = payload.responses[2];
assert(r2.responseFormat === 'spr', 'response[2] is spr');
assert(Array.isArray(r2.choices) && r2.choices.length === 0, 'spr response[2] choices === []');
assert(r2.chosenIndex === -1, 'spr response[2] chosenIndex === -1');
assert(r2.correctAnswer === '7', 'spr response[2] correctAnswer present (from question)');
assert(r2.enteredValue === '7', 'spr response[2] enteredValue carried from result');

// --- Sub-project #15: timeMs (null when unmeasured) + figure null -----------
assert(r0.timeMs === null, 'mcq response[0] timeMs === null (unmeasured DrillResult)');
assert(payload.responses[1].timeMs === 3300, 'mcq response[1] timeMs === 3300 (measured)');
assert(r2.timeMs === 5100, 'spr response[2] timeMs === 5100 (measured)');
assert(
  payload.responses.every((r) => r.figure === null),
  'every response carries figure === null (no figure on these fixtures)',
);

// --- Assertion 2: schema ACCEPTS and preserves the wire fields --------------
const parsed = practicePayloadSchema.safeParse(payload);
assert(parsed.success, 'schema accepts the mapped payload');
if (parsed.success) {
  const p2 = parsed.data.responses[2] as Record<string, unknown>;
  assert(p2.responseFormat === 'spr', 'responseFormat preserved (not stripped by zod)');
  assert(p2.enteredValue === '7', 'enteredValue preserved (not stripped by zod)');
  assert(p2.correctAnswer === '7', 'correctAnswer preserved (not stripped by zod)');
  assert(p2.answerTolerance === null, 'answerTolerance preserved (not stripped by zod)');
  assert(p2.timeMs === 5100, 'timeMs preserved (not stripped by zod)');
  const p0 = parsed.data.responses[0] as Record<string, unknown>;
  assert(p0.timeMs === null, 'timeMs null preserved (not stripped by zod)');
  assert(
    parsed.data.responses.every((r) => (r as Record<string, unknown>).figure === null),
    'figure preserved (not stripped by zod)',
  );
}

// --- Assertion 3: schema REJECTS an mcq response with empty choices ---------
const badMcq = structuredClone(payload);
badMcq.responses[0] = { ...badMcq.responses[0], responseFormat: 'mcq', choices: [] };
assert(
  !practicePayloadSchema.safeParse(badMcq).success,
  'mcq response with empty choices is rejected',
);

// --- Assertion 4: schema REJECTS an empty responses array -------------------
const emptyResponses = { ...payload, responses: [] as typeof payload.responses };
assert(
  !practicePayloadSchema.safeParse(emptyResponses).success,
  'payload with responses: [] is rejected',
);

// --- Assertion 5: cap enforced — timeMs over TIME_MS_CAP is rejected --------
const overCap = structuredClone(payload);
overCap.responses[0] = { ...overCap.responses[0], timeMs: 600001 };
assert(
  !practicePayloadSchema.safeParse(overCap).success,
  'timeMs of 600001 (over TIME_MS_CAP) is rejected',
);

console.log(`\ncheck-practice-payload: ${count} assertions passed`);

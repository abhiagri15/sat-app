// Scripted check for the in-progress snapshot (mid-test crash recovery) —
// the project has no test runner. Exercises the PURE serialize/parse core:
// round-trip fidelity (incl. a figure inside a question, a timesMs matrix, and
// the marked array), version-mismatch rejection, garbage rejection, and
// missing-field rejection.
// Run: pnpm dlx tsx scripts/check-recovery.ts
import {
  serializeSnapshot,
  parseSnapshot,
  SNAPSHOT_VERSION,
  type SnapshotState,
} from '../app/lib/persistence/inprogress';
import type { Test } from '../app/lib/test';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('  ok —', msg);
}

// A small synthetic full test: one R&W section (Module 1 only, mid-flight) and
// one Math section carrying a FIGURE inside a question — the whole Test must
// serialize + round-trip (figures are the biggest payload risk).
const test: Test = {
  name: 'Recovery Student',
  length: 'full',
  sections: [
    {
      key: 'rw',
      name: 'Reading & Writing',
      modules: [
        {
          index: 0,
          timeLimit: 1920,
          questions: [
            {
              id: 'q-rw-1',
              section: 'rw',
              skill: 'Transitions',
              passage: 'A passage. ______ another sentence.',
              prompt: 'Which transition fits?',
              choices: ['However', 'Thus', 'Also', 'Then'],
              answerIndex: 0,
              explanation: 'Because contrast.',
              source: 'ai',
            },
          ],
        },
      ],
    },
    {
      key: 'math',
      name: 'Math',
      modules: [
        {
          index: 0,
          timeLimit: 2100,
          questions: [
            {
              id: 'q-math-1',
              section: 'math',
              skill: 'Linear Equations',
              prompt: 'What is x?',
              choices: ['1', '2', '3', '4'],
              answerIndex: 2,
              explanation: 'Solve it.',
              source: 'ai',
              figure: {
                kind: 'triangle',
                labels: { a: '3', b: '4', c: '5' },
                right: true,
              } as unknown as Test['sections'][number]['modules'][number]['questions'][number]['figure'],
            },
          ],
        },
      ],
    },
  ],
};

const state: SnapshotState = {
  testLength: 'full',
  studentName: 'Recovery Student',
  test,
  // 3-D response matrix parallel to the modules: one answered, one skipped.
  responses: [[[0]], [[null]]],
  // 3-D timesMs accumulator parallel to responses — a measured value survives.
  timesMs: [[[4200]], [[0]]],
  // Mark-for-review set, serialized as an array (module-scoped keys).
  marked: ['0-0-0'],
  secIdx: 1,
  modIdx: 0,
  qIdx: 0,
  remaining: [[1920], [1740]],
  breaksEnabled: true,
  breaksUsed: false,
  onBreak: false,
  breakRemaining: 600,
};

// --- round-trip: serialize → parse is lossless -------------------------------
const raw = serializeSnapshot(state, 1717000000000);
const round = parseSnapshot(raw);
assert(round !== null, 'round-trips to a non-null snapshot');
assert(round!.version === SNAPSHOT_VERSION, 'version stamped + preserved');
assert(round!.savedAt === 1717000000000, 'savedAt preserved (passed in, not generated)');
assert(round!.testLength === 'full', 'testLength preserved');
assert(round!.studentName === 'Recovery Student', 'studentName preserved');
assert(round!.test.sections.length === 2, 'both sections preserved');
assert(round!.test.sections[1].modules[0].questions[0].figure != null, 'figure survives the round-trip');
assert(
  (round!.test.sections[1].modules[0].questions[0].figure as { kind?: string }).kind === 'triangle',
  'figure kind preserved',
);
assert(round!.responses[0][0][0] === 0, 'answered response preserved');
assert(round!.responses[1][0][0] === null, 'skipped (null) response preserved');
assert(round!.timesMs[0][0][0] === 4200, 'measured timesMs preserved');
assert(round!.marked.length === 1 && round!.marked[0] === '0-0-0', 'marked array preserved');
assert(round!.secIdx === 1 && round!.modIdx === 0 && round!.qIdx === 0, 'position indices preserved');
assert(round!.remaining[1][0] === 1740, 'per-module remaining preserved');
assert(round!.breaksEnabled === true && round!.breaksUsed === false, 'break flags preserved');
assert(round!.onBreak === false && round!.breakRemaining === 600, 'mid-break flags preserved');

// --- a mid-break snapshot stores the PRE-advance secIdx -----------------------
const breakState: SnapshotState = { ...state, onBreak: true, breakRemaining: 480, secIdx: 0 };
const breakRound = parseSnapshot(serializeSnapshot(breakState, 1717000000001));
assert(breakRound !== null, 'mid-break snapshot round-trips');
assert(breakRound!.onBreak === true, 'onBreak true preserved');
assert(breakRound!.secIdx === 0, 'mid-break snapshot keeps the PRE-advance secIdx (0, not 1)');
assert(breakRound!.breakRemaining === 480, 'breakRemaining preserved');

// --- malformed / stale blobs return null, never throw ------------------------
assert(parseSnapshot(null) === null, 'null → null');
assert(parseSnapshot('') === null, 'empty string → null');
assert(parseSnapshot('not json{') === null, 'garbage (invalid JSON) → null');
assert(parseSnapshot('123') === null, 'non-object JSON → null');

// version-mismatch → null
const wrongVersion = JSON.parse(raw);
wrongVersion.version = SNAPSHOT_VERSION + 1;
assert(parseSnapshot(JSON.stringify(wrongVersion)) === null, 'wrong version → null');

// missing-field → null (drop the test)
const noTest = JSON.parse(raw);
delete noTest.test;
assert(parseSnapshot(JSON.stringify(noTest)) === null, 'missing test → null');

// missing-field → null (drop timesMs — omitting it silently zeroes pacing)
const noTimes = JSON.parse(raw);
delete noTimes.timesMs;
assert(parseSnapshot(JSON.stringify(noTimes)) === null, 'missing timesMs → null');

// missing-field → null (drop marked)
const noMarked = JSON.parse(raw);
delete noMarked.marked;
assert(parseSnapshot(JSON.stringify(noMarked)) === null, 'missing marked → null');

// wrong-shape → null (marked is not a string array)
const badMarked = JSON.parse(raw);
badMarked.marked = [1, 2, 3];
assert(parseSnapshot(JSON.stringify(badMarked)) === null, 'non-string marked entries → null');

// empty sections → null (nothing worth restoring)
const emptySections = JSON.parse(raw);
emptySections.test = { ...test, sections: [] };
assert(parseSnapshot(JSON.stringify(emptySections)) === null, 'empty test.sections → null');

console.log('\nALL CHECKS PASSED');

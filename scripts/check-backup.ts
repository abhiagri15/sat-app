// Scripted check for the pending-attempt backup envelope — no test runner here.
// Run: pnpm dlx tsx scripts/check-backup.ts
import { buildTest, computeResults } from '../app/lib/test';
import { toAttemptPayload } from '../app/lib/persistence/payload';
import {
  makePendingAttempt,
  serializePending,
  deserializePending,
} from '../app/lib/persistence/backup';
import type { ResponseValue } from '../app/lib/test';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('  ok —', msg);
}

const test = buildTest('Backup Student', 'short');
const responses: ResponseValue[][][] = test.sections.map((sec) =>
  sec.modules.map((mod) => mod.questions.map((q) => q.answerIndex)),
);
const results = computeResults(test, responses);
const payload = toAttemptPayload(test, responses, results, 'short');

// --- round-trip: serialize → deserialize is lossless -------------------------
const pending = makePendingAttempt(payload, 'uuid-abc', 1717000000000);
const round = deserializePending(serializePending(pending));
assert(round !== null, 'round-trips to a non-null pending attempt');
assert(round!.attemptUuid === 'uuid-abc', 'attemptUuid preserved');
assert(round!.savedAtMs === 1717000000000, 'savedAtMs preserved');
assert(round!.payload.responses.length === payload.responses.length, 'response count preserved');
assert(round!.payload.studentName === 'Backup Student', 'studentName preserved');
assert(round!.payload.scaledScore === payload.scaledScore, 'scaledScore preserved');

// --- malformed / stale blobs return null, never throw ------------------------
assert(deserializePending(null) === null, 'null → null');
assert(deserializePending('') === null, 'empty string → null');
assert(deserializePending('not json{') === null, 'invalid JSON → null');
assert(deserializePending('123') === null, 'non-object JSON → null');
assert(deserializePending(JSON.stringify({ version: 999, attemptUuid: 'x', savedAtMs: 1, payload }))
  === null, 'wrong version → null');
assert(deserializePending(JSON.stringify({ version: 1, savedAtMs: 1, payload })) === null,
  'missing attemptUuid → null');
assert(
  deserializePending(JSON.stringify({ version: 1, attemptUuid: 'x', savedAtMs: 1, payload: { responses: [] } }))
    === null,
  'empty responses → null (nothing worth resaving)',
);
assert(
  deserializePending(JSON.stringify({ version: 1, attemptUuid: 'x', savedAtMs: 1 })) === null,
  'missing payload → null',
);

console.log('\nALL CHECKS PASSED');

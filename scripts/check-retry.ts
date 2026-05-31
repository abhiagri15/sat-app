// Scripted check for the save retry policy — no test runner in this project.
// Run: pnpm dlx tsx scripts/check-retry.ts
import {
  classifyError,
  isRetryable,
  computeBackoffMs,
  withRetry,
} from '../app/lib/persistence/retry';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('  ok —', msg);
}

// --- classifyError: maps the stable RPC raise messages -----------------------
assert(classifyError('invalid payload') === 'invalid_payload', 'invalid payload → invalid_payload');
assert(classifyError('daily attempt limit reached') === 'daily_limit', 'daily limit → daily_limit');
assert(classifyError('no responses') === 'no_responses', 'no responses → no_responses');
assert(classifyError('not authenticated') === 'not_authenticated', 'not authenticated → not_authenticated');
assert(classifyError('TypeError: Failed to fetch') === 'transient', 'network error → transient');
assert(classifyError('') === 'transient', 'empty → transient');
assert(classifyError(null) === 'transient', 'null → transient');
assert(classifyError('NOT AUTHENTICATED') === 'not_authenticated', 'case-insensitive match');

// --- isRetryable: only transient is worth retrying ---------------------------
assert(isRetryable('transient'), 'transient is retryable');
assert(!isRetryable('invalid_payload'), 'invalid_payload is terminal');
assert(!isRetryable('daily_limit'), 'daily_limit is terminal');
assert(!isRetryable('no_responses'), 'no_responses is terminal');
assert(!isRetryable('not_authenticated'), 'not_authenticated is terminal');

// --- computeBackoffMs: grows, jitters within 50%–100%, caps ------------------
const zero = computeBackoffMs(1, 400, 8000, () => 0);
const one = computeBackoffMs(1, 400, 8000, () => 1);
assert(zero === 200, `attempt 1 floor (rand=0) === 200 (got ${zero})`);
assert(one === 400, `attempt 1 ceil (rand=1) === 400 (got ${one})`);
assert(computeBackoffMs(2, 400, 8000, () => 1) === 800, 'attempt 2 ceil === 800');
assert(computeBackoffMs(10, 400, 8000, () => 1) === 8000, 'large attempt caps at capMs');

async function main(): Promise<void> {
  // --- withRetry: succeeds first try -----------------------------------------
  {
    let calls = 0;
    const r = await withRetry(async () => {
      calls++;
      return { ok: true as const, value: 'id-1' };
    }, { sleep: async () => {} });
    assert(r.ok && r.value === 'id-1' && r.attempts === 1, 'success on first attempt, no retry');
    assert(calls === 1, 'attempt fn called exactly once on success');
  }

  // --- withRetry: transient then success -------------------------------------
  {
    let calls = 0;
    const retried: number[] = [];
    const r = await withRetry<string>(async () => {
      calls++;
      if (calls < 3) return { ok: false as const, error: 'Failed to fetch' };
      return { ok: true as const, value: 'id-2' };
    }, { sleep: async () => {}, onRetry: (i) => retried.push(i.attempt) });
    assert(r.ok && r.value === 'id-2', 'recovers after 2 transient failures');
    assert(r.attempts === 3, `made 3 attempts (got ${r.attempts})`);
    assert(retried.length === 2, 'onRetry fired for each of the 2 retries');
  }

  // --- withRetry: terminal failure stops immediately -------------------------
  {
    let calls = 0;
    const r = await withRetry(async () => {
      calls++;
      return { ok: false as const, error: 'daily attempt limit reached' };
    }, { sleep: async () => {} });
    assert(!r.ok && r.code === 'daily_limit', 'terminal failure surfaces its code');
    assert(calls === 1, 'terminal failure is NOT retried (called once)');
  }

  // --- withRetry: exhausts attempts on persistent transient ------------------
  {
    let calls = 0;
    const r = await withRetry(async () => {
      calls++;
      return { ok: false as const, error: 'service unavailable' };
    }, { sleep: async () => {}, maxAttempts: 4 });
    assert(!r.ok && r.code === 'transient', 'persistent transient stays transient');
    assert(calls === 4 && r.attempts === 4, `exhausts maxAttempts (got ${calls})`);
  }

  // --- withRetry: a thrown exception is treated as transient -----------------
  {
    let calls = 0;
    const r = await withRetry<string>(async () => {
      calls++;
      if (calls === 1) throw new Error('network down');
      return { ok: true as const, value: 'id-3' };
    }, { sleep: async () => {} });
    assert(r.ok && r.value === 'id-3', 'thrown error retried then recovered');
    assert(calls === 2, 'threw once, succeeded on retry');
  }

  console.log('\nALL CHECKS PASSED');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

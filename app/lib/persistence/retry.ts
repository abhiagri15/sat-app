// Retry policy for the attempt-save path.
//
// The save was previously a single fire-and-forget call: any transient failure
// (mobile network blip, serverless cold-start, a brief Supabase hiccup, a
// token-refresh race) permanently destroyed a just-finished test. This module
// is the pure decision layer — WHICH failures are worth retrying, and HOW long
// to wait between tries. The orchestration lives in useTestSession; the I/O
// lives in the saveAttempt server action. Keep this file side-effect-free so
// scripts/check-retry.ts can exercise it without a runtime.

// Coarse failure classification. Terminal failures will NEVER succeed on a
// blind retry (the input or the account state is the problem), so retrying
// just delays the inevitable and wastes the student's time. Everything else
// is treated as transient and is worth retrying.
//
// Mirrors the raise messages in sat.save_attempt and the guard in the
// saveAttempt server action. If you add a new deterministic raise to the RPC,
// add its message fragment here.
export type SaveErrorCode =
  | 'invalid_payload'        // zod rejected the wire shape — re-sending is pointless
  | 'daily_limit'            // 'daily attempt limit reached' — retry won't change the count
  | 'no_responses'           // 'no responses' — empty payload, a code bug not a blip
  | 'not_authenticated'      // 'not authenticated' — no session; an immediate retry can't mint one
  | 'transient';             // network / 5xx / unknown — worth retrying

const TERMINAL_CODES: ReadonlySet<SaveErrorCode> = new Set<SaveErrorCode>([
  'invalid_payload',
  'daily_limit',
  'no_responses',
  'not_authenticated',
]);

// Map a raw error string (from supabase-js / the RPC / our own action) to a
// coarse code. Case-insensitive substring match — the RPC messages are stable
// literals (see sat.save_attempt).
export function classifyError(raw: string | null | undefined): SaveErrorCode {
  const s = (raw ?? '').toLowerCase();
  if (s.includes('invalid payload')) return 'invalid_payload';
  if (s.includes('daily attempt limit')) return 'daily_limit';
  if (s.includes('no responses')) return 'no_responses';
  if (s.includes('not authenticated')) return 'not_authenticated';
  return 'transient';
}

export function isRetryable(code: SaveErrorCode): boolean {
  return !TERMINAL_CODES.has(code);
}

// Exponential backoff with full jitter, capped. attempt is 1-indexed
// (the delay BEFORE the 2nd try is computeBackoffMs(1, ...)). `rand` is
// injectable so the check script is deterministic; defaults to Math.random.
export function computeBackoffMs(
  attempt: number,
  baseMs = 400,
  capMs = 8000,
  rand: () => number = Math.random,
): number {
  const exp = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  return Math.round(exp * (0.5 + 0.5 * rand())); // 50%–100% of the window
}

export interface RetryResult<T> {
  ok: boolean;
  value?: T;
  code?: SaveErrorCode;
  error?: string;
  attempts: number; // how many tries were actually made
}

// Runs `attempt` up to maxAttempts times. `attempt` returns a discriminated
// result: { ok:true, value } on success, or { ok:false, error } on a handled
// failure. A thrown exception is treated as a transient failure. Stops early
// on success or on a terminal (non-retryable) failure. `sleep` and `onRetry`
// are injectable for testing / progress UI.
export async function withRetry<T>(
  attempt: () => Promise<{ ok: true; value: T } | { ok: false; error: string }>,
  opts: {
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
    backoff?: (attempt: number) => number;
    onRetry?: (info: { attempt: number; code: SaveErrorCode; error: string }) => void;
  } = {},
): Promise<RetryResult<T>> {
  const maxAttempts = opts.maxAttempts ?? 4;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const backoff = opts.backoff ?? ((a) => computeBackoffMs(a));

  let lastError = 'unknown error';
  let lastCode: SaveErrorCode = 'transient';

  for (let n = 1; n <= maxAttempts; n++) {
    let res: { ok: true; value: T } | { ok: false; error: string };
    try {
      res = await attempt();
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
    if (res.ok) return { ok: true, value: res.value, attempts: n };

    lastError = res.error;
    lastCode = classifyError(res.error);
    if (!isRetryable(lastCode) || n === maxAttempts) {
      return { ok: false, code: lastCode, error: lastError, attempts: n };
    }
    opts.onRetry?.({ attempt: n, code: lastCode, error: lastError });
    await sleep(backoff(n));
  }
  // Unreachable (loop returns), but satisfies the type checker.
  return { ok: false, code: lastCode, error: lastError, attempts: maxAttempts };
}

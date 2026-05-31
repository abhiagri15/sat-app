// Local backup of a finished-but-not-yet-saved attempt.
//
// The attempt lives only in React state until sat.save_attempt persists it.
// If the save fails (and retries are exhausted) or the tab closes mid-save,
// that completed test is gone. So on submit we stash the exact save payload in
// localStorage; we clear it once the server confirms the save. On the next app
// load, useTestSession sees the leftover and auto-resaves it — surviving
// network loss, serverless cold-starts, and tab closes.
//
// The serialize/deserialize core is pure (script-tested). The read/write/clear
// wrappers touch localStorage and are deliberately defensive: Safari private
// mode throws on setItem, quota can be exceeded, and SSR has no window.

import type { AttemptPayload } from './payload';

const STORAGE_KEY = 'sat:pending-attempt:v1';
const ENVELOPE_VERSION = 1;

export interface PendingAttempt {
  version: number;
  attemptUuid: string; // client-generated; correlates backup ↔ save_failures rows
  savedAtMs: number;   // when the attempt was finished (client clock)
  payload: AttemptPayload;
}

// Pure: wrap a payload in the storage envelope. attemptUuid + savedAtMs are
// passed in (not generated here) so the core stays deterministic for tests.
export function makePendingAttempt(
  payload: AttemptPayload,
  attemptUuid: string,
  savedAtMs: number,
): PendingAttempt {
  return { version: ENVELOPE_VERSION, attemptUuid, savedAtMs, payload };
}

export function serializePending(p: PendingAttempt): string {
  return JSON.stringify(p);
}

// Pure: parse + validate the envelope. Returns null for anything malformed,
// wrong-version, or missing the core fields — a stale/corrupt blob must never
// crash the app or trigger a bogus resave.
export function deserializePending(raw: string | null): PendingAttempt | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (o.version !== ENVELOPE_VERSION) return null;
  if (typeof o.attemptUuid !== 'string' || o.attemptUuid.length === 0) return null;
  if (typeof o.savedAtMs !== 'number') return null;
  const payload = o.payload as AttemptPayload | undefined;
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray(payload.responses) ||
    payload.responses.length === 0
  ) {
    return null;
  }
  return { version: ENVELOPE_VERSION, attemptUuid: o.attemptUuid, savedAtMs: o.savedAtMs, payload };
}

// --- localStorage wrappers (client-only, all failures swallowed) -------------

export function writePendingAttempt(p: PendingAttempt): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, serializePending(p));
  } catch {
    // Private mode / quota exceeded — backup is best-effort. The in-memory
    // retry path still runs; we just can't survive a tab close in this browser.
  }
}

export function readPendingAttempt(): PendingAttempt | null {
  if (typeof window === 'undefined') return null;
  try {
    return deserializePending(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearPendingAttempt(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

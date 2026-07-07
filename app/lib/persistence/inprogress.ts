// Local snapshot of an IN-PROGRESS full/short test (mid-test crash recovery).
//
// A closed tab (or a crash) mid-test used to lose the whole attempt — the test
// lived only in React state. So at every state-commit point the hook writes a
// JSON snapshot of the entire in-memory test to localStorage; on the next app
// load the start screen offers to resume it. The snapshot is cleared the moment
// the test finishes (results) — a snapshot NEVER coexists with the finished-
// attempt backup (`sat:pending-attempt:v1`).
//
// This mirrors the pending-attempt backup discipline (backup.ts): the
// serialize/parse core is pure (script-tested via scripts/check-recovery.ts),
// and the localStorage wrappers are deliberately defensive — Safari private
// mode throws on setItem, quota can be exceeded, and SSR has no window. A quota
// error must NEVER break the running test, so writes swallow all failures.

import type { ResponseValue, Test, TestLength } from '@/app/lib/test';

export const INPROGRESS_KEY = 'sat:inprogress-test:v1';
export const SNAPSHOT_VERSION = 1;

// The full in-progress test state. The field list is EXACT (spec §B): omitting
// `timesMs` silently zeroes pacing analytics for the whole resumed test;
// `marked` is stored as an array (Set isn't JSON-serializable). `moduleReview`
// is deliberately NOT snapshotted — restore always lands on the question view
// (the #16 auto-close effect forces it anyway). `module2Path` per section lives
// inside `test.sections[i].module2Path`, so it rides along in `test`.
export interface InProgressSnapshot {
  version: number;
  savedAt: number;        // client clock (ms) at write time — freshness gate
  testLength: TestLength;
  studentName: string;
  test: Test;             // the full in-memory test, questions incl. figures
  responses: ResponseValue[][][];
  timesMs: number[][][];  // timesMsRef.current — omit and pacing zeroes out
  marked: string[];       // the mark-for-review Set, serialized as an array
  secIdx: number;
  modIdx: number;
  qIdx: number;
  remaining: number[][];  // per-module remaining seconds [section][module]
  breaksEnabled: boolean;
  breaksUsed: boolean;
  // Mid-break flags. When `onBreak` is true the snapshot was taken during the
  // mandatory between-section break: `secIdx` is the PRE-advance index (the
  // just-finished R&W index) — resumeFromBreak() does the +1 advance itself, so
  // storing the post-advance index would double-advance on resume.
  onBreak: boolean;
  breakRemaining: number;
}

// The minimal shape the hook needs to build the restore state. Kept separate
// from the write side so `serializeSnapshot` can take the live pieces directly.
export interface SnapshotState {
  testLength: TestLength;
  studentName: string;
  test: Test;
  responses: ResponseValue[][][];
  timesMs: number[][][];
  marked: string[];
  secIdx: number;
  modIdx: number;
  qIdx: number;
  remaining: number[][];
  breaksEnabled: boolean;
  breaksUsed: boolean;
  onBreak: boolean;
  breakRemaining: number;
}

// Pure: build the snapshot envelope + serialize. `savedAt` is passed in (not
// generated here) so the core stays deterministic for the check script.
export function serializeSnapshot(state: SnapshotState, savedAt: number): string {
  const snap: InProgressSnapshot = {
    version: SNAPSHOT_VERSION,
    savedAt,
    testLength: state.testLength,
    studentName: state.studentName,
    test: state.test,
    responses: state.responses,
    timesMs: state.timesMs,
    marked: state.marked,
    secIdx: state.secIdx,
    modIdx: state.modIdx,
    qIdx: state.qIdx,
    remaining: state.remaining,
    breaksEnabled: state.breaksEnabled,
    breaksUsed: state.breaksUsed,
    onBreak: state.onBreak,
    breakRemaining: state.breakRemaining,
  };
  return JSON.stringify(snap);
}

// Pure: parse + validate. Returns null for anything malformed, wrong-version,
// or missing/mis-shaped a required field — a stale/corrupt blob must never
// crash the app or drive a bogus restore. Version mismatch → null (treat as
// absent; the caller clears it).
export function parseSnapshot(raw: string | null): InProgressSnapshot | null {
  if (!raw) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;
  if (o.version !== SNAPSHOT_VERSION) return null;
  if (typeof o.savedAt !== 'number') return null;
  if (o.testLength !== 'short' && o.testLength !== 'full') return null;
  if (typeof o.studentName !== 'string') return null;
  // The test must be present and shaped like a Test (a sections array).
  const test = o.test as Test | undefined;
  if (
    !test ||
    typeof test !== 'object' ||
    !Array.isArray(test.sections) ||
    test.sections.length === 0
  ) {
    return null;
  }
  if (!Array.isArray(o.responses)) return null;
  if (!Array.isArray(o.timesMs)) return null;
  if (!Array.isArray(o.marked) || !o.marked.every((m) => typeof m === 'string')) return null;
  if (typeof o.secIdx !== 'number' || typeof o.modIdx !== 'number' || typeof o.qIdx !== 'number') {
    return null;
  }
  if (!Array.isArray(o.remaining)) return null;
  if (typeof o.breaksEnabled !== 'boolean' || typeof o.breaksUsed !== 'boolean') return null;
  if (typeof o.onBreak !== 'boolean' || typeof o.breakRemaining !== 'number') return null;
  return {
    version: SNAPSHOT_VERSION,
    savedAt: o.savedAt,
    testLength: o.testLength,
    studentName: o.studentName,
    test,
    responses: o.responses as ResponseValue[][][],
    timesMs: o.timesMs as number[][][],
    marked: o.marked as string[],
    secIdx: o.secIdx,
    modIdx: o.modIdx,
    qIdx: o.qIdx,
    remaining: o.remaining as number[][],
    breaksEnabled: o.breaksEnabled,
    breaksUsed: o.breaksUsed,
    onBreak: o.onBreak,
    breakRemaining: o.breakRemaining,
  };
}

// --- localStorage wrappers (client-only, all failures swallowed) -------------

export function writeSnapshot(raw: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(INPROGRESS_KEY, raw);
  } catch {
    // Private mode / quota exceeded — recovery is best-effort. A write failure
    // must NEVER break the running test, so we silently skip it.
  }
}

export function readSnapshot(): InProgressSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    return parseSnapshot(window.localStorage.getItem(INPROGRESS_KEY));
  } catch {
    return null;
  }
}

export function clearSnapshot(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(INPROGRESS_KEY);
  } catch {
    // ignore
  }
}

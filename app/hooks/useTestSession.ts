'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  appendModule2,
  buildTest,
  computeResults,
  TIME_MS_CAP,
  type Results,
  type ResponseValue,
  type Test,
  type TestLength,
} from '@/app/lib/test';
import { drawShortTest, drawFullTestModule1, drawModule2 } from '@/app/lib/pool';
import { SECTION_CONFIG, type SectionKey } from '@/app/lib/questions';
import { isSprCorrect } from '@/app/lib/spr';
import { toAttemptPayload, type AttemptPayload } from '@/app/lib/persistence/payload';
import { saveAttempt } from '@/app/lib/persistence/actions';
import { withRetry } from '@/app/lib/persistence/retry';
import {
  makePendingAttempt,
  writePendingAttempt,
  readPendingAttempt,
  clearPendingAttempt,
} from '@/app/lib/persistence/backup';
import {
  serializeSnapshot,
  writeSnapshot,
  readSnapshot,
  clearSnapshot,
  type InProgressSnapshot,
  type SnapshotState,
} from '@/app/lib/persistence/inprogress';
import { getModule2ThresholdPct } from '@/app/lib/config-actions';

// Max age of an in-progress snapshot the start screen will offer to resume.
// Older than this and we treat it as absent (and clear it) — a day-old
// half-finished test is noise, not a save.
const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours

// Throttle for in-progress snapshot writes: at most one per this interval.
// The crash-adjacent moments (tab hide / pagehide) bypass this and write
// immediately.
const SNAPSHOT_THROTTLE_MS = 2000;

// A v4-ish unique id for correlating a backup with its save_failures rows.
// crypto.randomUUID needs a secure context; fall back for the rare case it's
// missing so a finished test is never blocked from being saved.
function newAttemptUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `att-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

export type Screen = 'start' | 'test' | 'break' | 'results';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

// A summary of a resumable in-progress test, shown on the start screen. Derived
// from the persisted snapshot — enough to describe the "Resume your test?" card
// (length, current section, time remaining, saved-when) without exposing the
// whole Test.
export interface SnapshotSummary {
  testLength: TestLength;
  sectionName: string;   // the section the student was on
  remainingSeconds: number; // remaining on the current module (or break)
  onBreak: boolean;
  savedAt: number;       // client clock (ms) at save time
}

// The mandatory between-section break duration (seconds) — matches the real
// Digital SAT's 10-minute break between Reading & Writing and Math.
const BREAK_SECONDS = 600;

export interface TestSession {
  // state
  screen: Screen;
  name: string;
  setName: (s: string) => void;
  testLength: TestLength;
  setTestLength: (l: TestLength) => void;
  breaksEnabled: boolean;
  setBreaksEnabled: (b: boolean) => void;
  paused: boolean;
  pause: () => void;
  resume: () => void;
  breaksUsed: boolean;
  // Mandatory between-section break (full tests only): remaining seconds on the
  // break's OWN countdown, and the action to end it early. When the break
  // countdown reaches 0 the section advance fires automatically.
  breakRemaining: number;
  resumeFromBreak: () => void;
  // Full-test assembly failure surfaced on the start screen (short tests keep
  // the BANK fallback and never set this). Cleared on the next start().
  startError: string | null;
  // Module-2 mid-test assembly failure surfaced as an in-test overlay after an
  // automatic retry also fails; null unless errored. Retry with retryModule2().
  module2Error: string | null;
  retryModule2: () => void;
  test: Test | null;
  secIdx: number;
  modIdx: number;
  qIdx: number;
  // Mark-for-review (sub-project #16). UI-only, never persisted. Keyed
  // "${secIdx}-${modIdx}-${qIdx}" so marks are module-scoped (a module's
  // Check-Your-Work only reads its own keys — nothing carries across modules or
  // sections, matching Bluebook). Reset in start()/newTest(). NOT the post-test
  // results review (that is showReview/toggleReview).
  marked: Set<string>;
  toggleMarked: () => void;
  // The in-test "Check your work" page shown before a module is submitted. The
  // section countdown keeps running while it is open (authentic). Auto-closes on
  // every boundary via one effect.
  moduleReview: boolean;
  openModuleReview: () => void;
  closeModuleReview: (qi?: number) => void;
  // Per-question answer matrix, 3-D: [section][module][question].
  // mcq cells hold the chosen choice index (number); SPR cells hold the
  // entered string. null = unanswered.
  responses: ResponseValue[][][];
  // Per-module remaining seconds: [section][module].
  remaining: number[][];
  showReview: boolean;
  toggleReview: () => void;
  loading: boolean;
  saveStatus: SaveStatus;
  // The real error message from the last failed save (RPC/network), surfaced
  // so it can be shown/reported instead of being swallowed. null unless errored.
  saveError: string | null;
  // Re-runs the save from the in-memory payload after a failure. No-op if there
  // is nothing pending.
  retrySave: () => void;
  // Background resave of a localStorage-backed attempt left over from a prior
  // session (e.g. the tab closed before the save completed).
  resaveStatus: SaveStatus;
  sessionCompletions: number; // tests submitted this browser session
  // Mid-test crash recovery (spec §B). A resumable in-progress snapshot found
  // on the start screen (null when none / stale / corrupt). resumeSnapshot()
  // rehydrates the hook exactly as saved and enters 'test' (or 'break');
  // discardSnapshot() clears it.
  pendingSnapshot: SnapshotSummary | null;
  resumeSnapshot: () => void;
  discardSnapshot: () => void;
  // actions
  start: () => void;
  // Records the user's answer for the current question. number for mcq
  // (the chosen choice index), string for SPR (the typed entry).
  setAnswer: (value: number | string) => void;
  goToQuestion: (qi: number) => void;
  // Replaces submitSection. For short tests this behaves like the old
  // section submit; for full tests it routes Module 1 → Module 2 (with
  // a lazy pool draw) on first call, then finalises the section.
  submitModule: () => void;
  newTest: () => void;
  results: Results | null;
}

export function useTestSession(initialName = ''): TestSession {
  const [screen, setScreen] = useState<Screen>('start');
  const [name, setName] = useState(initialName);
  const [testLength, setTestLength] = useState<TestLength>('full');
  const [breaksEnabled, setBreaksEnabled] = useState(false);
  const [paused, setPaused] = useState(false);
  const [breaksUsed, setBreaksUsed] = useState(false);
  // Mandatory break countdown (full tests, R&W → Math). Runs on its own
  // interval (breakTickRef) — never the section countdown.
  const [breakRemaining, setBreakRemaining] = useState(BREAK_SECONDS);
  const [startError, setStartError] = useState<string | null>(null);
  const [module2Error, setModule2Error] = useState<string | null>(null);

  const [test, setTest] = useState<Test | null>(null);
  const [secIdx, setSecIdx] = useState(0);
  const [modIdx, setModIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [responses, setResponses] = useState<ResponseValue[][][]>([]);
  const [remaining, setRemaining] = useState<number[][]>([]);
  // Mark-for-review set (keyed by "${secIdx}-${modIdx}-${qIdx}") and the
  // Check-Your-Work page flag. Both UI-only; see the interface docs.
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [moduleReview, setModuleReview] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [resaveStatus, setResaveStatus] = useState<SaveStatus>('idle');
  // The payload + correlation id for the current results screen, kept so
  // retrySave() can re-fire without recomputing from state.
  const pendingPayloadRef = useRef<{ payload: AttemptPayload; attemptUuid: string } | null>(null);
  // Guards the mount resave so React Strict Mode's double-invoke (dev) can't
  // fire two concurrent resaves of the same backed-up attempt.
  const resaveStartedRef = useRef(false);
  // Tests submitted this session — added to the server-rendered daily count so
  // the Start screen's limit gate stays accurate without a page reload.
  // Deliberately NOT reset by newTest(): it accumulates for the whole session.
  const [sessionCompletions, setSessionCompletions] = useState(0);
  // Guards the save effect so a submitted test is persisted exactly once.
  // (`saveStatus` is its render-visible counterpart.)
  const savedRef = useRef(false);
  // The section + routing path for the in-flight Module-2 draw, kept so the
  // in-test error overlay's manual Retry can replay it without recomputing the
  // routing decision. Set before the draw; cleared on success.
  const module2ParamsRef = useRef<{ secIdx: number; key: SectionKey; path: 'easier' | 'harder' } | null>(null);

  // Mid-test crash recovery (spec §B). The resumable snapshot summary shown on
  // the start screen (found once at mount). The full snapshot is stashed in a
  // ref so resumeSnapshot() can rehydrate without re-reading localStorage.
  const [pendingSnapshot, setPendingSnapshot] = useState<SnapshotSummary | null>(null);
  const pendingSnapshotRef = useRef<InProgressSnapshot | null>(null);
  // Single-fire guard for the mount restore check (Strict-Mode double-invoke).
  const restoreCheckedRef = useRef(false);
  // Last snapshot write time (ms) for the ≤1-per-2s throttle. -Infinity so the
  // first write always fires.
  const lastSnapshotAtRef = useRef(-Infinity);
  // While true, the snapshot write effect is suppressed. Set during resume so a
  // rehydrated test doesn't immediately re-serialize before it has settled; the
  // effect clears it on its first pass.
  const suppressSnapshotRef = useRef(false);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // The break countdown runs on its OWN interval, entirely separate from the
  // section countdown (tickRef). It must never mutate remaining[][].
  const breakTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sub-project #15 per-question timing. `timesMsRef` is a 3-D accumulator
  // parallel to `responses` ([section][module][question]) holding total
  // active-display milliseconds per question, accumulated across revisits and
  // capped at TIME_MS_CAP each. It lives in a ref (not state) because it is
  // never rendered — it is read once at save time. The stopwatch itself is a
  // single "active question + started-at" record: NOT the countdown interval
  // (which is untouched), just Date.now() deltas committed at the stop points
  // (question nav / module submit / pause / break / results). paused freezes it
  // the same way it freezes the countdown — while paused no question is active.
  const timesMsRef = useRef<number[][][]>([]);
  const activeQuestionRef = useRef<{ si: number; mi: number; qi: number; startedAt: number } | null>(
    null,
  );

  // Stop the stopwatch and accumulate the elapsed ms into the active question's
  // cell (capped). Idempotent — a second call with no active question is a
  // no-op, so overlapping stop points (e.g. pause racing a nav) are safe.
  const commitStopwatch = useCallback(() => {
    const active = activeQuestionRef.current;
    activeQuestionRef.current = null;
    if (!active) return;
    const elapsed = Date.now() - active.startedAt;
    if (!(elapsed > 0)) return;
    const matrix = timesMsRef.current;
    const cell = matrix[active.si]?.[active.mi];
    if (!cell || active.qi >= cell.length) return;
    cell[active.qi] = Math.min(TIME_MS_CAP, (cell[active.qi] ?? 0) + elapsed);
  }, []);

  // (Re)start the stopwatch for a given question. Commits any currently-active
  // question first so no time is dropped when moving directly between two
  // displayed questions.
  const startStopwatch = useCallback(
    (si: number, mi: number, qi: number) => {
      commitStopwatch();
      activeQuestionRef.current = { si, mi, qi, startedAt: Date.now() };
    },
    [commitStopwatch],
  );

  const stopTimer = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const stopBreakTimer = useCallback(() => {
    if (breakTickRef.current) {
      clearInterval(breakTickRef.current);
      breakTickRef.current = null;
    }
  }, []);

  // Cleanup on unmount — both intervals.
  useEffect(() => {
    return () => {
      stopTimer();
      stopBreakTimer();
    };
  }, [stopTimer, stopBreakTimer]);

  // Drive the countdown whenever we're on the test screen / change section / module.
  useEffect(() => {
    if (screen !== 'test' || paused) return;
    stopTimer();
    tickRef.current = setInterval(() => {
      setRemaining((prev) => {
        const next = prev.map((arr) => arr.slice());
        const row = next[secIdx];
        if (!row) return prev;
        if ((row[modIdx] ?? 0) > 0) row[modIdx] -= 1;
        if ((row[modIdx] ?? 0) <= 0) {
          // Defer the advance to avoid setState mid-render of the parent tree.
          setTimeout(() => handleTimeUp(), 0);
        }
        return next;
      });
    }, 1000);
    return stopTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, secIdx, modIdx, paused]);

  // Drive the mandatory-break countdown on its OWN interval whenever we're on
  // the break screen. Entirely independent of the section countdown (tickRef):
  // it only mutates breakRemaining, never remaining[][]. Auto-advances to the
  // next section when it reaches zero, then cleans itself up.
  useEffect(() => {
    if (screen !== 'break') return;
    stopBreakTimer();
    breakTickRef.current = setInterval(() => {
      setBreakRemaining((r) => {
        if (r <= 1) {
          // Defer the advance to avoid setState mid-render of the parent tree
          // (same discipline as handleTimeUp).
          setTimeout(() => resumeFromBreak(), 0);
          return 0;
        }
        return r - 1;
      });
    }, 1000);
    return stopBreakTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // Sub-project #15: drive the per-question stopwatch off the SAME display
  // signals as the UI. When a question is on screen (test + not paused), the
  // stopwatch runs for the current (secIdx, modIdx, qIdx); it (re)starts on any
  // change to that tuple — question navigation, module submit (modIdx/secIdx
  // move), or a Module-2 append that flips modIdx to 1. Whenever we leave that
  // condition (pause, entering the break, or landing on results/start), the
  // cleanup commits the elapsed time. This is Date.now() deltas in a ref — it
  // never touches the countdown interval. The final commit before save is also
  // done explicitly in finish() (belt-and-suspenders against unmount ordering).
  // #16: opening the Check-Your-Work page (moduleReview) also commits+stops the
  // stopwatch — review time must accrue to NO question (the countdown keeps
  // running, but no single question is on screen), else it corrupts pacing.
  useEffect(() => {
    if (screen !== 'test' || paused || moduleReview) return;
    startStopwatch(secIdx, modIdx, qIdx);
    return commitStopwatch;
  }, [screen, paused, moduleReview, secIdx, modIdx, qIdx, startStopwatch, commitStopwatch]);

  // #16: auto-close the Check-Your-Work page on EVERY boundary via ONE effect.
  // The module/section advances live in five scattered paths (short-test
  // advance, finish, the async Module-2 draw that flips modIdx, break entry, and
  // resumeFromBreak) — per-site resets would leak, so this single effect keyed
  // on the boundary tuple covers all of them (Module 2 must never start under a
  // stale review page).
  useEffect(() => {
    setModuleReview(false);
  }, [secIdx, modIdx, screen]);

  // --- Mid-test crash recovery: write points (spec §B) -----------------------
  // Build the SnapshotState from live state. Break semantics: a mid-break
  // snapshot stores the PRE-advance secIdx (the just-finished R&W index) —
  // resumeFromBreak() does the +1 advance itself, so storing the post-advance
  // index would double-advance on resume. The break is entered BEFORE secIdx
  // advances, so `secIdx` is already the pre-advance index while screen ===
  // 'break' — we store it as-is. `marked` is serialized as an array (from the
  // Set). `moduleReview` is deliberately not captured (restore lands on the
  // question view). Returns null when there's nothing to snapshot.
  const buildSnapshotState = useCallback((): SnapshotState | null => {
    if (!test) return null;
    return {
      testLength,
      studentName: test.name,
      test,
      responses,
      timesMs: timesMsRef.current,
      marked: Array.from(marked),
      secIdx,
      modIdx,
      qIdx,
      remaining,
      breaksEnabled,
      breaksUsed,
      onBreak: screen === 'break',
      breakRemaining,
    };
  }, [
    test, testLength, responses, marked, secIdx, modIdx, qIdx, remaining,
    breaksEnabled, breaksUsed, screen, breakRemaining,
  ]);

  // Write the snapshot immediately (unthrottled) — used at the crash-adjacent
  // moments (tab hide / pagehide). Never writes during an in-flight Module-2
  // draw (`loading`): the module2ParamsRef state isn't serializable and the
  // pre-submit snapshot already covers it. try/catch lives in writeSnapshot —
  // a quota error must never break the test.
  const flushSnapshot = useCallback(() => {
    if (loading) return;
    if (screen !== 'test' && screen !== 'break') return;
    const state = buildSnapshotState();
    if (!state) return;
    lastSnapshotAtRef.current = Date.now();
    writeSnapshot(serializeSnapshot(state, Date.now()));
  }, [loading, screen, buildSnapshotState]);

  // Throttled snapshot write at the state-commit points. This effect fires on
  // every committed change to the snapshot-relevant state — answer change,
  // question/module/section navigation, mark toggle, pause/resume, and break
  // entry — which is exactly the spec's write-point list, without touching the
  // individual state mutators (submitModule / setAnswer / etc. stay byte-clean).
  // At most one write per SNAPSHOT_THROTTLE_MS; the unthrottled hide/pagehide
  // handler covers the moments in between. Suppressed for the pass right after
  // a resume so a rehydrated test doesn't re-serialize before settling. No
  // write during an in-flight draw (`loading`) — spec §B.
  useEffect(() => {
    if (screen !== 'test' && screen !== 'break') return;
    if (suppressSnapshotRef.current) {
      suppressSnapshotRef.current = false;
      return;
    }
    if (loading) return;
    const now = Date.now();
    if (now - lastSnapshotAtRef.current < SNAPSHOT_THROTTLE_MS) return;
    const state = buildSnapshotState();
    if (!state) return;
    lastSnapshotAtRef.current = now;
    writeSnapshot(serializeSnapshot(state, now));
  }, [
    screen, loading, buildSnapshotState,
    // Explicit deps so a change to any snapshot-relevant field re-runs the
    // throttle check (buildSnapshotState already closes over these, but listing
    // them makes the write points legible and satisfies exhaustive-deps).
    responses, marked, secIdx, modIdx, qIdx, paused, remaining, breakRemaining,
  ]);

  // Unthrottled snapshot flush on the crash-adjacent browser signals: the tab
  // being hidden (visibilitychange → hidden) and pagehide. These are the exact
  // moments a mobile OS or a closing tab is most likely to freeze/kill the page
  // before a throttled write would have fired.
  useEffect(() => {
    const onHide = () => flushSnapshot();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushSnapshot();
    };
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flushSnapshot]);

  // Runs the save through the retry policy. Retries transient failures (network
  // blip, serverless cold-start, brief Supabase hiccup) with backoff; stops
  // immediately on terminal failures (invalid payload, daily limit, no session).
  // On success it clears the local backup; on final failure it keeps the backup
  // and surfaces the real error string. Used by both the first save and retrySave.
  const runSave = useCallback(
    async (payload: AttemptPayload, attemptUuid: string): Promise<void> => {
      setSaveStatus('saving');
      setSaveError(null);
      let attemptNo = 0;
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : undefined;
      const res = await withRetry<string>(() => {
        attemptNo++;
        return saveAttempt(payload, { attemptUuid, attemptNo, userAgent: ua }).then((r) =>
          r.ok
            ? { ok: true as const, value: r.id }
            : { ok: false as const, error: r.error },
        );
      });
      if (res.ok) {
        clearPendingAttempt();
        setSaveStatus('saved');
        setSaveError(null);
      } else {
        // Backup is left in place so the attempt can be resaved on next load.
        setSaveStatus('error');
        setSaveError(res.error ?? 'unknown error');
        console.error('[useTestSession] saveAttempt failed after retries:', res.error);
      }
    },
    [],
  );

  // Persist the attempt exactly once, when the results screen first appears.
  // The savedRef guard prevents the auto-fire from running twice; retrySave()
  // re-uses the captured payload to try again after a failure.
  useEffect(() => {
    if (screen !== 'results' || !test || !results || savedRef.current) return;
    savedRef.current = true;
    setSessionCompletions((n) => n + 1); // one submitted test, for the daily-limit gate
    const payload = toAttemptPayload(test, responses, results, testLength, breaksUsed, timesMsRef.current);
    const attemptUuid = newAttemptUuid();
    pendingPayloadRef.current = { payload, attemptUuid };
    // Write the local backup BEFORE the network call so a tab close / reload
    // mid-save still leaves a recoverable copy that auto-resaves next load.
    writePendingAttempt(makePendingAttempt(payload, attemptUuid, Date.now()));
    void runSave(payload, attemptUuid);
    // Deps are intentionally [screen] only: the savedRef guard ensures a single
    // run, so test/responses/results/testLength are read once on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  const retrySave = useCallback(() => {
    const pend = pendingPayloadRef.current;
    if (!pend) return;
    void runSave(pend.payload, pend.attemptUuid);
  }, [runSave]);

  // --- Mid-test crash recovery: restore check (spec §B) ----------------------
  // On first mount, look for an in-progress snapshot from a crashed/closed
  // session. This effect is placed BEFORE the resave-on-mount effect (source
  // order = run order) on purpose: a restored in-progress test must be
  // considered before a leftover finished-attempt backup, so the two never
  // collide (they can't coexist for the same test — finish() clears the
  // snapshot before writing the pending backup). Version mismatch / parse
  // failure / >12h stale → treat as absent and clear. Single-fire ref keeps
  // Strict Mode's double-invoke from double-reading. This does NOT auto-resume:
  // it surfaces a summary and waits for the user's Resume / Discard.
  useEffect(() => {
    if (restoreCheckedRef.current) return;
    restoreCheckedRef.current = true;
    const snap = readSnapshot();
    if (!snap) return;
    if (Date.now() - snap.savedAt > SNAPSHOT_MAX_AGE_MS) {
      clearSnapshot();
      return;
    }
    pendingSnapshotRef.current = snap;
    const sec = snap.test.sections[snap.secIdx];
    const remainingSeconds = snap.onBreak
      ? snap.breakRemaining
      : (snap.remaining[snap.secIdx]?.[snap.modIdx] ?? 0);
    setPendingSnapshot({
      testLength: snap.testLength,
      sectionName: sec?.name ?? '',
      remainingSeconds,
      onBreak: snap.onBreak,
      savedAt: snap.savedAt,
    });
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resume a saved in-progress test. Rehydrates ALL hook state exactly as saved
  // — including the REFS (timesMsRef.current from the snapshot; activeQuestionRef
  // = null, the start() precedent) — then sets `screen` LAST so the timer
  // effects can't tick before the state is in place. moduleReview stays false
  // (restore lands on the question view). Timers resume from the saved
  // `remaining`; wall-clock while the tab was closed is NOT deducted (practice-
  // pragmatic). React auto-batches these setState calls (they run inside this
  // event handler) into a single render. suppressSnapshotRef stops the write
  // effect from immediately re-serializing the just-restored state.
  const resumeSnapshot = useCallback(() => {
    const snap = pendingSnapshotRef.current;
    if (!snap) return;
    suppressSnapshotRef.current = true;
    // Refs first (not rendered — set synchronously before any effect ticks).
    timesMsRef.current = snap.timesMs;
    activeQuestionRef.current = null;
    setTest(snap.test);
    setName(snap.studentName);
    setTestLength(snap.testLength);
    setResponses(snap.responses);
    setRemaining(snap.remaining);
    setMarked(new Set(snap.marked));
    setModuleReview(false);
    setSecIdx(snap.secIdx);
    setModIdx(snap.modIdx);
    setQIdx(snap.qIdx);
    setBreaksEnabled(snap.breaksEnabled);
    setBreaksUsed(snap.breaksUsed);
    setBreakRemaining(snap.breakRemaining);
    setPaused(false);
    setShowReview(false);
    setStartError(null);
    setModule2Error(null);
    setPendingSnapshot(null);
    // Screen LAST — timer/stopwatch effects gate on it, so all state above is
    // committed in the same batch before they can run.
    setScreen(snap.onBreak ? 'break' : 'test');
    // Stable setState setters + refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Discard the saved in-progress test — clear the snapshot and dismiss the card.
  const discardSnapshot = useCallback(() => {
    clearSnapshot();
    pendingSnapshotRef.current = null;
    setPendingSnapshot(null);
  }, []);

  // On first mount, resave any attempt left behind by a previous session (the
  // tab closed before the save finished, or the save errored and the page was
  // reloaded). Best-effort background recovery — runs once.
  useEffect(() => {
    if (resaveStartedRef.current) return;
    const pend = readPendingAttempt();
    if (!pend) return;
    resaveStartedRef.current = true;
    setResaveStatus('saving');
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : undefined;
    void withRetry<string>(() =>
      saveAttempt(pend.payload, { attemptUuid: pend.attemptUuid, userAgent: ua }).then((r) =>
        r.ok ? { ok: true as const, value: r.id } : { ok: false as const, error: r.error },
      ),
    ).then((res) => {
      if (res.ok) {
        clearPendingAttempt();
        setResaveStatus('saved');
      } else {
        // Leave the backup for another try; a terminal failure (e.g. the daily
        // limit) just means it won't recover, which the banner reflects.
        setResaveStatus('error');
      }
    });
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-finalise the current module on time-up. For a full test the
  // submit flow handles the Module 1 → Module 2 transition; we reuse it
  // here so timer expiry follows the same path as a manual submit.
  const handleTimeUp = () => {
    stopTimer();
    if (!test) return;
    window.alert('Time is up for this module.');
    void submitModule(true);
  };

  const finish = () => {
    stopTimer();
    // Commit the final question's time before the results screen reads the
    // accumulator (the display effect's cleanup also fires on the screen
    // change, but committing here first makes the ordering explicit).
    commitStopwatch();
    // Crash-recovery ordering (spec §B): clear the in-progress snapshot FIRST,
    // then the results-save effect writes the pending-attempt backup. A crash
    // between finish and save must leave ONLY the pending-attempt — the two
    // must never coexist for the same test.
    clearSnapshot();
    setScreen('results');
  };

  const pause = useCallback(() => {
    if (!breaksEnabled || screen !== 'test' || paused) return;
    setBreaksUsed(true);
    setPaused(true);
  }, [breaksEnabled, screen, paused]);

  const resume = useCallback(() => {
    setPaused((p) => (p ? false : p));
  }, []);

  // End the mandatory break and start the next section (Math). Stops the break
  // interval and hands control back to the section countdown by returning to
  // 'test'. Idempotent — a manual "Resume early" racing the auto-advance is
  // safe (both funnel through the same state transition). The break was entered
  // *before* advancing secIdx, so we advance it here.
  const resumeFromBreak = useCallback(() => {
    stopBreakTimer();
    setSecIdx((s) => s + 1);
    setModIdx(0);
    setQIdx(0);
    setScreen('test');
  }, [stopBreakTimer]);

  const start = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      window.alert('Please enter a name to start.');
      return;
    }
    // A fresh start clears any prior assembly errors (start + in-test).
    setStartError(null);
    setModule2Error(null);
    setBreakRemaining(BREAK_SECONDS);
    setLoading(true);
    let t: Test;
    if (testLength === 'short') {
      // Short tests keep the BANK fallback — a small offline seed test is a
      // perfectly valid low-stakes practice run.
      try {
        const drawn = await drawShortTest();
        t = buildTest(trimmed, 'short', drawn);
      } catch (e) {
        console.error('[useTestSession] short-test pool draw failed; using BANK fallback', e);
        t = buildTest(trimmed, 'short');
      }
    } else {
      // Full tests must NEVER be built from the 33-item seed BANK — a scaled
      // score off a seed test would be invalid. On any draw failure OR a
      // Module-1 count mismatch, surface an error on the start screen and let
      // the user retry (or take a short test) instead of silently degrading.
      try {
        const drawn = await drawFullTestModule1();
        // Exact-count guard (belt-and-suspenders): each section must have
        // exactly moduleSize questions or the full test aborts to the error.
        const rwOk = drawn.rw.length === SECTION_CONFIG.rw.moduleSize;
        const mathOk = drawn.math.length === SECTION_CONFIG.math.moduleSize;
        if (!rwOk || !mathOk) {
          throw new Error(
            `full-test draw returned an incomplete module (rw=${drawn.rw.length}/${SECTION_CONFIG.rw.moduleSize}, math=${drawn.math.length}/${SECTION_CONFIG.math.moduleSize})`,
          );
        }
        t = buildTest(trimmed, 'full', drawn);
      } catch (e) {
        console.error('[useTestSession] full-test assembly failed; no BANK fallback', e);
        setLoading(false);
        setStartError(
          "We couldn't assemble a full test right now — try again or take a short test.",
        );
        return;
      }
    }
    setLoading(false);
    setTest(t);
    setResponses(
      t.sections.map((s) => s.modules.map((m) => new Array(m.questions.length).fill(null))),
    );
    // Per-question timing accumulator, parallel to `responses` (Module 2 rows
    // are appended lazily by applyModule2Draw). Reset the stopwatch too so a
    // fresh test never carries a stale active question.
    timesMsRef.current = t.sections.map((s) =>
      s.modules.map((m) => new Array<number>(m.questions.length).fill(0)),
    );
    activeQuestionRef.current = null;
    setRemaining(t.sections.map((s) => s.modules.map((m) => m.timeLimit)));
    setSecIdx(0);
    setModIdx(0);
    setQIdx(0);
    setShowReview(false);
    // #16: a fresh test starts with no marks and no open review page.
    setMarked(new Set());
    setModuleReview(false);
    setBreaksEnabled(testLength === 'short' ? false : breaksEnabled);
    setPaused(false);
    setBreaksUsed(false);
    // Crash-recovery: a fresh start supersedes any leftover snapshot. Clear it
    // (and the resume card) and reset the throttle so the first write of THIS
    // test fires immediately.
    clearSnapshot();
    pendingSnapshotRef.current = null;
    setPendingSnapshot(null);
    lastSnapshotAtRef.current = -Infinity;
    setScreen('test');
  };

  const setAnswer = (value: number | string) => {
    setResponses((prev) => {
      const next = prev.map((sec) => sec.map((mod) => mod.slice()));
      if (!next[secIdx] || !next[secIdx][modIdx]) return prev;
      next[secIdx][modIdx][qIdx] = value;
      return next;
    });
  };

  const goToQuestion = (qi: number) => setQIdx(qi);

  // Toggle mark-for-review on the CURRENT question. Keyed by the module-scoped
  // "${secIdx}-${modIdx}-${qIdx}" so a mark never leaks across modules/sections.
  const toggleMarked = useCallback(() => {
    const key = `${secIdx}-${modIdx}-${qIdx}`;
    setMarked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, [secIdx, modIdx, qIdx]);

  // Open the Check-Your-Work page (does NOT submit — the page's primary button
  // calls submitModule). The stopwatch commits+stops via the display effect's
  // moduleReview guard; the section countdown keeps running.
  const openModuleReview = useCallback(() => setModuleReview(true), []);

  // Close the Check-Your-Work page and return to the question view. An optional
  // jump target sets qIdx first (click-to-jump from a review square).
  const closeModuleReview = useCallback((qi?: number) => {
    if (typeof qi === 'number') setQIdx(qi);
    setModuleReview(false);
  }, []);

  // Perform a single Module-2 draw and apply it to state. Throws on any draw
  // failure (the caller's retry logic handles it). Keeps the moduleSize timer
  // seed discipline (moduleSeconds when full; proportional Math.round when a
  // cold-start pool yields a short module).
  const applyModule2Draw = async (
    targetSecIdx: number,
    key: SectionKey,
    path: 'easier' | 'harder',
  ): Promise<void> => {
    const drawn = await drawModule2(key, path);
    if (drawn.length === 0) {
      throw new Error(`drawModule2 returned no questions (section=${key}, path=${path})`);
    }
    const cfg = SECTION_CONFIG[key];
    const drawnLen = Math.min(cfg.moduleSize, drawn.length);
    setTest((t) => (t ? appendModule2(t, targetSecIdx, drawn, path) : t));
    setResponses((r) => {
      const next = r.map((arr) => arr.map((a) => a.slice()));
      next[targetSecIdx][1] = new Array(drawnLen).fill(null);
      return next;
    });
    // Grow the timing accumulator to match: append the Module-2 row so its
    // per-question cells exist before the stopwatch starts on modIdx=1.
    if (timesMsRef.current[targetSecIdx]) {
      timesMsRef.current[targetSecIdx][1] = new Array<number>(drawnLen).fill(0);
    }
    setRemaining((rem) => {
      const next = rem.map((arr) => arr.slice());
      // Full Module 2 seeds from official `moduleSeconds`; a cold-start short
      // module scales proportionally. `secsPerQ` is fractional now, so
      // Math.round keeps `remaining` integral (mirrors appendModule2).
      next[targetSecIdx][1] = drawnLen === cfg.moduleSize
        ? cfg.moduleSeconds
        : Math.round(drawnLen * cfg.secsPerQ);
      return next;
    });
    setModIdx(1);
    setQIdx(0);
  };

  // Draw Module 2 with ONE automatic retry. The Module-2 draw is currently the
  // one mid-test network call with no fallback (a full test can't be finished
  // from BANK without invalidating the score). On the first failure we retry
  // once; a second failure sets module2Error, which renders an in-test overlay
  // with a manual Retry (retryModule2). Module-1 work stays in memory; the
  // Module-2 timer has not started, so no time is lost. Abandoning the tab
  // loses the attempt (unchanged from today's semantics).
  const performModule2Draw = async (
    targetSecIdx: number,
    key: SectionKey,
    path: 'easier' | 'harder',
  ): Promise<void> => {
    module2ParamsRef.current = { secIdx: targetSecIdx, key, path };
    setModule2Error(null);
    setLoading(true);
    try {
      try {
        await applyModule2Draw(targetSecIdx, key, path);
      } catch (firstErr) {
        console.error('[useTestSession] drawModule2 failed; retrying once', firstErr);
        await applyModule2Draw(targetSecIdx, key, path);
      }
      module2ParamsRef.current = null;
    } catch (e) {
      console.error('[useTestSession] drawModule2 failed after one retry:', e);
      setModule2Error(
        'Connection problem building Module 2. Your Module 1 answers are safe — please retry.',
      );
    } finally {
      setLoading(false);
    }
  };

  // Manual retry from the in-test Module-2 error overlay. Replays the stashed
  // draw params (section + routing path) so the routing decision is preserved.
  const retryModule2 = useCallback(() => {
    const params = module2ParamsRef.current;
    if (!params) return;
    void performModule2Draw(params.secIdx, params.key, params.path);
    // performModule2Draw is a stable closure over setState setters + refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // submitModule replaces the old submitSection. `auto` skips the
  // confirm prompt — used for the time-up auto-advance.
  const submitModule = async (auto = false) => {
    if (!test) return;

    // Short tests: one module per section. Behave like the old submitSection.
    if (test.length === 'short') {
      const unanswered = responses[secIdx]?.[0]?.filter((r) => r === null).length ?? 0;
      const last = secIdx === test.sections.length - 1;
      if (!auto) {
        let msg = unanswered > 0
          ? `You have ${unanswered} unanswered question(s) in this section. `
          : '';
        msg += last ? 'Submit the whole test now?' : 'Move on to the next section now?';
        if (!window.confirm(msg)) return;
      }
      if (last) {
        finish();
        return;
      }
      setSecIdx((s) => s + 1);
      setQIdx(0);
      return;
    }

    // Full test branch.
    const sec = test.sections[secIdx];
    if (modIdx === 0) {
      const unanswered = responses[secIdx]?.[0]?.filter((r) => r === null).length ?? 0;
      if (!auto) {
        const msg =
          (unanswered > 0
            ? `You have ${unanswered} unanswered question(s) in this module. `
            : '') + 'Submit Module 1 and continue to Module 2?';
        if (!window.confirm(msg)) return;
      }
      // Compute Module 1 correct.
      let correct = 0;
      sec.modules[0].questions.forEach((q, qi) => {
        const v = responses[secIdx]?.[0]?.[qi];
        if (q.response_format === 'spr') {
          if (
            typeof v === 'string' &&
            q.correct_answer &&
            isSprCorrect(v, q.correct_answer, q.answer_tolerance ?? null)
          ) {
            correct++;
          }
        } else if (typeof v === 'number' && v === q.answerIndex) {
          correct++;
        }
      });
      const threshold = await getModule2ThresholdPct(sec.key);
      const moduleSize = SECTION_CONFIG[sec.key].moduleSize;
      const cutoff = Math.ceil((moduleSize * threshold) / 100);
      const path: 'easier' | 'harder' = correct >= cutoff ? 'harder' : 'easier';
      await performModule2Draw(secIdx, sec.key, path);
      return;
    }

    // modIdx === 1: Module 2 done.
    const unanswered = responses[secIdx]?.[1]?.filter((r) => r === null).length ?? 0;
    const last = secIdx === test.sections.length - 1;
    if (!auto) {
      let msg = unanswered > 0
        ? `You have ${unanswered} unanswered question(s) in this module. `
        : '';
      msg += last ? 'Submit the whole test now?' : 'Move on to the next section now?';
      if (!window.confirm(msg)) return;
    }
    if (last) {
      finish();
      return;
    }
    // Full test, last R&W module submitted → enter the mandatory 10-minute
    // break before Math. The section advance is deferred to resumeFromBreak()
    // (manual or auto at 0). stopTimer() freezes the section clock now; the
    // section-countdown effect's `screen !== 'test'` guard keeps it frozen for
    // the whole break. The break runs on its OWN interval (see the break
    // effect). Entering 'break' does NOT advance secIdx.
    stopTimer();
    setBreakRemaining(BREAK_SECONDS);
    setScreen('break');
  };

  const newTest = () => {
    stopTimer();
    stopBreakTimer();
    savedRef.current = false;
    pendingPayloadRef.current = null;
    module2ParamsRef.current = null;
    // Clear the timing accumulator + stopwatch so the next test starts fresh.
    timesMsRef.current = [];
    activeQuestionRef.current = null;
    setSaveStatus('idle');
    setSaveError(null);
    setPaused(false);
    setBreaksUsed(false);
    setBreakRemaining(BREAK_SECONDS);
    setStartError(null);
    setModule2Error(null);
    // #16: clear marks + any open review page.
    setMarked(new Set());
    setModuleReview(false);
    // Crash-recovery: an explicit clear point (spec §B). finish() already
    // cleared on the way to results, but newTest() is a hard reset — clear the
    // snapshot + resume card and reset the throttle unconditionally.
    clearSnapshot();
    pendingSnapshotRef.current = null;
    setPendingSnapshot(null);
    lastSnapshotAtRef.current = -Infinity;
    setScreen('start');
  };

  const toggleReview = () => setShowReview((v) => !v);

  const results = screen === 'results' && test ? computeResults(test, responses) : null;

  return {
    screen, name, setName, testLength, setTestLength,
    breaksEnabled, setBreaksEnabled, paused, pause, resume, breaksUsed,
    breakRemaining, resumeFromBreak, startError, module2Error, retryModule2,
    test, secIdx, modIdx, qIdx, responses, remaining,
    marked, toggleMarked, moduleReview, openModuleReview, closeModuleReview,
    showReview, toggleReview, loading, saveStatus, saveError, retrySave,
    resaveStatus, sessionCompletions,
    pendingSnapshot, resumeSnapshot, discardSnapshot,
    start, setAnswer, goToQuestion, submitModule, newTest, results,
  };
}

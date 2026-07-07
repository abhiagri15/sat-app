'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { shuffleChoices } from '@/app/lib/test';
import { isSprCorrect } from '@/app/lib/spr';
import { type Question, type SectionKey } from '@/app/lib/questions';
import { drawDrill } from '@/app/lib/practice/draw';
import { toPracticePayload, type DrillResult, type PracticePayload } from '@/app/lib/practice/payload';
import { savePractice } from '@/app/lib/practice/actions';

// A v4-ish unique id, one per drill, correlating the client session with its
// sat.practice_sessions row (save_practice is idempotent on it). crypto.randomUUID
// needs a secure context; fall back so a finished drill is never blocked from saving.
function newSessionUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `drill-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

export type DrillPhase = 'idle' | 'loading' | 'drilling' | 'summary' | 'error';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface PracticeSession {
  phase: DrillPhase;
  error: string | null; // draw error (phase 'error')
  questions: Question[]; // choices pre-shuffled per drill
  qIdx: number;
  checked: boolean; // current question graded?
  selected: number | null; // mcq selection before/after check
  entered: string; // spr input value
  lastCorrect: boolean | null; // grade of the current question once checked
  correctCount: number;
  streak: number; // current consecutive-correct run
  results: DrillResult[]; // grows as questions are checked
  saveStatus: SaveStatus;
  saveError: string | null;
  start: () => void; // idle/error/summary → loading → drilling
  select: (i: number) => void; // no-op once checked
  setEntered: (v: string) => void;
  check: () => void; // grades current question, appends to results
  next: () => void; // advances; after last question → summary
  retrySave: () => void;
}

const DRILL_SIZE = 10;

export function usePracticeSession(
  section: SectionKey,
  skill: string,
  autoStart: boolean,
): PracticeSession {
  const [phase, setPhase] = useState<DrillPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [qIdx, setQIdx] = useState(0);
  const [checked, setChecked] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [entered, setEntered] = useState('');
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [results, setResults] = useState<DrillResult[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Per-drill correlation id, minted once at start() and reused for every
  // retrySave (save_practice is idempotent on it).
  const sessionUuidRef = useRef<string | null>(null);
  // The payload for the current summary, kept so retrySave() can re-fire the
  // SAME payload (same uuid) without recomputing from state.
  const pendingPayloadRef = useRef<PracticePayload | null>(null);
  // Guards the fire-once save on entering summary against a double render.
  const savedRef = useRef(false);
  // Guards the autoStart mount effect against React Strict Mode's double-invoke
  // (dev) — same discipline as resaveStartedRef in useTestSession.
  const autoStartedRef = useRef(false);

  // Runs the save. On success → 'saved'; on any failure → 'error' with the real
  // message. Used by both the fire-once save and retrySave.
  const runSave = useCallback(async (payload: PracticePayload): Promise<void> => {
    setSaveStatus('saving');
    setSaveError(null);
    const res = await savePractice(payload);
    if (res.ok) {
      setSaveStatus('saved');
      setSaveError(null);
      // Fire-and-forget post-drill targeted top-up (see the Dynamic Practice
      // spec §C). Not awaited, no state — the drill already completed; the
      // route enforces its own threshold + cooldown. keepalive lets it survive
      // a navigation away from the summary. Failures are silently ignored.
      fetch('/api/practice/topup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skill }),
        keepalive: true,
      }).catch(() => {});
    } else {
      setSaveStatus('error');
      setSaveError(res.error ?? 'unknown error');
      console.error('[usePracticeSession] savePractice failed:', res.error);
    }
  }, [skill]);

  const start = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      const drawn = await drawDrill(skill, DRILL_SIZE);
      if (drawn.length === 0) {
        setError('No questions available for this skill yet');
        setPhase('error');
        return;
      }
      // Order is meaningful (missed-first) — never shuffle the array; only
      // shuffle each mcq's choices (shuffleChoices no-ops for spr).
      const prepared = drawn.map((q) => shuffleChoices(q));
      // Reset all per-drill state and mint a fresh session id.
      sessionUuidRef.current = newSessionUuid();
      pendingPayloadRef.current = null;
      savedRef.current = false;
      setQuestions(prepared);
      setQIdx(0);
      setChecked(false);
      setSelected(null);
      setEntered('');
      setLastCorrect(null);
      setCorrectCount(0);
      setStreak(0);
      setResults([]);
      setSaveStatus('idle');
      setSaveError(null);
      setPhase('drilling');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load this drill';
      setError(message);
      setPhase('error');
    }
  }, [skill]);

  // autoStart: fire start() once on mount when requested and still idle.
  // Guarded against Strict-Mode double-invoke.
  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    if (phase !== 'idle') return;
    autoStartedRef.current = true;
    void start();
    // Run once on mount when autoStart is set. `phase` is read once here on
    // purpose — the ref guard is the real single-fire guarantee.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  const select = useCallback(
    (i: number) => {
      if (checked) return; // locked once graded
      setSelected(i);
    },
    [checked],
  );

  const check = useCallback(() => {
    if (checked) return; // already graded
    const q = questions[qIdx];
    if (!q) return;
    const spr = q.response_format === 'spr';

    // Ignore a check with nothing chosen/entered.
    if (spr) {
      if (entered.trim().length === 0) return;
    } else if (selected == null) {
      return;
    }

    // Local grading — display-only; the server re-verifies at save.
    const isCorrect = spr
      ? isSprCorrect(entered, q.correct_answer ?? '', q.answer_tolerance ?? null)
      : selected === q.answerIndex;

    const result: DrillResult = {
      question: q,
      chosenIndex: spr ? -1 : (selected as number),
      enteredValue: spr ? entered : null,
      isCorrect,
    };

    setResults((prev) => [...prev, result]);
    setChecked(true);
    setLastCorrect(isCorrect);
    if (isCorrect) {
      setCorrectCount((n) => n + 1);
      setStreak((s) => s + 1);
    } else {
      setStreak(0);
    }
  }, [checked, questions, qIdx, selected, entered]);

  const next = useCallback(() => {
    if (!checked) return; // advance only after grading the current question
    const isLast = qIdx >= questions.length - 1;
    if (isLast) {
      // Fire-once save on entering summary.
      if (!savedRef.current) {
        savedRef.current = true;
        const uuid = sessionUuidRef.current ?? newSessionUuid();
        sessionUuidRef.current = uuid;
        const payload = toPracticePayload(uuid, section, skill, results);
        pendingPayloadRef.current = payload;
        void runSave(payload);
      }
      setPhase('summary');
      return;
    }
    setQIdx((i) => i + 1);
    setChecked(false);
    setSelected(null);
    setEntered('');
    setLastCorrect(null);
  }, [checked, qIdx, questions.length, results, section, skill, runSave]);

  const retrySave = useCallback(() => {
    const payload = pendingPayloadRef.current;
    if (!payload) return;
    void runSave(payload);
  }, [runSave]);

  return {
    phase,
    error,
    questions,
    qIdx,
    checked,
    selected,
    entered,
    lastCorrect,
    correctCount,
    streak,
    results,
    saveStatus,
    saveError,
    start,
    select,
    setEntered,
    check,
    next,
    retrySave,
  };
}

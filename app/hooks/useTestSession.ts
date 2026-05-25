'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  appendModule2,
  buildTest,
  computeResults,
  type Results,
  type ResponseValue,
  type Test,
  type TestLength,
} from '@/app/lib/test';
import { drawShortTest, drawFullTestModule1, drawModule2 } from '@/app/lib/pool';
import { SECTION_CONFIG } from '@/app/lib/questions';
import { isSprCorrect } from '@/app/lib/spr';
import { toAttemptPayload } from '@/app/lib/persistence/payload';
import { saveAttempt } from '@/app/lib/persistence/actions';
import { getModule2ThresholdPct } from '@/app/lib/config-actions';

export type Screen = 'start' | 'test' | 'results';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface TestSession {
  // state
  screen: Screen;
  name: string;
  setName: (s: string) => void;
  testLength: TestLength;
  setTestLength: (l: TestLength) => void;
  test: Test | null;
  secIdx: number;
  modIdx: number;
  qIdx: number;
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
  sessionCompletions: number; // tests submitted this browser session
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
  const [testLength, setTestLength] = useState<TestLength>('short');

  const [test, setTest] = useState<Test | null>(null);
  const [secIdx, setSecIdx] = useState(0);
  const [modIdx, setModIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [responses, setResponses] = useState<ResponseValue[][][]>([]);
  const [remaining, setRemaining] = useState<number[][]>([]);
  const [showReview, setShowReview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  // Tests submitted this session — added to the server-rendered daily count so
  // the Start screen's limit gate stays accurate without a page reload.
  // Deliberately NOT reset by newTest(): it accumulates for the whole session.
  const [sessionCompletions, setSessionCompletions] = useState(0);
  // Guards the save effect so a submitted test is persisted exactly once.
  // (`saveStatus` is its render-visible counterpart.)
  const savedRef = useRef(false);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => stopTimer(), [stopTimer]);

  // Drive the countdown whenever we're on the test screen / change section / module.
  useEffect(() => {
    if (screen !== 'test') return;
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
  }, [screen, secIdx, modIdx]);

  // Persist the attempt exactly once, when the results screen first appears.
  useEffect(() => {
    if (screen !== 'results' || !test || !results || savedRef.current) return;
    savedRef.current = true;
    setSessionCompletions((n) => n + 1); // one submitted test, for the daily-limit gate
    setSaveStatus('saving');
    saveAttempt(toAttemptPayload(test, responses, results, testLength))
      .then((res) => {
        setSaveStatus(res.ok ? 'saved' : 'error');
        if (!res.ok) console.error('[useTestSession] saveAttempt failed:', res.error);
      })
      .catch((e) => {
        setSaveStatus('error');
        console.error('[useTestSession] saveAttempt threw:', e);
      });
    // Deps are intentionally [screen] only: the savedRef guard ensures a single
    // run, so test/responses/results/testLength are read once on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

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
    setScreen('results');
  };

  const start = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      window.alert('Please enter a name to start.');
      return;
    }
    setLoading(true);
    let t: Test;
    try {
      const drawn = testLength === 'short'
        ? await drawShortTest()
        : await drawFullTestModule1();
      t = buildTest(trimmed, testLength, drawn);
    } catch (e) {
      console.error('[useTestSession] pool draw failed; using BANK fallback', e);
      t = buildTest(trimmed, testLength);
    }
    setLoading(false);
    setTest(t);
    setResponses(
      t.sections.map((s) => s.modules.map((m) => new Array(m.questions.length).fill(null))),
    );
    setRemaining(t.sections.map((s) => s.modules.map((m) => m.timeLimit)));
    setSecIdx(0);
    setModIdx(0);
    setQIdx(0);
    setShowReview(false);
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
      const threshold = await getModule2ThresholdPct();
      const moduleSize = SECTION_CONFIG[sec.key].moduleSize;
      const cutoff = Math.ceil((moduleSize * threshold) / 100);
      const path: 'easier' | 'harder' = correct >= cutoff ? 'harder' : 'easier';
      setLoading(true);
      try {
        const drawn = await drawModule2(sec.key, path);
        const drawnLen = Math.min(SECTION_CONFIG[sec.key].moduleSize, drawn.length);
        setTest((t) => (t ? appendModule2(t, secIdx, drawn, path) : t));
        setResponses((r) => {
          const next = r.map((arr) => arr.map((a) => a.slice()));
          next[secIdx][1] = new Array(drawnLen).fill(null);
          return next;
        });
        setRemaining((rem) => {
          const next = rem.map((arr) => arr.slice());
          next[secIdx][1] = drawnLen * SECTION_CONFIG[sec.key].secsPerQ;
          return next;
        });
        setModIdx(1);
        setQIdx(0);
      } catch (e) {
        console.error('[useTestSession] drawModule2 failed:', e);
        window.alert('Failed to load Module 2. Please try again.');
      } finally {
        setLoading(false);
      }
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
    setSecIdx((s) => s + 1);
    setModIdx(0);
    setQIdx(0);
  };

  const newTest = () => {
    stopTimer();
    savedRef.current = false;
    setSaveStatus('idle');
    setScreen('start');
  };

  const toggleReview = () => setShowReview((v) => !v);

  const results = screen === 'results' && test ? computeResults(test, responses) : null;

  return {
    screen, name, setName, testLength, setTestLength,
    test, secIdx, modIdx, qIdx, responses, remaining,
    showReview, toggleReview, loading, saveStatus, sessionCompletions,
    start, setAnswer, goToQuestion, submitModule, newTest, results,
  };
}

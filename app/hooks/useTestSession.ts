'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import {
  buildTest,
  computeResults,
  type Results,
  type Test,
  type TestLength,
} from '@/app/lib/test';

export type Screen = 'start' | 'test' | 'results';

export interface TestSession {
  // state
  screen: Screen;
  name: string;
  setName: (s: string) => void;
  testLength: TestLength;
  setTestLength: (l: TestLength) => void;
  test: Test | null;
  secIdx: number;
  qIdx: number;
  responses: (number | null)[][];
  remaining: number[];
  showReview: boolean;
  toggleReview: () => void;
  // actions
  start: () => void;
  selectChoice: (i: number) => void;
  goToQuestion: (qi: number) => void;
  submitSection: () => void;
  newTest: () => void;
  results: Results | null;
}

export function useTestSession(): TestSession {
  const [screen, setScreen] = useState<Screen>('start');
  const [name, setName] = useState('');
  const [testLength, setTestLength] = useState<TestLength>('short');

  const [test, setTest] = useState<Test | null>(null);
  const [secIdx, setSecIdx] = useState(0);
  const [qIdx, setQIdx] = useState(0);
  const [responses, setResponses] = useState<(number | null)[][]>([]);
  const [remaining, setRemaining] = useState<number[]>([]);
  const [showReview, setShowReview] = useState(false);

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => stopTimer(), [stopTimer]);

  // Drive the countdown whenever we're on the test screen / change section.
  useEffect(() => {
    if (screen !== 'test') return;
    stopTimer();
    tickRef.current = setInterval(() => {
      setRemaining((prev) => {
        const next = prev.slice();
        if (next[secIdx] > 0) next[secIdx] -= 1;
        if (next[secIdx] <= 0) {
          // Defer the advance to avoid setState mid-render of the parent tree.
          setTimeout(() => handleTimeUp(), 0);
        }
        return next;
      });
    }, 1000);
    return stopTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, secIdx]);

  const handleTimeUp = () => {
    stopTimer();
    if (!test) return;
    if (secIdx < test.sections.length - 1) {
      window.alert('Time is up for this section. Moving to the next section.');
      setSecIdx((s) => s + 1);
      setQIdx(0);
    } else {
      window.alert('Time is up. Submitting your test.');
      finish();
    }
  };

  const finish = () => {
    stopTimer();
    setScreen('results');
  };

  const start = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      window.alert('Please enter a name to start.');
      return;
    }
    const t = buildTest(trimmed, testLength);
    setTest(t);
    setResponses(t.sections.map((s) => new Array(s.questions.length).fill(null)));
    setRemaining(t.sections.map((s) => s.timeLimit));
    setSecIdx(0);
    setQIdx(0);
    setShowReview(false);
    setScreen('test');
  };

  const selectChoice = (i: number) => {
    setResponses((prev) => {
      const next = prev.map((arr) => arr.slice());
      next[secIdx][qIdx] = i;
      return next;
    });
  };

  const goToQuestion = (qi: number) => setQIdx(qi);

  const submitSection = () => {
    if (!test) return;
    const unanswered = responses[secIdx].filter((r) => r === null).length;
    const last = secIdx === test.sections.length - 1;
    let msg = unanswered > 0 ? `You have ${unanswered} unanswered question(s) in this section. ` : '';
    msg += last ? 'Submit the whole test now?' : 'Move on to the next section now?';
    if (!window.confirm(msg)) return;
    if (last) {
      finish();
    } else {
      setSecIdx((s) => s + 1);
      setQIdx(0);
    }
  };

  const newTest = () => {
    stopTimer();
    setScreen('start');
  };

  const toggleReview = () => setShowReview((v) => !v);

  const results = screen === 'results' && test ? computeResults(test, responses) : null;

  return {
    screen, name, setName, testLength, setTestLength,
    test, secIdx, qIdx, responses, remaining,
    showReview, toggleReview,
    start, selectChoice, goToQuestion, submitSection, newTest, results,
  };
}

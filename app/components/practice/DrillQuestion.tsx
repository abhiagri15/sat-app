'use client';

import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import type { Question } from '@/app/lib/questions';
import { SprInput } from '@/app/components/SprInput';
import { FlagQuestion } from '@/app/components/FlagQuestion';
import { FigureView } from '@/app/components/FigureView';
import { ExplainMistake } from '@/app/components/ExplainMistake';

interface DrillQuestionProps {
  question: Question;
  checked: boolean;
  selected: number | null;
  entered: string;
  lastCorrect: boolean | null;
  onSelect: (i: number) => void;
  onEntered: (v: string) => void;
  onCheck: () => void;
  onNext: () => void;
  isLast: boolean;
  index: number;
  total: number;
}

// One drilled question with an instant-feedback panel. 'use client'. The choice
// list renders choice TEXT ONLY — never a letter label — consistent with the
// app's no-letter-references rule (buildTest shuffles choices, so a letter is
// meaningless). The explanation is source-branched EXACTLY like ReviewItem:
// seed content is trusted HTML (dangerouslySetInnerHTML); everything else (AI)
// renders React-escaped.
export function DrillQuestion({
  question,
  checked,
  selected,
  entered,
  lastCorrect,
  onSelect,
  onEntered,
  onCheck,
  onNext,
  isLast,
  index,
  total,
}: DrillQuestionProps) {
  const isSpr = question.response_format === 'spr';
  const canCheck = isSpr ? entered.trim().length > 0 : selected != null;

  // Answer eliminator (design spec §D). Local UI state, mcq-only, never
  // persisted. `eliminatorOn` is the small toggle above the choices;
  // `eliminated` holds the struck choice indices for the CURRENT question.
  // Both reset when the question changes (id-keyed effect) since this component
  // instance is reused across the drill's questions (SkillDrill does not key it).
  const [eliminatorOn, setEliminatorOn] = useState(false);
  const [eliminated, setEliminated] = useState<Set<number>>(new Set());
  useEffect(() => {
    setEliminated(new Set());
  }, [question.id]);

  function toggleEliminate(i: number) {
    setEliminated((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  // Selecting a choice clears its elimination (design spec §D).
  function handleSelect(i: number) {
    if (eliminated.has(i)) {
      setEliminated((prev) => {
        const next = new Set(prev);
        next.delete(i);
        return next;
      });
    }
    onSelect(i);
  }

  // Keyboard: Enter checks/advances only when focus is NOT on an interactive
  // control — buttons (choices, flag submit, Next), selects, and textareas
  // (the flag widget) keep their native Enter activation, so keyboard users
  // can select a choice with Enter and the flag form is never hijacked. The
  // one exception is the SPR text input, where Enter means "check my answer".
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'A') {
        return;
      }
      if (tag === 'INPUT') {
        if (!checked && canCheck) {
          e.preventDefault();
          onCheck();
        }
        return;
      }
      e.preventDefault();
      if (!checked) {
        if (canCheck) onCheck();
      } else {
        onNext();
      }
    }
    const el = rootRef.current;
    el?.addEventListener('keydown', onKeyDown);
    return () => el?.removeEventListener('keydown', onKeyDown);
  }, [checked, canCheck, onCheck, onNext]);

  return (
    <div ref={rootRef} className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        Question {index + 1} of {total} · {question.skill}
      </p>

      {question.passage && (
        <div className="mt-3 mb-4 whitespace-pre-line rounded-md border-l-4 border-blue-500 bg-slate-50 p-4 text-sm text-slate-700">
          {question.passage}
        </div>
      )}

      {question.figure && (
        <div className="mt-3">
          <FigureView figure={question.figure} />
        </div>
      )}

      <p className="mt-3 text-lg font-semibold text-slate-900">{question.prompt}</p>

      {isSpr ? (
        <div className="mt-4">
          <SprInput value={entered} onChange={(v) => onEntered(v)} />
        </div>
      ) : (
        <>
          {/* Answer eliminator toggle (design spec §D) — mcq-only, hidden once
              graded (choices are disabled after Check answer). It is a BUTTON,
              so the Enter-key handler above exempts it. */}
          {!checked && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setEliminatorOn((v) => !v)}
                aria-pressed={eliminatorOn}
                title="Cross out answer choices you've ruled out"
                className={clsx(
                  'rounded-md border px-2.5 py-1 text-xs transition',
                  eliminatorOn
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:border-blue-500 hover:bg-blue-50',
                )}
              >
                <span className="line-through">ABC</span>{' '}
                {eliminatorOn ? 'On' : 'Cross out'}
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2.5">
            {question.choices.map((choice, i) => {
              const isSelected = selected === i;
              const isAnswer = i === question.answerIndex;
              // After grading: mark the correct choice green; a wrong selection red.
              const showCorrect = checked && isAnswer;
              const showWrong = checked && isSelected && !isAnswer;
              const isEliminated = !checked && eliminated.has(i);
              return (
                <div
                  key={i}
                  className={clsx(
                    'flex items-start gap-2 rounded-lg border text-sm transition',
                    !checked &&
                      'border-slate-200 hover:border-blue-500 hover:bg-blue-50',
                    !checked &&
                      isSelected &&
                      'border-blue-500 bg-blue-50 ring-1 ring-inset ring-blue-500',
                    showCorrect && 'border-green-500 bg-green-50 text-green-900',
                    showWrong && 'border-red-500 bg-red-50 text-red-900',
                    checked && !showCorrect && !showWrong && 'border-slate-200 text-slate-600',
                    isEliminated && 'opacity-40',
                  )}
                >
                  <button
                    type="button"
                    disabled={checked}
                    onClick={() => handleSelect(i)}
                    className={clsx(
                      'flex flex-1 items-start gap-3 px-4 py-3 text-left',
                      !checked && 'cursor-pointer',
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={clsx(
                        'mt-0.5 min-w-[18px] font-bold',
                        showCorrect && 'text-green-600',
                        showWrong && 'text-red-600',
                        !checked && isSelected && 'text-blue-600',
                        !checked && !isSelected && 'text-slate-300',
                        checked && !showCorrect && !showWrong && 'text-slate-300',
                      )}
                    >
                      {showCorrect ? '✓' : showWrong ? '✗' : '•'}
                    </span>
                    <span className={clsx(isEliminated && 'line-through')}>{choice}</span>
                  </button>
                  {eliminatorOn && !checked && (
                    <button
                      type="button"
                      aria-pressed={isEliminated}
                      aria-label={isEliminated ? 'Restore this option' : 'Eliminate this option'}
                      onClick={() => toggleEliminate(i)}
                      className="my-2 mr-2 min-w-[24px] rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-semibold text-slate-500 transition hover:border-slate-500 hover:text-slate-800"
                    >
                      {isEliminated ? '↺' : '✕'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {!checked ? (
        <div className="mt-5">
          <button
            type="button"
            onClick={onCheck}
            disabled={!canCheck}
            className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Check answer
          </button>
        </div>
      ) : (
        <div className="mt-5">
          <div
            className={clsx(
              'rounded-lg border p-4',
              lastCorrect
                ? 'border-green-200 bg-green-50'
                : 'border-red-200 bg-red-50',
            )}
          >
            <p
              className={clsx(
                'text-sm font-bold',
                lastCorrect ? 'text-green-800' : 'text-red-800',
              )}
            >
              {lastCorrect ? 'Correct!' : 'Not quite'}
            </p>

            {isSpr && question.correct_answer && (
              <p className="mt-2 text-sm text-slate-700">
                Correct answer:{' '}
                <span className="font-semibold text-green-700">
                  {question.correct_answer}
                </span>
              </p>
            )}

            <div className="mt-2 text-sm text-slate-700">
              <b className="text-blue-700">Why:</b>{' '}
              {question.source === 'seed' ? (
                <span
                  dangerouslySetInnerHTML={{ __html: question.explanation }}
                />
              ) : (
                <span>{question.explanation}</span>
              )}
            </div>

            {/* Coach follow-up on a miss (design spec §E). Drill questions are
                LIVE sat.questions rows, so the server re-reads by id — no
                snapshot needed; we pass only the student's specific answer. */}
            {lastCorrect === false && (
              <ExplainMistake
                questionId={question.id}
                chosen={isSpr ? null : selected}
                entered={isSpr ? entered : null}
                responseFormat={isSpr ? 'spr' : 'mcq'}
              />
            )}

            <FlagQuestion questionId={question.id} />
          </div>

          <button
            type="button"
            onClick={onNext}
            className="mt-4 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            {isLast ? 'See results' : 'Next question'}
          </button>
        </div>
      )}
    </div>
  );
}

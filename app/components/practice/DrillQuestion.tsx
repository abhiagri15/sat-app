'use client';

import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import type { Question } from '@/app/lib/questions';
import { SprInput } from '@/app/components/SprInput';
import { FlagQuestion } from '@/app/components/FlagQuestion';

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

  // Keyboard: Enter checks the answer (when one is chosen/typed and not yet
  // graded), then Enter advances once graded. Ignore Enter inside a textarea
  // (the flag widget) so reporting a problem doesn't submit the question.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === 'TEXTAREA') return;
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

      <p className="mt-3 text-lg font-semibold text-slate-900">{question.prompt}</p>

      {isSpr ? (
        <div className="mt-4">
          <SprInput value={entered} onChange={(v) => onEntered(v)} />
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2.5">
          {question.choices.map((choice, i) => {
            const isSelected = selected === i;
            const isAnswer = i === question.answerIndex;
            // After grading: mark the correct choice green; a wrong selection red.
            const showCorrect = checked && isAnswer;
            const showWrong = checked && isSelected && !isAnswer;
            return (
              <button
                key={i}
                type="button"
                disabled={checked}
                onClick={() => onSelect(i)}
                className={clsx(
                  'flex items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm transition',
                  !checked &&
                    'cursor-pointer border-slate-200 hover:border-blue-500 hover:bg-blue-50',
                  !checked &&
                    isSelected &&
                    'border-blue-500 bg-blue-50 ring-1 ring-inset ring-blue-500',
                  showCorrect && 'border-green-500 bg-green-50 text-green-900',
                  showWrong && 'border-red-500 bg-red-50 text-red-900',
                  checked && !showCorrect && !showWrong && 'border-slate-200 text-slate-600',
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
                <span>{choice}</span>
              </button>
            );
          })}
        </div>
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

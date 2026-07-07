'use client';

import { clsx } from 'clsx';
import { LETTERS } from '@/app/lib/test';
import type { Question } from '@/app/lib/questions';
import type { ResponseValue } from '@/app/lib/test';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { SprInput } from './SprInput';
import { FigureView } from './FigureView';

interface QuestionViewProps {
  section: { name: string };
  question: Question;
  // For mcq this is a number (the chosen choice index) or null (skipped).
  // For SPR this is a string (the typed entry) or null (skipped).
  selected: ResponseValue;
  onAnswer: (value: number | string) => void;
  onPrev: () => void;
  onNext: () => void;
  isFirst: boolean;
  isLast: boolean;
  // Answer eliminator (design spec §D). UI-state only — never persisted. When
  // `eliminatorOn` is true, each mcq choice row gets a small cross-out control;
  // `eliminated` holds the struck choice indices for THIS question; toggling
  // calls `onToggleEliminate`. SPR is unaffected (no choices). These are
  // optional so pre-existing callers (none today) still compile.
  eliminatorOn?: boolean;
  eliminated?: Set<number>;
  onToggleEliminate?: (i: number) => void;
}

export function QuestionView({
  section,
  question,
  selected,
  onAnswer,
  onPrev,
  onNext,
  isFirst,
  isLast,
  eliminatorOn = false,
  eliminated,
  onToggleEliminate,
}: QuestionViewProps) {
  const isSpr = question.response_format === 'spr';
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">{section.name} · {question.skill}</div>
        {question.passage && (
          <div className="bg-slate-50 border-l-4 border-blue-500 rounded-md p-4 mb-4 whitespace-pre-wrap">
            {question.passage}
          </div>
        )}
        {question.figure && (
          <div className="mb-4">
            <FigureView figure={question.figure} />
          </div>
        )}
        <div className="text-lg font-semibold mb-4">{question.prompt}</div>

        {isSpr ? (
          <SprInput
            value={typeof selected === 'string' ? selected : ''}
            onChange={onAnswer}
          />
        ) : (
          <div className="flex flex-col gap-2.5">
            {question.choices.map((c, i) => {
              const isEliminated = eliminated?.has(i) ?? false;
              return (
                <div
                  key={i}
                  className={clsx(
                    'flex items-start gap-3 rounded-lg border border-slate-200 px-4 py-3 cursor-pointer transition hover:border-blue-500 hover:bg-blue-50',
                    selected === i && 'border-blue-500 bg-blue-50 ring-1 ring-inset ring-blue-500',
                    isEliminated && 'opacity-40',
                  )}
                  // Clicking a choice selects it (and clears its elimination —
                  // see TestScreen's onAnswer wrapper). Eliminated choices stay
                  // clickable.
                  onClick={() => onAnswer(i)}
                >
                  <span className="font-bold text-blue-600 min-w-[20px]">{LETTERS[i]}</span>
                  <span className={clsx('flex-1', isEliminated && 'line-through')}>{c}</span>
                  {eliminatorOn && onToggleEliminate && (
                    <button
                      type="button"
                      aria-pressed={isEliminated}
                      aria-label={
                        isEliminated
                          ? `Restore option ${LETTERS[i]}`
                          : `Eliminate option ${LETTERS[i]}`
                      }
                      // Toggle elimination without selecting the choice.
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleEliminate(i);
                      }}
                      className="ml-1 min-w-[24px] rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs font-semibold text-slate-500 transition hover:border-slate-500 hover:text-slate-800"
                    >
                      {isEliminated ? '↺' : '✕'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap gap-2.5 mt-[22px] justify-between">
          <Button
            variant="secondary"
            className={clsx(isFirst && 'invisible')}
            onClick={onPrev}
          >
            ‹ Previous
          </Button>
          <Button
            onClick={onNext}
          >
            {isLast ? 'Review' : 'Next ›'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

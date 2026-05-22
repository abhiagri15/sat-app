'use client';

import { LETTERS } from '@/app/lib/test';
import type { Question } from '@/app/lib/questions';
import { FlagQuestion } from './FlagQuestion';

interface ReviewItemProps {
  question: Question;
  chosenIndex: number | null;
}

// NOTE: explanation rendering branches on `question.source`. Seed BANK content
// has trusted <b>/<i> tags and is rendered via dangerouslySetInnerHTML; AI
// content is rendered as React-escaped text (no HTML). This guard shipped with
// the AI sub-project (#2) and is relied on by the attempt-review page (#4),
// which renders snapshotted explanations through this component.
export function ReviewItem({ question, chosenIndex }: ReviewItemProps) {
  const isCorrect = chosenIndex === question.answerIndex;
  return (
    <div className="border-t border-slate-200 pt-4 mt-4 first:border-t-0 first:pt-0 first:mt-0">
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
        {question.skill}{' '}
        {chosenIndex === null ? (
          <span className="inline-block ml-2 rounded-full px-2 py-0.5 text-xs font-semibold bg-slate-200 text-slate-700">Skipped</span>
        ) : isCorrect ? (
          <span className="inline-block ml-2 rounded-full px-2 py-0.5 text-xs font-semibold bg-emerald-100 text-emerald-700">Correct</span>
        ) : (
          <span className="inline-block ml-2 rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700">Incorrect</span>
        )}
      </div>
      {question.passage && (
        <div className="bg-slate-50 border-l-4 border-blue-500 rounded-md p-4 mb-4 whitespace-pre-wrap">
          {question.passage}
        </div>
      )}
      <div className="text-lg font-semibold mb-4">{question.prompt}</div>
      <div className="text-sm mt-2">
        Your answer:{' '}
        {chosenIndex === null ? (
          <i>none</i>
        ) : (
          <span className={isCorrect ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
            {LETTERS[chosenIndex]}. {question.choices[chosenIndex]}
          </span>
        )}
      </div>
      {!isCorrect && chosenIndex !== null && (
        <div className="text-sm mt-2">
          Correct answer:{' '}
          <span className="text-emerald-700 font-semibold">
            {LETTERS[question.answerIndex]}. {question.choices[question.answerIndex]}
          </span>
        </div>
      )}
      <div className="mt-3 text-sm text-slate-700">
        <b className="text-blue-700">Why:</b>{' '}
        {question.source === 'seed' ? (
          <span dangerouslySetInnerHTML={{ __html: question.explanation }} />
        ) : (
          <span>{question.explanation}</span>
        )}
      </div>
      <FlagQuestion questionId={question.id} />
    </div>
  );
}

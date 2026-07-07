'use client';

import { LETTERS } from '@/app/lib/test';
import type { ResponseValue } from '@/app/lib/test';
import type { Question } from '@/app/lib/questions';
import { isSprCorrect } from '@/app/lib/spr';
import { FlagQuestion } from './FlagQuestion';
import { FigureView } from './FigureView';
import { ExplainMistake } from './ExplainMistake';

interface ReviewItemProps {
  question: Question;
  // Polymorphic: mcq questions hold a number | null; SPR questions hold a
  // string | null. The component branches on question.response_format.
  response: ResponseValue;
}

// NOTE: explanation rendering branches on `question.source`. Seed BANK content
// has trusted <b>/<i> tags and is rendered via dangerouslySetInnerHTML; AI
// content is rendered as React-escaped text (no HTML). This guard shipped with
// the AI sub-project (#2) and is relied on by the attempt-review page (#4),
// which renders snapshotted explanations through this component.
export function ReviewItem({ question, response }: ReviewItemProps) {
  const isSpr = question.response_format === 'spr';

  // Skipped: null/undefined (any format) or an empty trimmed string (SPR).
  const skipped =
    response == null ||
    (typeof response === 'string' && response.trim() === '');

  let isCorrect = false;
  if (!skipped) {
    if (isSpr) {
      const entered = typeof response === 'string' ? response : '';
      isCorrect =
        question.correct_answer != null &&
        isSprCorrect(entered, question.correct_answer, question.answer_tolerance ?? null);
    } else if (typeof response === 'number') {
      isCorrect = response === question.answerIndex;
    }
  }

  return (
    <div className="border-t border-slate-200 pt-4 mt-4 first:border-t-0 first:pt-0 first:mt-0">
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">
        {question.skill}{' '}
        {skipped ? (
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
      {/* Review renders the figure snapshot as presented (carried on the
          reconstructed Question via its `figure` field) — never a re-join. */}
      {question.figure && (
        <div className="mb-4">
          <FigureView figure={question.figure} />
        </div>
      )}
      <div className="text-lg font-semibold mb-4">{question.prompt}</div>

      {isSpr ? (
        // SPR: show the typed answer, then the canonical answer when wrong.
        <>
          <div className="text-sm mt-2">
            Your answer:{' '}
            {skipped ? (
              <i>none</i>
            ) : (
              <span className={isCorrect ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                {String(response)}
              </span>
            )}
          </div>
          {!isCorrect && !skipped && question.correct_answer && (
            <div className="text-sm mt-2">
              Correct answer:{' '}
              <span className="text-emerald-700 font-semibold">{question.correct_answer}</span>
            </div>
          )}
        </>
      ) : (
        // mcq: show the chosen letter+choice, then the correct one when wrong.
        <>
          <div className="text-sm mt-2">
            Your answer:{' '}
            {skipped || typeof response !== 'number' ? (
              <i>none</i>
            ) : (
              <span className={isCorrect ? 'text-emerald-700 font-semibold' : 'text-red-700 font-semibold'}>
                {LETTERS[response]}. {question.choices[response]}
              </span>
            )}
          </div>
          {!isCorrect && !skipped && (
            <div className="text-sm mt-2">
              Correct answer:{' '}
              <span className="text-emerald-700 font-semibold">
                {LETTERS[question.answerIndex]}. {question.choices[question.answerIndex]}
              </span>
            </div>
          )}
        </>
      )}

      <div className="mt-3 text-sm text-slate-700">
        <b className="text-blue-700">Why:</b>{' '}
        {question.source === 'seed' ? (
          <span dangerouslySetInnerHTML={{ __html: question.explanation }} />
        ) : (
          <span>{question.explanation}</span>
        )}
      </div>

      {/* Coach follow-up on a miss (design spec §E), incorrect + not-skipped
          only. Review questions are SNAPSHOTS: the server re-reads sat.questions
          by id and falls back to these snapshot fields when the row is gone
          (disabled/deleted) — marking the prompt untrusted in that case. */}
      {!skipped && !isCorrect && (
        <ExplainMistake
          questionId={question.id}
          chosen={typeof response === 'number' ? response : null}
          entered={typeof response === 'string' ? response : null}
          responseFormat={question.response_format ?? 'mcq'}
          snapshot={{
            prompt: question.prompt,
            passage: question.passage ?? null,
            choices: question.choices,
            answerIndex: question.answerIndex,
            correctAnswer: question.correct_answer ?? null,
            responseFormat: question.response_format ?? 'mcq',
            skill: question.skill,
            section: question.section,
          }}
        />
      )}

      <FlagQuestion questionId={question.id} />
    </div>
  );
}

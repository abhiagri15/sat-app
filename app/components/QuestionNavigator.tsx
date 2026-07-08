'use client';

import { clsx } from 'clsx';
import { isAnswered, type TestSection, type ResponseValue } from '@/app/lib/test';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';

interface QuestionNavigatorProps {
  section: TestSection;
  modIdx: number;
  qIdx: number;
  // Module-scoped slice. mcq: number | null; SPR: string | null. Either
  // non-nullish value counts as "answered" for the navigator badge.
  sectionResponses: ResponseValue[];
  // #16: predicate closing over the marked Set + module key prefix (the global
  // key format never leaks in here); marked squares get a bookmark corner badge.
  isMarked: (qi: number) => boolean;
  onGoToQuestion: (qi: number) => void;
  // #16: opens the Check-Your-Work page (it no longer submits directly — the
  // review page is the only path that calls submitModule).
  onOpenReview: () => void;
  // The FSM-next submit label, computed in TestScreen and shared with the
  // Check-Your-Work page.
  submitLabel: string;
}

export function QuestionNavigator({
  section,
  modIdx,
  qIdx,
  sectionResponses,
  isMarked,
  onGoToQuestion,
  onOpenReview,
  submitLabel,
}: QuestionNavigatorProps) {
  const mod = section.modules[modIdx];
  return (
    <Card className="mt-4">
      <CardContent className="pt-6">
        <h2 className="text-base font-semibold mb-3">Question navigator</h2>
        <div className="flex flex-wrap gap-2 my-4">
          {mod.questions.map((_, i) => {
            const answered = isAnswered(sectionResponses[i] ?? null);
            const marked = isMarked(i);
            return (
              <button
                key={i}
                aria-label={clsx(
                  `Question ${i + 1},`,
                  answered ? 'answered' : 'unanswered',
                  marked && ', marked for review',
                )}
                className={clsx(
                  'relative w-10 h-10 rounded-md bg-slate-100 text-slate-900 font-semibold border border-slate-200 cursor-pointer',
                  answered && 'bg-blue-600 text-white border-blue-600',
                  i === qIdx && 'outline outline-2 outline-blue-300',
                )}
                onClick={() => onGoToQuestion(i)}
              >
                {i + 1}
                {marked && (
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    fill="currentColor"
                    className="absolute -right-1 -top-1 h-3.5 w-3.5 text-amber-500 drop-shadow-sm"
                  >
                    <path d="M6 3.5A1.5 1.5 0 0 1 7.5 2h9A1.5 1.5 0 0 1 18 3.5V21l-6-3.6L6 21V3.5Z" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2.5 mt-2">
          <Button onClick={onOpenReview}>Review &amp; submit</Button>
        </div>
      </CardContent>
    </Card>
  );
}

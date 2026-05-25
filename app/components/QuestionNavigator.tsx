'use client';

import { clsx } from 'clsx';
import type { TestSection, ResponseValue } from '@/app/lib/test';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';

interface QuestionNavigatorProps {
  section: TestSection;
  modIdx: number;
  qIdx: number;
  // Module-scoped slice. mcq: number | null; SPR: string | null. Either
  // non-nullish value counts as "answered" for the navigator badge.
  sectionResponses: ResponseValue[];
  onGoToQuestion: (qi: number) => void;
  onSubmitModule: () => void;
  isLastSection: boolean;
  isLastModule: boolean;
  testLength: 'short' | 'full';
}

export function QuestionNavigator({
  section,
  modIdx,
  qIdx,
  sectionResponses,
  onGoToQuestion,
  onSubmitModule,
  isLastSection,
  isLastModule,
  testLength,
}: QuestionNavigatorProps) {
  const mod = section.modules[modIdx];
  // Submit-button label picks up the FSM-next transition. Cosmetic polish
  // for full-test module indicators is sub-project #11 Commit 5; this label
  // is the minimum the FSM needs to communicate the next step.
  const submitLabel = testLength === 'short'
    ? (isLastSection ? 'Submit test' : 'Submit section')
    : !isLastModule
      ? 'Continue to Module 2'
      : isLastSection
        ? 'Submit test'
        : 'Submit section';
  return (
    <Card className="mt-4">
      <CardContent className="pt-6">
        <h2 className="text-base font-semibold mb-3">Question navigator</h2>
        <div className="flex flex-wrap gap-2 my-4">
          {mod.questions.map((_, i) => {
            const r = sectionResponses[i];
            // mcq: any number (including 0) means answered. spr: non-empty
            // string means answered. null / undefined / "" means unanswered.
            const answered =
              typeof r === 'number' || (typeof r === 'string' && r.trim() !== '');
            return (
              <button
                key={i}
                className={clsx(
                  'w-10 h-10 rounded-md bg-slate-100 text-slate-900 font-semibold border border-slate-200 cursor-pointer',
                  answered && 'bg-blue-600 text-white border-blue-600',
                  i === qIdx && 'outline outline-2 outline-blue-300',
                )}
                onClick={() => onGoToQuestion(i)}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2.5 mt-2">
          <Button onClick={onSubmitModule}>{submitLabel}</Button>
        </div>
      </CardContent>
    </Card>
  );
}

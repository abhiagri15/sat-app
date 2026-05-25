'use client';

import { clsx } from 'clsx';
import type { TestSection, ResponseValue } from '@/app/lib/test';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';

interface QuestionNavigatorProps {
  section: TestSection;
  qIdx: number;
  // mcq: number | null; SPR: string | null. Either non-nullish value counts
  // as "answered" for the navigator badge.
  sectionResponses: ResponseValue[];
  onGoToQuestion: (qi: number) => void;
  onSubmitSection: () => void;
  isLastSection: boolean;
}

export function QuestionNavigator({
  section,
  qIdx,
  sectionResponses,
  onGoToQuestion,
  onSubmitSection,
  isLastSection,
}: QuestionNavigatorProps) {
  return (
    <Card className="mt-4">
      <CardContent className="pt-6">
        <h2 className="text-base font-semibold mb-3">Question navigator</h2>
        <div className="flex flex-wrap gap-2 my-4">
          {section.questions.map((_, i) => {
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
          <Button onClick={onSubmitSection}>
            {isLastSection ? 'Submit test' : 'Submit section'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

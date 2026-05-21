'use client';

import { clsx } from 'clsx';
import type { TestSection } from '@/app/lib/test';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';

interface QuestionNavigatorProps {
  section: TestSection;
  qIdx: number;
  sectionResponses: (number | null)[];
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
          {section.questions.map((_, i) => (
            <button
              key={i}
              className={clsx(
                'w-10 h-10 rounded-md bg-slate-100 text-slate-900 font-semibold border border-slate-200 cursor-pointer',
                sectionResponses[i] !== null && sectionResponses[i] !== undefined && 'bg-blue-600 text-white border-blue-600',
                i === qIdx && 'outline outline-2 outline-blue-300',
              )}
              onClick={() => onGoToQuestion(i)}
            >
              {i + 1}
            </button>
          ))}
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

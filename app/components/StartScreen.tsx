'use client';

import type { TestLength } from '@/app/lib/test';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { Label } from '@/app/components/ui/label';
import { cn } from '@/app/lib/utils';

interface StartScreenProps {
  testLength: TestLength;
  setTestLength: (l: TestLength) => void;
  onStart: () => void;
}

export function StartScreen({ testLength, setTestLength, onStart }: StartScreenProps) {
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-5 pt-6 pb-16">
      <Card>
        <CardContent className="pt-6">
          <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 mb-3">
            Digital SAT · Practice
          </span>
          <h1 className="text-3xl font-semibold mb-1.5">SAT Practice Test</h1>
          <p className="text-slate-500 mb-6">
            A full timed practice run with Reading &amp; Writing and Math sections. Answer the questions,
            submit, and get an instant score with a worked explanation for every problem. Each new test
            pulls fresh, randomized questions.
          </p>

          <Label className="block text-sm font-semibold">Test length</Label>
          <div className="flex flex-wrap gap-2.5 mt-2 mb-[18px]">
            <Button
              variant="secondary"
              className={cn(testLength === 'short' ? 'ring-2 ring-blue-500 bg-blue-50' : '')}
              onClick={() => setTestLength('short')}
            >
              Quick (10 + 10, ~25 min)
            </Button>
            <Button
              variant="secondary"
              className={cn(testLength === 'full' ? 'ring-2 ring-blue-500 bg-blue-50' : '')}
              onClick={() => setTestLength('full')}
            >
              Full sections (all questions)
            </Button>
          </div>

          <div className="flex flex-wrap gap-2.5 mt-2">
            <Button onClick={onStart}>Start Test</Button>
          </div>
          <p className="text-sm text-slate-500 mt-3">
            Tip: the timer counts down per section, just like the real SAT. When time runs out, the
            section auto-advances.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

'use client';

import type { Test, Results } from '@/app/lib/test';
import type { SaveStatus } from '@/app/hooks/useTestSession';
import { ReviewItem } from './ReviewItem';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';

interface ResultsScreenProps {
  test: Test;
  responses: (number | null)[][];
  results: Results;
  saveStatus: SaveStatus;
  showReview: boolean;
  onToggleReview: () => void;
  onNewTest: () => void;
}

export function ResultsScreen({
  test, responses, results, saveStatus, showReview, onToggleReview, onNewTest,
}: ResultsScreenProps) {
  const { perSection, pct, scaled } = results;
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-5 pt-6 pb-16">
      <Card>
        <CardContent className="pt-6">
          <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 mb-3">
            {test.name}
          </span>
          <h1 className="text-3xl font-semibold mb-1.5">Your results</h1>
          <div className="text-center py-2 pb-4">
            <div className="text-6xl font-extrabold text-blue-600 leading-none">{scaled}</div>
            <div className="text-slate-500 mt-1.5">Estimated SAT score (400–1600)</div>
          </div>
          <div className="h-3 rounded-full bg-slate-200 overflow-hidden my-4 mb-1.5">
            <span className="block h-full bg-blue-600" style={{ width: `${Math.round(pct * 100)}%` }} />
          </div>
          <div className="flex flex-wrap gap-3.5 my-4">
            {perSection.map((s) => (
              <div key={s.name} className="bg-slate-50 rounded-md px-4 py-2.5 text-center min-w-[120px]">
                <div className="text-2xl font-bold">{s.correct}/{s.total}</div>
                <div className="text-xs text-slate-500 mt-0.5">{s.name}</div>
              </div>
            ))}
            <div className="bg-slate-50 rounded-md px-4 py-2.5 text-center min-w-[120px]">
              <div className="text-2xl font-bold">{Math.round(pct * 100)}%</div>
              <div className="text-xs text-slate-500 mt-0.5">Overall correct</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2.5 mt-2">
            <Button onClick={onNewTest}>Start a New Test</Button>
            <Button variant="secondary" onClick={onToggleReview}>
              {showReview ? 'Hide full review' : 'Show full review'}
            </Button>
          </div>
          {saveStatus === 'saving' && (
            <p className="text-sm text-slate-500 mt-3">Saving to your dashboard…</p>
          )}
          {saveStatus === 'saved' && (
            <p className="text-sm text-emerald-700 mt-3">Saved to your dashboard ✓</p>
          )}
          {saveStatus === 'error' && (
            <p className="text-sm text-red-700 mt-3">
              Couldn’t save this attempt — your history may be incomplete.
            </p>
          )}
          <p className="text-sm text-slate-500 mt-3">
            Scaled score is an approximation based on percent correct, for practice motivation only. Focus
            on the explanations below to learn from each question.
          </p>
        </CardContent>
      </Card>

      {showReview && (
        <div className="mt-[18px]">
          {test.sections.map((sec, si) => (
            <div key={si}>
              <h2 className="text-base font-semibold my-[22px] mb-3">
                {sec.name} — review
              </h2>
              {sec.questions.map((q, qi) => (
                <ReviewItem key={qi} question={q} chosenIndex={responses[si][qi]} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

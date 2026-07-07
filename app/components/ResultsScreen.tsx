'use client';

import Link from 'next/link';
import type { Test, Results, ResponseValue } from '@/app/lib/test';
import { sectionQuestions } from '@/app/lib/test';
import type { SaveStatus } from '@/app/hooks/useTestSession';
import { ReviewItem } from './ReviewItem';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { CURVE_VERSION } from '@/app/lib/scoring';

interface ResultsScreenProps {
  test: Test;
  // 3-D responses matrix: [section][module][question].
  responses: ResponseValue[][][];
  results: Results;
  saveStatus: SaveStatus;
  saveError: string | null;
  onRetrySave: () => void;
  showReview: boolean;
  onToggleReview: () => void;
  onNewTest: () => void;
  breaksUsed: boolean;
}

export function ResultsScreen({
  test, responses, results, saveStatus, saveError, onRetrySave,
  showReview, onToggleReview, onNewTest, breaksUsed,
}: ResultsScreenProps) {
  const { perSection, pct, scaled } = results;
  const isShort = test.length === 'short';
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-5 pt-6 pb-16">
      <Card>
        <CardContent className="pt-6">
          <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 mb-3">
            {test.name}
          </span>
          {breaksUsed && (
            <span className="ml-2 inline-block rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
              Taken with breaks
            </span>
          )}
          <h1 className="text-3xl font-semibold mb-1.5">Your results</h1>
          <div className="text-center py-2 pb-4">
            <div className="text-6xl font-extrabold text-blue-600 leading-none">
              {scaled}
              {isShort && (
                <span className="ml-2 align-middle text-base font-normal text-slate-400">
                  (projected)
                </span>
              )}
            </div>
            <div className="text-slate-500 mt-1.5">Estimated score · Composite (400–1600)</div>
            <div className="text-slate-400 mt-1 text-sm">
              An estimate — typically within ±30 per section of a real administration.
            </div>
          </div>
          <div className="h-3 rounded-full bg-slate-200 overflow-hidden my-4 mb-1.5">
            <span className="block h-full bg-blue-600" style={{ width: `${Math.round(pct * 100)}%` }} />
          </div>
          <div className="grid grid-cols-1 gap-3 my-4 sm:grid-cols-2">
            {perSection.map((s) => (
              <div key={s.sectionKey} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs uppercase tracking-wide text-slate-500">{s.name}</div>
                <div className="mt-1 text-3xl font-bold text-slate-900">{s.scaled}</div>
                <div className="mt-1 text-xs text-slate-600">
                  {s.correct} / {s.total} correct
                  {s.projectedRaw !== undefined && (
                    <span className="ml-2 text-slate-400">
                      (projected from {s.correct}/{s.total})
                    </span>
                  )}
                  {s.module2Path !== undefined && (
                    <span className="ml-2 text-slate-400">
                      (Module 2: {s.module2Path})
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2.5 mt-2">
            <Button onClick={onNewTest}>Start a New Test</Button>
            <Button variant="secondary" onClick={onToggleReview}>
              {showReview ? 'Hide full review' : 'Show full review'}
            </Button>
          </div>
          <p className="mt-3 text-sm text-slate-600">
            <Link
              href="/practice"
              className="font-medium text-blue-600 underline hover:text-blue-700"
            >
              Strengthen your weak areas → Practice
            </Link>
          </p>
          {saveStatus === 'saving' && (
            <p className="text-sm text-slate-500 mt-3">Saving to your dashboard…</p>
          )}
          {saveStatus === 'saved' && (
            <p className="text-sm text-emerald-700 mt-3">Saved to your dashboard ✓</p>
          )}
          {saveStatus === 'error' && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="text-sm font-medium text-red-700">
                Couldn’t save this attempt yet.
              </p>
              <p className="mt-1 text-sm text-red-700">
                Your result is backed up on this device and will be saved
                automatically next time you open the app. You can also retry now.
              </p>
              {saveError && (
                <p className="mt-1 text-xs text-red-500">Details: {saveError}</p>
              )}
              <Button
                variant="secondary"
                onClick={onRetrySave}
                className="mt-2"
              >
                Retry save
              </Button>
            </div>
          )}
          <p className="text-sm text-slate-500 mt-3">
            Estimated using a College Board–published Digital SAT scoring curve
            ({CURVE_VERSION}).
          </p>
        </CardContent>
      </Card>

      {showReview && (
        <div className="mt-[18px]">
          {test.sections.map((sec, si) => {
            const flat = sectionQuestions(sec);
            // Build a parallel flat response array so each question's
            // ReviewItem gets the matching [section][module][question] value.
            const flatResponses: ResponseValue[] = sec.modules.flatMap(
              (m, mi) => m.questions.map((_, qi) => responses[si]?.[mi]?.[qi] ?? null),
            );
            return (
              <div key={si}>
                <h2 className="text-base font-semibold my-[22px] mb-3">
                  {sec.name} — review
                </h2>
                {flat.map((q, idx) => (
                  <ReviewItem key={idx} question={q} response={flatResponses[idx]} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

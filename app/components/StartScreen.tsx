'use client';

import { fmtTime } from '@/app/lib/test';
import type { TestLength } from '@/app/lib/test';
import type { SnapshotSummary } from '@/app/hooks/useTestSession';
import { Button } from '@/app/components/ui/button';
import { Card, CardContent } from '@/app/components/ui/card';
import { Label } from '@/app/components/ui/label';
import { cn } from '@/app/lib/utils';
import { setHideModule2Path } from '@/app/lib/auth/preferences';

interface StartScreenProps {
  testLength: TestLength;
  setTestLength: (l: TestLength) => void;
  onStart: () => void;
  loading: boolean;
  // Full-test assembly failure message; null when there's no error. Shown with
  // a retry affordance (the Start button). Cleared on the next start().
  startError?: string | null;
  dailyAttemptLimit: number;
  attemptsRemaining: number;
  hideModule2Path: boolean;
  breaksEnabled?: boolean;
  setBreaksEnabled?: (b: boolean) => void;
  // Mid-test crash recovery (spec §B). When a resumable snapshot exists, the
  // "Resume your test?" card is shown; null hides it.
  pendingSnapshot?: SnapshotSummary | null;
  onResumeSnapshot?: () => void;
  onDiscardSnapshot?: () => void;
}

// Human "saved X ago" for the resume card, from a client-clock ms timestamp.
function savedAgo(savedAt: number): string {
  const mins = Math.max(0, Math.round((Date.now() - savedAt) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
}

export function StartScreen({
  testLength,
  setTestLength,
  onStart,
  loading,
  startError = null,
  dailyAttemptLimit,
  attemptsRemaining,
  hideModule2Path,
  breaksEnabled = false,
  setBreaksEnabled = () => {},
  pendingSnapshot = null,
  onResumeSnapshot = () => {},
  onDiscardSnapshot = () => {},
}: StartScreenProps) {
  const limitReached = attemptsRemaining <= 0;
  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-5 pt-6 pb-16">
      {pendingSnapshot && (
        <Card className="mb-4 border-blue-300 bg-blue-50">
          <CardContent className="pt-6">
            <p className="text-sm font-semibold text-blue-900">Resume your test?</p>
            <p className="mt-1 text-sm text-blue-800">
              We found a {pendingSnapshot.testLength === 'full' ? 'full' : 'quick'} test in
              progress
              {pendingSnapshot.sectionName ? ` — ${pendingSnapshot.sectionName}` : ''}
              {pendingSnapshot.onBreak
                ? `, on the break with ${fmtTime(pendingSnapshot.remainingSeconds)} left`
                : `, ${fmtTime(pendingSnapshot.remainingSeconds)} remaining`}
              . Saved {savedAgo(pendingSnapshot.savedAt)}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2.5">
              <Button onClick={onResumeSnapshot}>Resume test</Button>
              <Button variant="secondary" onClick={onDiscardSnapshot}>
                Discard
              </Button>
            </div>
            <p className="mt-2 text-xs text-blue-700">
              The timer resumes where it left off — time while the tab was closed isn&rsquo;t
              counted.
            </p>
          </CardContent>
        </Card>
      )}
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
              Full (27 + 22)
            </Button>
          </div>

          {testLength === 'full' && (
            <label className="mb-[18px] flex items-start gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={breaksEnabled}
                onChange={(e) => setBreaksEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span>
                Allow breaks — show a Pause button so you can stop the clock and take a
                break. Leave unchecked for a strict, real-test timed run.
              </span>
            </label>
          )}

          {startError && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-4" role="alert">
              <p className="text-sm font-medium text-red-800">Couldn&rsquo;t start the test</p>
              <p className="mt-0.5 text-sm text-red-700">{startError}</p>
              {!limitReached && (
                <p className="mt-1 text-xs text-red-600">
                  Press &ldquo;Start Test&rdquo; below to try again, or switch to a Quick test.
                </p>
              )}
            </div>
          )}

          {limitReached ? (
            <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-900">
                {dailyAttemptLimit === 0 ? 'Testing is paused' : 'Daily limit reached'}
              </p>
              <p className="mt-0.5 text-sm text-amber-800">
                {dailyAttemptLimit === 0
                  ? 'An administrator has paused new tests. Check back later.'
                  : `You’ve used all ${dailyAttemptLimit} of your test${
                      dailyAttemptLimit === 1 ? '' : 's'
                    } for today. Come back tomorrow for more practice.`}
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2.5 mt-2">
                <Button onClick={onStart} disabled={loading}>
                  {loading ? 'Building your test…' : 'Start Test'}
                </Button>
              </div>
              <p className="text-sm text-slate-500 mt-2">
                {attemptsRemaining} of {dailyAttemptLimit} test
                {dailyAttemptLimit === 1 ? '' : 's'} remaining today.
              </p>
            </>
          )}
          <p className="text-sm text-slate-500 mt-3">
            Tip: the timer counts down per section, just like the real SAT. When time runs out, the
            section auto-advances.
          </p>

          <form action={setHideModule2Path} className="mt-4 border-t border-slate-200 pt-4">
            <label className="flex items-start gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                name="hide"
                defaultChecked={hideModule2Path}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              <span>
                Hide the &quot;Adaptive: Easier/Harder&quot; badge during Module 2 — matches the real
                Digital SAT, which doesn&apos;t show students which path they took.
                <button
                  type="submit"
                  className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-200"
                >
                  Save preference
                </button>
              </span>
            </label>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

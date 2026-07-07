'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/app/components/ui/button';
import { fmtTime } from '@/app/lib/test';

// Full-screen mandatory-break phase shown between the Reading & Writing and
// Math sections of a FULL test, matching the real Digital SAT's 10-minute
// break. The countdown itself lives in `useTestSession` on its OWN interval
// (separate from the section countdown) — this component only renders
// `remaining` and offers a "Resume early" affordance. It auto-advances when
// the hook's countdown hits zero.
//
// Section timers are frozen automatically while this screen is up: the
// section-countdown effect's guard is `screen !== 'test'`, so entering
// `'break'` stops that interval with no separate accounting.
export function BreakScreen({
  remaining,
  onResume,
}: {
  remaining: number;
  onResume: () => void;
}) {
  const resumeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    resumeRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white/95 px-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Section break"
    >
      <span className="inline-block rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
        Break
      </span>
      <h2 className="text-2xl font-semibold text-slate-800">Take a 10-minute break</h2>
      <div
        className="text-6xl font-extrabold tabular-nums text-blue-600"
        aria-live="polite"
        aria-label={`Time remaining ${fmtTime(remaining)}`}
      >
        {fmtTime(remaining)}
      </div>
      <p className="max-w-md text-center text-slate-500">
        This matches the real SAT&rsquo;s 10-minute break between the Reading &amp; Writing
        and Math sections. Your section timers are stopped. Math begins automatically when
        the break ends, or you can resume early.
      </p>
      <Button ref={resumeRef} onClick={onResume}>
        Resume early
      </Button>
    </div>
  );
}

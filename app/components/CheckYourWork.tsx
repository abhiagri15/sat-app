'use client';

import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import type { TestSection, ResponseValue } from '@/app/lib/test';
import { Button } from '@/app/components/ui/button';

// Small amber bookmark glyph used for both the legend and the marked-square
// corner badge. Inline SVG (no new dependency), styling matches the runner
// toolbar's amber accents.
function BookmarkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
      fill="currentColor"
    >
      <path d="M6 3.5A1.5 1.5 0 0 1 7.5 2h9A1.5 1.5 0 0 1 18 3.5V21l-6-3.6L6 21V3.5Z" />
    </svg>
  );
}

interface CheckYourWorkProps {
  section: TestSection;
  modIdx: number;
  // Module-scoped slice for the active module (already sliced by TestScreen).
  sectionResponses: ResponseValue[];
  // Predicate closing over the marked Set + the module's key prefix, so the
  // global "${sec}-${mod}-${qi}" key format never leaks into this component.
  isMarked: (qi: number) => boolean;
  // The FSM-next submit label (computed once in TestScreen and shared with the
  // navigator): "Continue to Module 2" / "Submit section" / "Submit test".
  submitLabel: string;
  onJump: (qi: number) => void;
  onBack: () => void;
  onSubmit: () => void;
}

// The "Check your work" page — Bluebook's pre-submit review. Rendered by
// TestScreen in place of the question + navigator while moduleReview is open;
// the TopBar (with the live section timer) stays visible above it. Purely
// presentational: every action is a callback. On mount focus moves to the
// heading (PausedOverlay/BreakScreen precedent) so keyboard/SR users aren't
// stranded when the question view is swapped out.
export function CheckYourWork({
  section,
  modIdx,
  sectionResponses,
  isMarked,
  submitLabel,
  onJump,
  onBack,
  onSubmit,
}: CheckYourWorkProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mod = section.modules[modIdx];

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-5 pt-6 pb-16">
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-2xl font-semibold text-slate-800 outline-none"
      >
        Check your work
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        {section.name} · Module {modIdx + 1} of {section.modules.length}
      </p>

      {/* Legend: answered / unanswered / marked for review. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-4 w-4 rounded-sm border border-blue-600 bg-blue-600" />
          Answered
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-4 w-4 rounded-sm border border-slate-300 bg-white" />
          Unanswered
        </span>
        <span className="inline-flex items-center gap-2">
          <BookmarkIcon className="h-4 w-4 text-amber-500" />
          Marked for review
        </span>
      </div>

      {/* Grid of question squares: answered = filled blue, unanswered = hollow,
          marked = amber bookmark corner badge (states coexist). Click jumps
          back to that question. */}
      <div className="mt-5 flex flex-wrap gap-2">
        {mod.questions.map((_, i) => {
          const r = sectionResponses[i];
          const answered =
            typeof r === 'number' || (typeof r === 'string' && r.trim() !== '');
          const marked = isMarked(i);
          return (
            <button
              key={i}
              type="button"
              onClick={() => onJump(i)}
              aria-label={clsx(
                `Question ${i + 1},`,
                answered ? 'answered' : 'unanswered',
                marked && ', marked for review',
              )}
              className={clsx(
                'relative h-10 w-10 rounded-md border font-semibold transition',
                answered
                  ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                  : 'border-slate-300 bg-white text-slate-900 hover:border-blue-500 hover:bg-blue-50',
              )}
            >
              {i + 1}
              {marked && (
                <BookmarkIcon className="absolute -right-1 -top-1 h-3.5 w-3.5 text-amber-500 drop-shadow-sm" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-8 flex flex-wrap gap-2.5">
        <Button variant="secondary" onClick={onBack}>
          Back to question
        </Button>
        <Button onClick={onSubmit}>{submitLabel}</Button>
      </div>
    </div>
  );
}

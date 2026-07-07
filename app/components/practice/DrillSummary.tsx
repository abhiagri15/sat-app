'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { accuracyPct } from '@/app/lib/analytics/compute';
import type { DrillResult } from '@/app/lib/practice/payload';
import type { SaveStatus } from '@/app/hooks/usePracticeSession';
import {
  fetchSessionResponseTags,
  type PracticeResponseTagRow,
} from '@/app/lib/practice/session-reads';
import { MissReasonChips } from '@/app/components/MissReasonChips';

interface DrillSummaryProps {
  skill: string;
  results: DrillResult[];
  correctCount: number;
  saveStatus: SaveStatus;
  saveError: string | null;
  // The saved sat.practice_sessions id, once save succeeds (#18). Used to fetch
  // response ids so incorrect recap rows can render miss-reason chips.
  savedSessionId: string | null;
  onRestart: () => void;
  onRetrySave: () => void;
  nextFocus?: { skill: string; slug: string };
}

// Truncate a long prompt for the per-question recap line.
function truncate(text: string, max = 80): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

// End-of-drill summary: score hero, per-question recap, save-status line, and a
// CTA row. 'use client' — once save completes it fetches the saved response ids
// (RLS-scoped) so each incorrect recap row can render a miss-reason chip set
// (#18), mapped to results by `position` (the drill index, persisted verbatim).
export function DrillSummary({
  skill: _skill,
  results,
  correctCount,
  saveStatus,
  saveError,
  savedSessionId,
  onRestart,
  onRetrySave,
  nextFocus,
}: DrillSummaryProps) {
  const total = results.length;
  const pct = accuracyPct(correctCount, total);

  // Map of position → saved response row, for the miss-reason chips. Empty
  // until the fetch resolves; degrades silently on any error (no chips).
  const [tagRows, setTagRows] = useState<Map<number, PracticeResponseTagRow>>(
    new Map(),
  );

  // Fetch the saved response ids once, when save has succeeded and we have a
  // session id. Guarded against a stale set if the session id changes (a
  // "Practice again" reuses this component instance).
  useEffect(() => {
    if (saveStatus !== 'saved' || !savedSessionId) return;
    let cancelled = false;
    void fetchSessionResponseTags(savedSessionId).then((rows) => {
      if (cancelled) return;
      setTagRows(new Map(rows.map((r) => [r.position, r])));
    });
    return () => {
      cancelled = true;
    };
  }, [saveStatus, savedSessionId]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      {/* Score hero */}
      <div className="text-center">
        <p className="text-3xl font-bold text-slate-900">
          {correctCount}/{total} correct
        </p>
        <p className="mt-1 text-sm text-slate-500">{pct}% on this drill</p>
        <div className="mx-auto mt-3 h-2.5 max-w-xs rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-blue-600"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Per-question recap */}
      <ul className="mt-6 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {results.map((r, i) => {
          // The saved response row for this recap line, mapped by position (the
          // drill index). Present only after the fetch resolves. Chips render on
          // incorrect rows that have a row id (the RPC rejects correct ones).
          const tagRow = tagRows.get(i);
          return (
            <li key={i} className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <span className="w-5 shrink-0 text-xs font-medium text-slate-400">
                  {i + 1}
                </span>
                <span
                  aria-hidden="true"
                  className={
                    r.isCorrect
                      ? 'font-bold text-green-600'
                      : 'font-bold text-red-600'
                  }
                >
                  {r.isCorrect ? '✓' : '✗'}
                </span>
                <span className="truncate text-sm text-slate-700">
                  {truncate(r.question.prompt)}
                </span>
                {/* Per-question time when captured (Task 4). Display-only. */}
                {r.timeMs != null && r.timeMs > 0 && (
                  <span className="ml-auto shrink-0 text-xs text-slate-400">
                    {Math.round(r.timeMs / 1000)}s
                  </span>
                )}
              </div>
              {/* Sub-project #18: miss-reason chips on incorrect rows, once the
                  saved response id is known. Server correctness governs (tagRow
                  is only fetched post-save); an untagged row seeds no selection. */}
              {!r.isCorrect && tagRow && !tagRow.is_correct && (
                <div className="pl-8">
                  <MissReasonChips
                    origin="practice"
                    responseId={tagRow.id}
                    initial={tagRow.miss_reason}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Save status */}
      <div className="mt-4 text-sm">
        {saveStatus === 'saving' && (
          <p className="text-slate-500">Saving…</p>
        )}
        {saveStatus === 'saved' && (
          <p className="text-slate-500">Saved to your history</p>
        )}
        {saveStatus === 'error' && (
          <p className="text-red-600">
            Couldn&apos;t save this drill
            {saveError ? ` — ${saveError}` : ''}.{' '}
            <button
              type="button"
              onClick={onRetrySave}
              className="font-medium underline hover:text-red-700"
            >
              Retry
            </button>
          </p>
        )}
      </div>

      {/* CTAs */}
      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRestart}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          Practice again
        </button>
        <Link
          href="/practice"
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Back to practice
        </Link>
        {nextFocus && (
          <Link
            href={`/practice/${nextFocus.slug}?drill=1`}
            className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 transition-colors hover:bg-amber-100"
          >
            Next focus area: {nextFocus.skill} →
          </Link>
        )}
      </div>
    </div>
  );
}

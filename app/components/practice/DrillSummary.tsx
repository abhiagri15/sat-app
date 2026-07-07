import Link from 'next/link';
import { accuracyPct } from '@/app/lib/analytics/compute';
import type { DrillResult } from '@/app/lib/practice/payload';
import type { SaveStatus } from '@/app/hooks/usePracticeSession';

interface DrillSummaryProps {
  skill: string;
  results: DrillResult[];
  correctCount: number;
  saveStatus: SaveStatus;
  saveError: string | null;
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
// CTA row. Plain (server-renderable — the callbacks come from the client FSM
// root above it).
export function DrillSummary({
  skill: _skill,
  results,
  correctCount,
  saveStatus,
  saveError,
  onRestart,
  onRetrySave,
  nextFocus,
}: DrillSummaryProps) {
  const total = results.length;
  const pct = accuracyPct(correctCount, total);

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
        {results.map((r, i) => (
          <li key={i} className="flex items-center gap-3 px-4 py-2.5">
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
          </li>
        ))}
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

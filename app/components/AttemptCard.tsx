import Link from 'next/link';
import type { AttemptSummary } from '@/app/lib/persistence/queries';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AttemptCard({ attempt }: { attempt: AttemptSummary }) {
  return (
    <Link
      href={`/dashboard/attempts/${attempt.id}`}
      className="block rounded-lg border border-slate-200 p-4 transition hover:border-blue-400 hover:bg-slate-50"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500">{formatDate(attempt.created_at)}</div>
          <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {attempt.test_length === 'full' ? 'Full' : 'Short'} test
          </span>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-blue-600">{attempt.scaled_score}</div>
          <div className="text-xs text-slate-500">
            {attempt.total_correct}/{attempt.total_questions} correct
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {attempt.section_breakdown.map((s) => (
          <span
            key={s.sectionKey}
            title={`${s.correct} / ${s.total} correct`}
            className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
          >
            {s.sectionKey === 'rw' ? 'R&W' : 'Math'} {s.scaled}
            {s.module2Path && (
              <span className="ml-1 text-slate-500">
                ({s.module2Path === 'harder' ? 'Harder' : 'Easier'})
              </span>
            )}
          </span>
        ))}
        {attempt.test_length === 'short' && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            Short
          </span>
        )}
        {attempt.breaks_used && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            With breaks
          </span>
        )}
      </div>
    </Link>
  );
}

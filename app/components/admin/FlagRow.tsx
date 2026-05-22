import Link from 'next/link';
import { resolveFlag } from '@/app/lib/admin/actions';
import type { QuestionFlag } from '@/app/lib/admin/flags';

const REASON_LABELS: Record<string, string> = {
  wrong_answer: 'Wrong answer',
  unclear: 'Unclear',
  typo: 'Typo / formatting',
  other: 'Other',
};

function truncate(s: string, n = 140): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// One flag row: reason, the flagged question (truncated, linked), the optional
// comment, and — for an open flag — a Mark-resolved form.
export function FlagRow({ flag }: { flag: QuestionFlag }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
          {REASON_LABELS[flag.reason] ?? flag.reason}
        </span>
        {flag.question_section && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
            {flag.question_section === 'rw' ? 'R&W' : 'Math'}
          </span>
        )}
        {flag.status === 'resolved' && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
            Resolved
          </span>
        )}
        {!flag.question_enabled && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700">
            Question disabled
          </span>
        )}
        <span className="text-slate-400">
          {new Date(flag.created_at).toLocaleDateString()}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-800">
        {truncate(flag.question_prompt)}
      </p>
      {flag.comment && (
        <p className="mt-1 text-xs italic text-slate-500">“{flag.comment}”</p>
      )}
      <div className="mt-2 flex items-center gap-3">
        <Link
          href={`/admin/questions/${flag.question_id}`}
          className="text-xs text-blue-600 underline"
        >
          View question
        </Link>
        {flag.status === 'open' && (
          <form action={resolveFlag.bind(null, flag.id)}>
            <button
              type="submit"
              className="rounded bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200"
            >
              Mark resolved
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

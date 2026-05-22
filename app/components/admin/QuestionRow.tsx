import Link from 'next/link';
import { setQuestionEnabled } from '@/app/lib/admin/actions';
import type { AdminQuestion } from '@/app/lib/admin/queries';

function truncate(s: string, n = 120): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// One question-pool row: metadata, truncated prompt, and an enable/disable
// toggle (a form bound to the setQuestionEnabled server action).
export function QuestionRow({ question }: { question: AdminQuestion }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
          {question.section === 'rw' ? 'R&W' : 'Math'}
        </span>
        <span className="text-slate-500">{question.skill}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">
          {question.source}
        </span>
        {question.enabled ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
            Enabled
          </span>
        ) : (
          <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">
            Disabled
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-800">{truncate(question.prompt)}</p>
      <div className="mt-2 flex items-center gap-3">
        <Link
          href={`/admin/questions/${question.id}`}
          className="text-xs text-blue-600 underline"
        >
          View
        </Link>
        <form action={setQuestionEnabled.bind(null, question.id, !question.enabled)}>
          <button
            type="submit"
            className={`rounded px-2.5 py-1 text-xs font-medium ${
              question.enabled
                ? 'bg-red-50 text-red-700 hover:bg-red-100'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            {question.enabled ? 'Disable' : 'Enable'}
          </button>
        </form>
      </div>
    </div>
  );
}

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getQuestion } from '@/app/lib/admin/queries';
import { setQuestionEnabled } from '@/app/lib/admin/actions';
import { LETTERS } from '@/app/lib/test';

export default async function AdminQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const q = await getQuestion(id);
  if (!q) notFound();

  const choices = Array.isArray(q.choices) ? (q.choices as string[]) : [];

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/admin" className="text-sm text-blue-600 underline">
        ← Back to the pool
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded bg-slate-100 px-1.5 py-0.5">
          {q.section === 'rw' ? 'Reading & Writing' : 'Math'}
        </span>
        <span>{q.skill}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5">{q.source}</span>
        <span>{q.id}</span>
        {q.enabled ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
            Enabled
          </span>
        ) : (
          <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">
            Disabled
          </span>
        )}
      </div>

      {q.passage && (
        <div className="mt-4 whitespace-pre-wrap rounded-md border-l-4 border-blue-500 bg-slate-50 p-4 text-sm">
          {q.passage}
        </div>
      )}

      <h1 className="mt-4 text-lg font-semibold">{q.prompt}</h1>

      <ul className="mt-3 space-y-1.5">
        {choices.map((c, i) => (
          <li
            key={i}
            className={`rounded-md border p-2 text-sm ${
              i === q.answer_index
                ? 'border-emerald-300 bg-emerald-50 font-medium text-emerald-800'
                : 'border-slate-200'
            }`}
          >
            {LETTERS[i]}. {c}
            {i === q.answer_index && ' ✓'}
          </li>
        ))}
      </ul>

      <div className="mt-4 text-sm text-slate-700">
        <span className="font-semibold text-blue-700">Explanation: </span>
        {q.explanation}
      </div>

      <form
        action={setQuestionEnabled.bind(null, q.id, !q.enabled)}
        className="mt-6"
      >
        <button
          type="submit"
          className={`rounded px-3 py-1.5 text-sm font-medium ${
            q.enabled
              ? 'bg-red-50 text-red-700 hover:bg-red-100'
              : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
          }`}
        >
          {q.enabled ? 'Disable this question' : 'Enable this question'}
        </button>
      </form>
    </main>
  );
}

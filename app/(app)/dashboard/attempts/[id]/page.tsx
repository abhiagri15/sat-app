import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAttempt, responseToQuestion } from '@/app/lib/persistence/queries';
import { ReviewItem } from '@/app/components/ReviewItem';
import { SECTION_ORDER, SECTION_CONFIG } from '@/app/lib/questions';

export default async function AttemptReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getAttempt(id);
  if (!detail) notFound();

  const { attempt, responses } = detail;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/dashboard" className="text-sm text-blue-600 underline">
        ← Back to dashboard
      </Link>

      <h1 className="mt-3 text-2xl font-bold">Attempt review</h1>
      <div className="mt-1 text-sm text-slate-500">
        {new Date(attempt.created_at).toLocaleString()} ·{' '}
        {attempt.test_length === 'full' ? 'Full' : 'Short'} test
      </div>
      <div className="mt-3 flex flex-wrap items-baseline gap-4">
        <div className="text-4xl font-extrabold text-blue-600">
          {attempt.scaled_score}
          {attempt.test_length === 'short' && (
            <span className="ml-2 align-middle text-sm font-normal text-slate-400">
              (projected)
            </span>
          )}
        </div>
        <div className="text-slate-600">
          {attempt.total_correct}/{attempt.total_questions} correct
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {attempt.section_breakdown.map((s) => (
          <div key={s.sectionKey} className="rounded-lg border border-slate-200 p-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">{s.name}</div>
            <div className="mt-1 text-2xl font-bold text-slate-900">{s.scaled}</div>
            <div className="mt-1 text-xs text-slate-600">
              {s.correct} / {s.total} correct
            </div>
            {s.module2Path && (
              <div className="mt-1 text-xs text-slate-500">
                Module 2: {s.module2Path === 'harder' ? 'Harder' : 'Easier'} path
              </div>
            )}
          </div>
        ))}
      </div>

      {SECTION_ORDER.map((sectionKey) => {
        const rows = responses
          .filter((r) => r.section_key === sectionKey)
          .sort((a, b) => a.position - b.position);
        if (rows.length === 0) return null;
        return (
          <section key={sectionKey} className="mt-8">
            <h2 className="mb-3 text-base font-semibold">
              {SECTION_CONFIG[sectionKey].name} — review
            </h2>
            {rows.map((row) => (
              <ReviewItem
                key={row.id}
                question={responseToQuestion(row)}
                // For mcq rows pass chosen_index; for spr rows pass the
                // entered string. Either is null when skipped.
                response={row.response_format === 'spr' ? row.entered_value : row.chosen_index}
              />
            ))}
          </section>
        );
      })}
    </main>
  );
}

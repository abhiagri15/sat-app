import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getQuestion, getQuestionItemStats } from '@/app/lib/admin/queries';
import { setQuestionEnabled, setQuestionDifficulty } from '@/app/lib/admin/actions';
import { LETTERS } from '@/app/lib/test';
import { FigureView } from '@/app/components/FigureView';

const DIFFICULTY_BADGE: Record<'easy' | 'medium' | 'hard', string> = {
  easy:   'bg-blue-100 text-blue-700',
  medium: 'bg-slate-200 text-slate-700',
  hard:   'bg-amber-100 text-amber-800',
};

async function updateDifficulty(id: string, formData: FormData): Promise<void> {
  'use server';
  const next = formData.get('difficulty') as 'easy' | 'medium' | 'hard';
  await setQuestionDifficulty(id, next);
}

export default async function AdminQuestionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const q = await getQuestion(id);
  if (!q) notFound();

  const stats = await getQuestionItemStats(q.id);
  const choices = Array.isArray(q.choices) ? (q.choices as string[]) : [];
  // Empirical p-value only meaningful once there's a sample.
  const pValue = stats.n > 0 ? stats.correct / stats.n : null;
  const avgTimeSec =
    stats.avgTimeMs != null ? Math.round(stats.avgTimeMs / 1000) : null;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/admin/questions" className="text-sm text-blue-600 underline">
        ← Back to the pool
      </Link>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span className="rounded bg-slate-100 px-1.5 py-0.5">
          {q.section === 'rw' ? 'Reading & Writing' : 'Math'}
        </span>
        <span>{q.skill}</span>
        <span className={`rounded-full px-2 py-0.5 font-medium ${DIFFICULTY_BADGE[q.difficulty]}`}>
          {q.difficulty}
        </span>
        {q.difficulty_source === 'empirical' ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">
            Empirically calibrated
          </span>
        ) : (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 font-medium text-slate-600">
            Model-labeled
          </span>
        )}
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
        {q.classified_at === null && (
          <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-yellow-800">
            unclassified
          </span>
        )}
      </div>

      {q.passage && (
        <div className="mt-4 whitespace-pre-wrap rounded-md border-l-4 border-blue-500 bg-slate-50 p-4 text-sm">
          {q.passage}
        </div>
      )}

      {q.figure != null && (
        <div className="mt-4">
          <FigureView figure={q.figure} />
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

      {/* Empirical item statistics (design spec §C) — real student performance
          across both response tables, plus open flags and the difficulty
          source. p-value drives the empirical difficulty calibration. */}
      <section className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700">Item statistics</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-slate-200 p-3 text-center">
            <div className="text-2xl font-bold text-slate-900">{stats.n}</div>
            <div className="text-xs text-slate-500">Responses (sample n)</div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3 text-center">
            <div className="text-2xl font-bold text-slate-900">
              {pValue != null ? `${Math.round(pValue * 100)}%` : '—'}
            </div>
            <div className="text-xs text-slate-500">
              p-value{stats.n > 0 ? ` (${stats.correct}/${stats.n} correct)` : ''}
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3 text-center">
            <div className="text-2xl font-bold text-slate-900">
              {avgTimeSec != null ? `${avgTimeSec}s` : '—'}
            </div>
            <div className="text-xs text-slate-500">Avg time</div>
          </div>
          <div className="rounded-lg border border-slate-200 p-3 text-center">
            <div
              className={`text-2xl font-bold ${
                stats.openFlags > 0 ? 'text-red-600' : 'text-slate-900'
              }`}
            >
              {stats.openFlags}
            </div>
            <div className="text-xs text-slate-500">Open flags</div>
          </div>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Difficulty is{' '}
          {q.difficulty_source === 'empirical'
            ? 'empirically calibrated from these responses'
            : 'model-labeled (calibrates automatically once this item has ≥ 10 graded responses)'}
          .
        </p>
      </section>

      <div className="mt-6 flex flex-wrap items-end gap-4">
        <form
          action={setQuestionEnabled.bind(null, q.id, !q.enabled)}
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

        <form action={updateDifficulty.bind(null, q.id)} className="flex items-end gap-2">
          <label className="flex flex-col text-xs text-slate-600">
            <span>Difficulty</span>
            <select
              name="difficulty"
              defaultValue={q.difficulty}
              className="mt-0.5 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
            >
              <option value="easy">easy</option>
              <option value="medium">medium</option>
              <option value="hard">hard</option>
            </select>
          </label>
          <button
            type="submit"
            className="rounded bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            Save
          </button>
        </form>
      </div>
    </main>
  );
}

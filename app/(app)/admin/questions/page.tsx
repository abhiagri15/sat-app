import Link from 'next/link';
import {
  listQuestions,
  getPoolCounts,
  type QuestionFilters,
} from '@/app/lib/admin/queries';
import { QuestionRow } from '@/app/components/admin/QuestionRow';

const SECTION_FILTERS: { label: string; section?: 'rw' | 'math' }[] = [
  { label: 'All sections', section: undefined },
  { label: 'Reading & Writing', section: 'rw' },
  { label: 'Math', section: 'math' },
];
const STATUS_FILTERS: { label: string; status?: 'enabled' | 'disabled' }[] = [
  { label: 'All', status: undefined },
  { label: 'Enabled', status: 'enabled' },
  { label: 'Disabled', status: 'disabled' },
];
const DIFFICULTY_FILTERS: { label: string; difficulty?: 'easy' | 'medium' | 'hard' }[] = [
  { label: 'Any difficulty', difficulty: undefined },
  { label: 'Easy', difficulty: 'easy' },
  { label: 'Medium', difficulty: 'medium' },
  { label: 'Hard', difficulty: 'hard' },
];

function filterHref(section?: string, status?: string, difficulty?: string): string {
  const p = new URLSearchParams();
  if (section) p.set('section', section);
  if (status) p.set('status', status);
  if (difficulty) p.set('difficulty', difficulty);
  const qs = p.toString();
  return qs ? `/admin/questions?${qs}` : '/admin/questions';
}

export default async function AdminQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ section?: string; status?: string; difficulty?: string }>;
}) {
  const sp = await searchParams;
  const filters: QuestionFilters = {
    section: sp.section === 'rw' || sp.section === 'math' ? sp.section : undefined,
    status:
      sp.status === 'enabled' || sp.status === 'disabled' ? sp.status : undefined,
    difficulty:
      sp.difficulty === 'easy' || sp.difficulty === 'medium' || sp.difficulty === 'hard'
        ? sp.difficulty
        : undefined,
  };

  const [counts, questions] = await Promise.all([
    getPoolCounts(),
    listQuestions(filters),
  ]);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Question pool</h1>
      <p className="text-sm text-slate-500">
        {counts.total} questions · {counts.enabled} enabled · {counts.disabled}{' '}
        disabled · {counts.ai} AI · {counts.seed} seed · {counts.rw} R&amp;W ·{' '}
        {counts.math} Math
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {SECTION_FILTERS.map((f) => {
          const active = filters.section === f.section;
          return (
            <Link
              key={f.label}
              href={filterHref(f.section, filters.status, filters.difficulty)}
              className={`rounded-full px-3 py-1 text-xs ${
                active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => {
          const active = filters.status === f.status;
          return (
            <Link
              key={f.label}
              href={filterHref(filters.section, f.status, filters.difficulty)}
              className={`rounded-full px-3 py-1 text-xs ${
                active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {DIFFICULTY_FILTERS.map((f) => {
          const active = filters.difficulty === f.difficulty;
          return (
            <Link
              key={f.label}
              href={filterHref(filters.section, filters.status, f.difficulty)}
              className={`rounded-full px-3 py-1 text-xs ${
                active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <div className="mt-6 space-y-2">
        {questions.length === 0 ? (
          <p className="text-sm text-slate-500">
            No questions match these filters.
          </p>
        ) : (
          questions.map((q) => <QuestionRow key={q.id} question={q} />)
        )}
      </div>
    </main>
  );
}

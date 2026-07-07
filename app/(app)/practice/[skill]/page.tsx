import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SECTION_CONFIG, SKILL_DOMAIN } from '@/app/lib/questions';
import { getAnalytics } from '@/app/lib/analytics/queries';
import { accuracyPct, focusAreas } from '@/app/lib/analytics/compute';
import {
  getPracticeSkillStats,
  getRecentDrills,
} from '@/app/lib/practice/queries';
import { slugToSkill, skillSlug } from '@/app/lib/practice/slug';
import { masteryTier } from '@/app/lib/practice/mastery';
import { getLesson } from '@/app/lib/lessons';
import { MasteryChip } from '@/app/components/practice/MasteryChip';
import { LessonView } from '@/app/components/practice/LessonView';
import { SkillDrill } from '@/app/components/practice/SkillDrill';

// Short "Jul 5" style date for the recent-drills list + stat line.
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

// In this repo's Next.js 15, params and searchParams are Promises — type them
// as such and await before use (see (app)/admin/users/page.tsx).
interface PageProps {
  params: Promise<{ skill: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SkillPracticePage({
  params,
  searchParams,
}: PageProps) {
  const { skill: slug } = await params;
  const entry = slugToSkill(slug);
  if (!entry) notFound();
  const { section, skill } = entry;

  const sp = await searchParams;
  const autoStart = sp.drill === '1';

  const [{ skills }, practiceStats, recentDrills] = await Promise.all([
    getAnalytics(),
    getPracticeSkillStats(),
    getRecentDrills(skill),
  ]);

  const lesson = getLesson(skill);

  // This skill's test stat (0/0 if never answered).
  const testStat = skills.find((s) => s.skill === skill);
  const testCorrect = testStat?.correct ?? 0;
  const testTotal = testStat?.total ?? 0;
  const tier = masteryTier(testCorrect, testTotal);
  const domain = SKILL_DOMAIN[skill];

  const practice = practiceStats[skill];

  // The next focus area to chain to: the first weakest skill that isn't this one.
  const nextFocusStat = focusAreas(skills).find((s) => s.skill !== skill);
  const nextFocus = nextFocusStat
    ? { skill: nextFocusStat.skill, slug: skillSlug(nextFocusStat.skill) }
    : undefined;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/practice" className="text-sm text-blue-600 underline">
        ← Practice
      </Link>

      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-slate-900">{skill}</h1>
          <MasteryChip tier={tier} />
        </div>
        {domain && (
          <p className="mt-0.5 text-sm text-slate-500">
            {SECTION_CONFIG[section].name} · {domain}
          </p>
        )}
        <p className="mt-2 text-sm text-slate-600">
          {testTotal > 0
            ? `${accuracyPct(testCorrect, testTotal)}% on tests (${testCorrect}/${testTotal})`
            : 'Not yet tested'}
          {practice && practice.sessions > 0 ? (
            <>
              {' · '}
              {practice.sessions} drill{practice.sessions === 1 ? '' : 's'}
              {practice.questions > 0
                ? ` · ${accuracyPct(practice.correct, practice.questions)}% in practice`
                : ''}
              {practice.lastPracticed
                ? ` · last practiced ${shortDate(practice.lastPracticed)}`
                : ''}
            </>
          ) : (
            ' · not practiced yet'
          )}
        </p>
      </header>

      <section className="mt-6">
        <SkillDrill
          section={section}
          skill={skill}
          autoStart={autoStart}
          nextFocus={nextFocus}
        />
      </section>

      <section className="mt-8">
        {lesson ? (
          <LessonView lesson={lesson} />
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
            Lesson coming soon for this skill. You can still practice above.
          </div>
        )}
      </section>

      {recentDrills.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-base font-semibold">Recent drills</h2>
          <ul className="overflow-hidden rounded-lg border border-slate-200">
            {recentDrills.map((d, i) => (
              <li
                key={d.id}
                className={`flex items-center justify-between px-4 py-3 text-sm ${
                  i > 0 ? 'border-t border-slate-100' : ''
                }`}
              >
                <span className="text-slate-600">{shortDate(d.createdAt)}</span>
                <span className="font-medium text-slate-800">
                  {d.correct}/{d.total} correct
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

import Link from 'next/link';
import { getAnalytics } from '@/app/lib/analytics/queries';
import { focusAreas } from '@/app/lib/analytics/compute';
import { getPracticeSkillStats } from '@/app/lib/practice/queries';
import { FocusAreaCard } from '@/app/components/practice/FocusAreaCard';
import { SkillCatalog } from '@/app/components/practice/SkillCatalog';

// The Practice hub. Turns analytics focus areas into targeted skill practice.
// Focus areas are the top-3 weakest tested skills; below them, the full skill
// catalog. Practice results feed this page only — never /analytics.
export default async function PracticePage() {
  const [{ skills }, practiceStats] = await Promise.all([
    getAnalytics(),
    getPracticeSkillStats(),
  ]);

  const focus = focusAreas(skills);

  // Per-skill test stats keyed from the analytics skills array.
  const skillStats: Record<string, { correct: number; total: number }> = {};
  for (const s of skills) {
    skillStats[s.skill] = { correct: s.correct, total: s.total };
  }

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-bold">Practice</h1>
      <p className="mt-1 text-sm text-slate-500">
        Targeted, untimed drills with instant feedback — start with your weakest
        skills.
      </p>

      {focus.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-base font-semibold">Your focus areas</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {focus.map((s, i) => (
              <FocusAreaCard
                key={s.skill}
                skill={s.skill}
                section={s.section}
                testCorrect={s.correct}
                testTotal={s.total}
                practice={practiceStats[s.skill]}
                rank={i + 1}
              />
            ))}
          </div>
        </section>
      ) : (
        <div className="mt-8 rounded-lg border border-amber-200 bg-amber-50 p-6">
          <p className="text-sm text-amber-900">
            Take a test to unlock your personalized focus areas. In the
            meantime, pick any skill below to start practicing.
          </p>
          <Link
            href="/"
            className="mt-3 inline-block text-sm font-medium text-amber-800 underline hover:text-amber-900"
          >
            Take a test →
          </Link>
        </div>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-base font-semibold">All skills</h2>
        <SkillCatalog skillStats={skillStats} practiceStats={practiceStats} />
      </section>
    </main>
  );
}

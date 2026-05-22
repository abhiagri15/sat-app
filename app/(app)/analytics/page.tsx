import Link from 'next/link';
import { getOrCreateProfile } from '@/app/lib/auth/profile';
import { getAnalytics } from '@/app/lib/analytics/queries';
import { accuracyPct, focusAreas } from '@/app/lib/analytics/compute';
import { ScoreTrend } from '@/app/components/analytics/ScoreTrend';
import { SkillAccuracy } from '@/app/components/analytics/SkillAccuracy';
import { SECTION_CONFIG } from '@/app/lib/questions';

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-center">
      <div className="text-2xl font-bold text-blue-600">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

export default async function AnalyticsPage() {
  const profile = await getOrCreateProfile();
  const { summary, sections, skills, trend } = await getAnalytics();

  if (summary.testsTaken === 0) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-2 text-2xl font-bold">Your analytics</h1>
        <p className="text-slate-600">
          Signed in as {profile?.full_name || profile?.email}.
        </p>
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 p-8 text-center">
          <p className="text-slate-600">Take a test to see your analytics.</p>
          <Link href="/" className="mt-3 inline-block text-blue-600 underline">
            Start a test
          </Link>
        </div>
      </main>
    );
  }

  const focus = focusAreas(skills);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-2xl font-bold">Your analytics</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Tests taken" value={summary.testsTaken} />
        <Stat label="Best score" value={summary.bestScore} />
        <Stat label="Average score" value={summary.averageScore} />
        <Stat label="Questions answered" value={summary.questionsAnswered} />
      </div>

      <section className="mt-8">
        <h2 className="mb-2 text-base font-semibold">Score trend</h2>
        <div className="rounded-lg border border-slate-200 p-4">
          <ScoreTrend trend={trend} />
        </div>
      </section>

      {sections.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">Section accuracy</h2>
          <div className="space-y-2">
            {sections.map((s) => {
              const pct = accuracyPct(s.correct, s.total);
              return (
                <div key={s.section}>
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>{SECTION_CONFIG[s.section].name}</span>
                    <span>
                      {s.correct}/{s.total} · {pct}%
                    </span>
                  </div>
                  <div className="mt-0.5 h-2.5 rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {focus.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">Focus areas</h2>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-800">
              Your weakest skills — worth some practice:
            </p>
            <ul className="mt-2 space-y-1">
              {focus.map((s) => (
                <li key={s.skill} className="text-sm text-amber-900">
                  {s.skill} — {accuracyPct(s.correct, s.total)}% ({s.correct}/
                  {s.total})
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {skills.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">Skill breakdown</h2>
          <SkillAccuracy skills={skills} />
        </section>
      )}
    </main>
  );
}

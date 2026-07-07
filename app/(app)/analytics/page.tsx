import Link from 'next/link';
import { getOrCreateProfile } from '@/app/lib/auth/profile';
import { getAnalytics, getPacing } from '@/app/lib/analytics/queries';
import { accuracyPct, focusAreas } from '@/app/lib/analytics/compute';
import { skillSlug } from '@/app/lib/practice/slug';
import { ScoreTrend } from '@/app/components/analytics/ScoreTrend';
import { SkillAccuracy } from '@/app/components/analytics/SkillAccuracy';
import { SECTION_CONFIG, SECTION_ORDER } from '@/app/lib/questions';

// A skill needs at least this many timed samples before its pacing average is
// shown — small samples make the mean noisy (design spec §A).
const MIN_TIMED_SAMPLES = 5;

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
  const [{ summary, sections, skills, trend }, pacing] = await Promise.all([
    getAnalytics(),
    getPacing(),
  ]);

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

  // --- Pacing (design spec §A) --------------------------------------------
  // Per-section average seconds/question vs the OFFICIAL budget, weighted by
  // timed samples (avgMs is already a per-question mean, so weight by `timed`).
  // Budget comes from SECTION_CONFIG.secsPerQ (derived from moduleSeconds —
  // never hardcode 71/95). timeMs never feeds any score computation.
  const sectionPacing = SECTION_ORDER.map((sec) => {
    const rows = pacing.filter((p) => p.section === sec && p.timed > 0);
    const totalTimed = rows.reduce((sum, r) => sum + r.timed, 0);
    if (totalTimed === 0) return null;
    const weightedMs = rows.reduce((sum, r) => sum + r.avgMs * r.timed, 0);
    const avgSec = Math.round(weightedMs / totalTimed / 1000);
    const budgetSec = Math.round(SECTION_CONFIG[sec].secsPerQ);
    return { section: sec, avgSec, budgetSec, over: avgSec > budgetSec };
  }).filter((x): x is NonNullable<typeof x> => x !== null);

  // Per-skill accuracy lookup for the slowest-skills table (skill+section key).
  const skillAcc = new Map(
    skills.map((s) => [`${s.section}|${s.skill}`, { correct: s.correct, total: s.total }]),
  );
  // The 5 slowest skills by avg time, min 5 timed samples, with accuracy.
  const slowestSkills = pacing
    .filter((p) => p.timed >= MIN_TIMED_SAMPLES)
    .sort((a, b) => b.avgMs - a.avgMs)
    .slice(0, 5)
    .map((p) => {
      const acc = skillAcc.get(`${p.section}|${p.skill}`);
      return {
        skill: p.skill,
        section: p.section,
        avgSec: Math.round(p.avgMs / 1000),
        accuracy: acc && acc.total > 0 ? accuracyPct(acc.correct, acc.total) : null,
      };
    });
  // Entire section hidden when no skill has ≥ MIN_TIMED_SAMPLES timed samples.
  const showPacing = slowestSkills.length > 0;

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

      {showPacing && (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">Pacing</h2>
          <p className="mb-3 text-sm text-slate-500">
            Your average time per question vs the official Digital SAT budget. Timing
            is measured for insight only — it never affects your score.
          </p>

          {sectionPacing.length > 0 && (
            <div className="space-y-2">
              {sectionPacing.map((sp) => (
                <div
                  key={sp.section}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg border border-slate-200 p-3 text-sm"
                >
                  <span className="font-medium text-slate-700">
                    {SECTION_CONFIG[sp.section].name}
                  </span>
                  <span className="text-slate-600">
                    {sp.avgSec}s avg{' '}
                    <span className="text-slate-400">/ {sp.budgetSec}s budget</span>{' '}
                    <span
                      className={
                        sp.over
                          ? 'font-medium text-amber-700'
                          : 'font-medium text-emerald-700'
                      }
                    >
                      {sp.over
                        ? `${sp.avgSec - sp.budgetSec}s over`
                        : `${sp.budgetSec - sp.avgSec}s under`}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

          <h3 className="mb-2 mt-5 text-sm font-semibold text-slate-700">
            Slowest skills
          </h3>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {slowestSkills.map((s) => (
              <li
                key={`${s.section}|${s.skill}`}
                className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2.5 text-sm"
              >
                <span className="text-slate-700">
                  <Link
                    href={`/practice/${skillSlug(s.skill)}`}
                    className="font-medium underline decoration-slate-300 hover:text-slate-900"
                  >
                    {s.skill}
                  </Link>{' '}
                  <span className="text-xs text-slate-400">
                    {SECTION_CONFIG[s.section].name}
                  </span>
                </span>
                <span className="text-slate-600">
                  {s.avgSec}s avg
                  {s.accuracy != null && (
                    <span className="ml-2 text-slate-400">· {s.accuracy}% correct</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {focus.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">Focus areas</h2>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm text-amber-800">
              Your weakest skills — worth some practice:
            </p>
            <ul className="mt-2 space-y-1.5">
              {focus.map((s) => (
                <li
                  key={s.skill}
                  className="flex flex-wrap items-baseline gap-x-2 text-sm text-amber-900"
                >
                  <span>
                    <Link
                      href={`/practice/${skillSlug(s.skill)}`}
                      className="font-medium underline decoration-amber-400 hover:text-amber-950"
                    >
                      {s.skill}
                    </Link>{' '}
                    — {accuracyPct(s.correct, s.total)}% ({s.correct}/{s.total})
                  </span>
                  <Link
                    href={`/practice/${skillSlug(s.skill)}?drill=1`}
                    className="text-amber-800 underline decoration-amber-400 hover:text-amber-950"
                  >
                    Practice this skill →
                  </Link>
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

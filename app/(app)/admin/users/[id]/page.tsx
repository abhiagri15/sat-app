import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getUserAnalyticsForAdmin,
  getUserProfileForAdmin,
} from '@/app/lib/admin/users';
import { accuracyPct, focusAreas } from '@/app/lib/analytics/compute';
import { ScoreTrend } from '@/app/components/analytics/ScoreTrend';
import { SkillAccuracy } from '@/app/components/analytics/SkillAccuracy';
import { SECTION_CONFIG } from '@/app/lib/questions';

// Per-user analytics for an admin. Renders the same view a student sees on
// /analytics, but for the selected user. The user_id comes from the URL; an
// unknown id 404s. Components (ScoreTrend, SkillAccuracy) and the math
// (accuracyPct, focusAreas) are reused as-is from the student-facing path.
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-center">
      <div className="text-2xl font-bold text-blue-600">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function displayName(
  profile: { full_name: string | null; email: string | null; id: string },
): string {
  if (profile.full_name && profile.full_name.trim().length > 0)
    return profile.full_name;
  if (profile.email && profile.email.trim().length > 0) return profile.email;
  return `User ${profile.id.slice(0, 8)}`;
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // Profile + analytics in parallel — neither depends on the other.
  const [profile, analytics] = await Promise.all([
    getUserProfileForAdmin(id),
    getUserAnalyticsForAdmin(id),
  ]);
  if (!profile) notFound();

  const { summary, sections, skills, trend } = analytics;
  const focus = focusAreas(skills);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/admin/users" className="text-sm text-blue-600 underline">
        ← Back to users
      </Link>

      <header className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold">{displayName(profile)}</h1>
          {profile.role === 'admin' && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              admin
            </span>
          )}
        </div>
        {profile.full_name && profile.email && (
          <p className="text-sm text-slate-500">{profile.email}</p>
        )}
        <p className="mt-1 text-xs text-slate-400">
          Joined {profile.created_at.slice(0, 10)}
        </p>
      </header>

      {summary.testsTaken === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-slate-300 p-8 text-center">
          <p className="text-slate-600">
            This user has not submitted any tests yet.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
                  Weakest skills — worth steering this student toward:
                </p>
                <ul className="mt-2 space-y-1">
                  {focus.map((s) => (
                    <li key={s.skill} className="text-sm text-amber-900">
                      {s.skill} — {accuracyPct(s.correct, s.total)}% (
                      {s.correct}/{s.total})
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
        </>
      )}
    </main>
  );
}

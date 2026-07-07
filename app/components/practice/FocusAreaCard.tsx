import Link from 'next/link';
import type { SectionKey } from '@/app/lib/questions';
import { SKILL_DOMAIN } from '@/app/lib/questions';
import { accuracyPct } from '@/app/lib/analytics/compute';
import { masteryTier } from '@/app/lib/practice/mastery';
import { skillSlug } from '@/app/lib/practice/slug';
import type { PracticeSkillStat } from '@/app/lib/practice/queries';
import { MasteryChip } from './MasteryChip';

// Short "Jul 5" style date for the practice line.
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

interface FocusAreaCardProps {
  skill: string;
  section: SectionKey;
  testCorrect: number;
  testTotal: number;
  practice?: PracticeSkillStat;
  rank: number;
}

// One "focus area" card on the /practice hub. Test accuracy drives the mastery
// chip; practice accuracy is shown as a separate line. Plain (server-renderable).
export function FocusAreaCard({
  skill,
  section: _section,
  testCorrect,
  testTotal,
  practice,
  rank,
}: FocusAreaCardProps) {
  const slug = skillSlug(skill);
  const tier = masteryTier(testCorrect, testTotal);
  const testPct = accuracyPct(testCorrect, testTotal);
  const domain = SKILL_DOMAIN[skill];

  return (
    <div className="flex flex-col rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="inline-block rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
            Focus #{rank}
          </span>
          <h3 className="mt-2 text-base font-semibold text-slate-900">{skill}</h3>
          {domain && <p className="text-xs text-slate-500">{domain}</p>}
        </div>
        <MasteryChip tier={tier} />
      </div>

      <div className="mt-3 space-y-1 text-sm text-slate-600">
        <p>
          {testTotal > 0 ? (
            <>
              {testPct}% on tests{' '}
              <span className="text-slate-400">
                · {testCorrect}/{testTotal}
              </span>
            </>
          ) : (
            'Not yet tested'
          )}
        </p>
        <p className="text-xs text-slate-500">
          {practice && practice.sessions > 0 ? (
            <>
              {practice.sessions} drill{practice.sessions === 1 ? '' : 's'}
              {practice.lastPracticed
                ? ` · last practiced ${shortDate(practice.lastPracticed)}`
                : ''}
            </>
          ) : (
            'Not practiced yet'
          )}
        </p>
      </div>

      <div className="mt-4 flex gap-2">
        <Link
          href={`/practice/${slug}`}
          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-center text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Learn
        </Link>
        <Link
          href={`/practice/${slug}?drill=1`}
          className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-center text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Practice
        </Link>
      </div>
    </div>
  );
}

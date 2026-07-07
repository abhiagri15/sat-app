import Link from 'next/link';
import {
  SECTION_ORDER,
  SECTION_CONFIG,
  DOMAINS,
  skillsInDomain,
} from '@/app/lib/questions';
import { accuracyPct } from '@/app/lib/analytics/compute';
import { masteryTier } from '@/app/lib/practice/mastery';
import { skillSlug } from '@/app/lib/practice/slug';
import type { PracticeSkillStat } from '@/app/lib/practice/queries';
import { MasteryChip } from './MasteryChip';

interface SkillCatalogProps {
  skillStats: Record<string, { correct: number; total: number }>;
  practiceStats: Record<string, PracticeSkillStat>;
}

// Every skill in the taxonomy, grouped by section then by content domain (in
// the official blueprint order). Each row links to that skill's practice page.
// Plain (server-renderable).
export function SkillCatalog({ skillStats, practiceStats }: SkillCatalogProps) {
  return (
    <div className="space-y-8">
      {SECTION_ORDER.map((section) => (
        <div key={section}>
          <h3 className="mb-3 text-base font-semibold text-slate-900">
            {SECTION_CONFIG[section].name}
          </h3>
          <div className="space-y-5">
            {DOMAINS[section].map((domain) => {
              const skills = skillsInDomain(section, domain);
              if (skills.length === 0) return null;
              return (
                <div key={domain}>
                  <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {domain}
                  </h4>
                  <ul className="overflow-hidden rounded-lg border border-slate-200">
                    {skills.map((skill, i) => {
                      const stat = skillStats[skill];
                      const practice = practiceStats[skill];
                      const tested = stat && stat.total > 0;
                      return (
                        <li key={skill}>
                          <Link
                            href={`/practice/${skillSlug(skill)}`}
                            className={`flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-slate-50 ${
                              i > 0 ? 'border-t border-slate-100' : ''
                            }`}
                          >
                            <span className="text-sm font-medium text-slate-800">
                              {skill}
                            </span>
                            <span className="flex items-center gap-3">
                              {tested ? (
                                <MasteryChip
                                  tier={masteryTier(stat.correct, stat.total)}
                                />
                              ) : (
                                <span className="text-xs text-slate-400">
                                  Not yet tested
                                </span>
                              )}
                              {practice && practice.sessions > 0 && (
                                <span className="hidden text-xs text-slate-500 sm:inline">
                                  {practice.sessions} drill
                                  {practice.sessions === 1 ? '' : 's'}
                                </span>
                              )}
                              <span
                                aria-hidden="true"
                                className="text-slate-300"
                              >
                                ›
                              </span>
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

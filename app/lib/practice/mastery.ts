import { accuracyPct } from '@/app/lib/analytics/compute';

// Mastery tiers, fed by TEST accuracy (the focus-area driver — practice
// accuracy is shown separately and does not move the tier).
export type MasteryTier = 'untested' | 'needs-work' | 'improving' | 'strong';

export function masteryTier(correct: number, total: number): MasteryTier {
  if (total === 0) return 'untested';
  const pct = accuracyPct(correct, total);
  if (pct < 60) return 'needs-work';
  if (pct < 80) return 'improving';
  return 'strong';
}

export const TIER_LABEL: Record<MasteryTier, string> = {
  untested: 'Not yet tested',
  'needs-work': 'Needs work',
  improving: 'Improving',
  strong: 'Strong',
};

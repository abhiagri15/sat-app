import type { MasteryTier } from '@/app/lib/practice/mastery';
import { TIER_LABEL } from '@/app/lib/practice/mastery';

// A small rounded-full mastery chip, tier-coloured. Plain (server-renderable).
// The tier is fed by TEST accuracy (see mastery.ts) — practice accuracy is
// surfaced separately and never colours this chip.
const TIER_CLASS: Record<MasteryTier, string> = {
  untested: 'bg-slate-100 text-slate-500',
  'needs-work': 'bg-amber-100 text-amber-800',
  improving: 'bg-blue-100 text-blue-800',
  strong: 'bg-green-100 text-green-800',
};

export function MasteryChip({ tier }: { tier: MasteryTier }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${TIER_CLASS[tier]}`}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

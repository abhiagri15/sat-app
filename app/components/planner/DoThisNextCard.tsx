import Link from 'next/link';
import { getPlannerInputs } from '@/app/lib/planner/queries';
import { buildWeekPlan } from '@/app/lib/planner/compute';

// "Do this next" card for the Practice hub (spec §B): surfaces the first
// not-done plan item (label + why + a CTA to it) plus a link to the full plan.
// Renders nothing when plan inputs are unavailable OR there is no actionable
// item — so a not-yet-migrated DB or an all-done week simply hides the card.
export async function DoThisNextCard() {
  let items: ReturnType<typeof buildWeekPlan>;
  try {
    const inputs = await getPlannerInputs();
    items = buildWeekPlan(inputs);
  } catch {
    return null;
  }

  const next = items.find((i) => !i.done);
  if (!next) return null;

  return (
    <section className="mt-8 rounded-lg border border-blue-200 bg-blue-50 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-blue-900">Do this next</h2>
        <Link
          href="/plan"
          className="text-xs font-medium text-blue-700 underline hover:text-blue-900"
        >
          See your plan →
        </Link>
      </div>
      <p className="mt-2 text-base font-medium text-blue-900">{next.label}</p>
      <p className="mt-0.5 text-sm text-blue-800">{next.why}</p>
      <Link
        href={next.href}
        className="mt-3 inline-block rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        {next.kind === 'test' ? 'Start now' : 'Start drilling'}
      </Link>
    </section>
  );
}

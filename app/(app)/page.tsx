import SatPractice from '@/app/components/SatPractice';
import { getOrCreateProfile } from '@/app/lib/auth/profile';
import { getAttemptUsage, getHideModule2Path } from '@/app/lib/config';
import { getPlannerInputs } from '@/app/lib/planner/queries';
import { buildWeekPlan } from '@/app/lib/planner/compute';

// A single subtle line for the start screen when a plan exists ("This week: X of
// Y plan items done — see your plan"). Returns null when there's no plan (or the
// planner reads are unavailable), so the start screen stays unchanged.
async function getPlanLine(): Promise<string | null> {
  try {
    const inputs = await getPlannerInputs();
    if (!inputs.plan) return null;
    const items = buildWeekPlan(inputs);
    if (items.length === 0) return null;
    const done = items.filter((i) => i.done).length;
    return `This week: ${done} of ${items.length} plan items done`;
  } catch {
    return null;
  }
}

export default async function Home() {
  const profile = await getOrCreateProfile();
  const studentName = profile?.full_name || profile?.email || 'Student';
  const usage = await getAttemptUsage();
  const hideModule2Path = await getHideModule2Path();
  const planLine = await getPlanLine();
  return (
    <SatPractice
      studentName={studentName}
      attemptsUsedToday={usage.used}
      dailyAttemptLimit={usage.limit}
      hideModule2Path={hideModule2Path}
      planLine={planLine}
    />
  );
}

import { getPlannerInputs } from '@/app/lib/planner/queries';
import {
  buildWeekPlan,
  overdueSkills,
  paceSummary,
} from '@/app/lib/planner/compute';
import { Card, CardContent } from '@/app/components/ui/card';
import { PlanSetupForm } from '@/app/components/planner/PlanSetupForm';
import { PlanView } from '@/app/components/planner/PlanView';

// The study-planner page (#18): a target/date/pace setup card when no plan
// exists, otherwise the computed weekly plan with a pace header, "this week"
// list (done items dimmed), and overdue-skill chips. Empty-data behavior is free
// from the pure compute (zero-history seeding).
export default async function PlanPage() {
  const inputs = await getPlannerInputs();

  // No plan row yet → the setup card. (getStudyPlan returns null on a missing
  // row OR a not-yet-migrated table, so both show the setup card.)
  if (!inputs.plan) {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-2 text-2xl font-bold">Your study plan</h1>
        <p className="mb-6 text-slate-600">
          Set a target score and (optionally) a test date, and we&rsquo;ll turn
          your results into a focused weekly plan.
        </p>
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-1 text-lg font-semibold">Set up your plan</h2>
            <p className="mb-5 text-sm text-slate-500">
              You can change any of this later.
            </p>
            <PlanSetupForm />
          </CardContent>
        </Card>
      </main>
    );
  }

  const pace = paceSummary(inputs);
  const items = buildWeekPlan(inputs);
  const overdue = overdueSkills(inputs);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-bold">Your study plan</h1>
      <PlanView
        pace={pace}
        items={items}
        overdue={overdue}
        sessionsPerWeek={inputs.plan.sessionsPerWeek}
        planTarget={inputs.plan.targetScore}
        planTestDate={inputs.plan.testDate}
        planSessions={inputs.plan.sessionsPerWeek}
      />
    </main>
  );
}

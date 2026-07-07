'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveStudyPlan } from '@/app/lib/planner/actions';
import { Button } from '@/app/components/ui/button';
import { Label } from '@/app/components/ui/label';

interface PlanSetupFormProps {
  // Pre-fill values when editing an existing plan; blank defaults for a new one.
  initialTarget?: number;
  initialTestDate?: string | null;
  initialSessions?: number;
  // Rendered as an "edit" re-open (has a Cancel affordance) vs. first-time setup.
  editing?: boolean;
  onCancel?: () => void;
}

// Target scores 400–1600 in steps of 10 (spec §B).
const TARGET_OPTIONS: number[] = [];
for (let s = 1600; s >= 400; s -= 10) TARGET_OPTIONS.push(s);

const SESSION_OPTIONS = [2, 3, 4, 5, 6, 7];

export function PlanSetupForm({
  initialTarget = 1400,
  initialTestDate = null,
  initialSessions = 4,
  editing = false,
  onCancel,
}: PlanSetupFormProps) {
  const router = useRouter();
  const [target, setTarget] = useState(initialTarget);
  const [testDate, setTestDate] = useState(initialTestDate ?? '');
  const [sessions, setSessions] = useState(initialSessions);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await saveStudyPlan(target, testDate === '' ? null : testDate, sessions);
      if (!result.ok) {
        setError(result.error ?? 'Could not save your plan.');
        return;
      }
      // Server component re-reads the plan row on refresh → plan view renders.
      onCancel?.();
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="target">Target score</Label>
        <select
          id="target"
          value={target}
          onChange={(e) => setTarget(Number(e.target.value))}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
        >
          {TARGET_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500">
          The composite score you&rsquo;re aiming for (400&ndash;1600).
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="testDate">Test date (optional)</Label>
        <input
          id="testDate"
          type="date"
          value={testDate}
          onChange={(e) => setTestDate(e.target.value)}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
        />
        <p className="text-xs text-slate-500">
          Add your test day to get a countdown and paced weekly targets.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sessions">Sessions per week</Label>
        <select
          id="sessions"
          value={sessions}
          onChange={(e) => setSessions(Number(e.target.value))}
          className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm"
        >
          {SESSION_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500">
          How many study sessions you want to plan for each week (2&ndash;7).
        </p>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex flex-wrap gap-2.5">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : editing ? 'Save changes' : 'Create my plan'}
        </Button>
        {editing && onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

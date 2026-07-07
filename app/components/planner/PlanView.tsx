'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { PlanItem, OverdueSkill, PaceSummary } from '@/app/lib/planner/compute';
import { Card, CardContent } from '@/app/components/ui/card';
import { Button } from '@/app/components/ui/button';
import { PlanSetupForm } from './PlanSetupForm';

interface PlanViewProps {
  pace: PaceSummary;
  items: PlanItem[];
  overdue: OverdueSkill[];
  sessionsPerWeek: number;
  // Raw plan values, for re-opening the setup form pre-filled.
  planTarget: number;
  planTestDate: string | null;
  planSessions: number;
}

function PaceStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-center">
      <div className="text-2xl font-bold text-blue-600">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

export function PlanView({
  pace,
  items,
  overdue,
  sessionsPerWeek,
  planTarget,
  planTestDate,
  planSessions,
}: PlanViewProps) {
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <Card>
        <CardContent className="pt-6">
          <h2 className="mb-1 text-lg font-semibold">Edit your plan</h2>
          <p className="mb-5 text-sm text-slate-500">
            Update your target, test date, or weekly pace.
          </p>
          <PlanSetupForm
            initialTarget={planTarget}
            initialTestDate={planTestDate}
            initialSessions={planSessions}
            editing
            onCancel={() => setEditing(false)}
          />
        </CardContent>
      </Card>
    );
  }

  const doneCount = items.filter((i) => i.done).length;

  return (
    <div className="space-y-8">
      {/* Pace header */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-base font-semibold">Your pace</h2>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-sm text-slate-500 underline decoration-slate-300 hover:text-slate-900"
          >
            Edit plan
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <PaceStat
            label="Current estimate"
            value={pace.current === null ? '—' : String(pace.current)}
          />
          <PaceStat label="Target" value={pace.target === null ? '—' : String(pace.target)} />
          <PaceStat
            label="Points to go"
            value={pace.gap === null ? '—' : String(Math.max(0, pace.gap))}
          />
          <PaceStat
            label="Days to test"
            value={pace.daysToTest === null ? '—' : String(Math.max(0, pace.daysToTest))}
          />
        </div>
        <p className="mt-3 text-sm text-slate-600">{pace.paceNote}</p>
      </section>

      {/* This week */}
      <section>
        <h2 className="mb-1 text-base font-semibold">This week</h2>
        <p className="mb-3 text-sm text-slate-500">
          {doneCount} of {items.length} done · {sessionsPerWeek} sessions/week
        </p>
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {items.map((item, i) => (
            <li
              key={`${item.kind}-${item.slug ?? item.label}-${i}`}
              className="flex items-start gap-3 px-4 py-3"
            >
              <span
                aria-hidden
                className={
                  item.done
                    ? 'mt-0.5 text-emerald-600'
                    : 'mt-0.5 text-slate-300'
                }
              >
                {item.done ? '✓' : '○'}
              </span>
              <div className={item.done ? 'flex-1 opacity-60' : 'flex-1'}>
                <div className="text-sm font-medium text-slate-800">
                  {item.done ? (
                    <span>{item.label}</span>
                  ) : (
                    <Link
                      href={item.href}
                      className="underline decoration-slate-300 hover:text-slate-900"
                    >
                      {item.label}
                    </Link>
                  )}
                </div>
                <div className="text-xs text-slate-500">{item.why}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Overdue skills */}
      {overdue.length > 0 && (
        <section>
          <h2 className="mb-1 text-base font-semibold">Overdue skills</h2>
          <p className="mb-3 text-sm text-slate-500">
            Weak and untouched lately — a few reps keeps them from sliding.
          </p>
          <div className="flex flex-wrap gap-2">
            {overdue.map((od) => (
              <Link
                key={od.slug}
                href={`/practice/${od.slug}`}
                className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100"
              >
                {od.skill} · {od.accuracy}%
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

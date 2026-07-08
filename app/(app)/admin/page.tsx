import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  getPoolCounts,
  getReviewQueue,
  getHealthSummary,
} from '@/app/lib/admin/queries';
import type { HealthSummary } from '@/app/lib/admin/queries';
import { getUsersStats } from '@/app/lib/admin/users';
import { countOpenFlags } from '@/app/lib/admin/flags';
import { getDailyAttemptLimit } from '@/app/lib/config';

// Admin Overview — the /admin landing page. Each card summarises one
// section (counts / key stat) and links into it. Detail listings live one
// click away (Question Pool, Users, etc.). The nav at the top of the page
// (rendered by the admin layout) is the primary way to switch sections;
// these cards are a glance + entry point.

interface CardProps {
  title: string;
  href: string;
  description: string;
  stats: { label: string; value: ReactNode }[];
}

function Card({ title, href, description, stats }: CardProps) {
  return (
    <Link
      href={href}
      className="block rounded-lg border border-slate-200 p-5 transition hover:border-blue-300 hover:bg-blue-50"
    >
      <h2 className="text-lg font-semibold text-slate-900">{title} →</h2>
      <p className="mt-0.5 text-xs text-slate-500">{description}</p>
      <dl className="mt-3 space-y-1 text-sm text-slate-600">
        {stats.map((s) => (
          <div key={s.label} className="flex justify-between gap-3">
            <dt>{s.label}</dt>
            <dd className="font-medium text-slate-900">{s.value}</dd>
          </div>
        ))}
      </dl>
    </Link>
  );
}

// Absolute wall-clock time for a run (short, admin-facing).
function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Coarse "how long ago" — good enough for a once-a-day cron signal.
function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// Operational health at a glance (design spec §C2 / T4): recent save-failure
// count + the state of the last generation-cron run. Not a navigation target
// (no /admin/health page), so it is a plain panel rather than a linked Card —
// it reuses the Card's border/padding/typography so it sits in the grid
// cleanly. Attention styling turns on when save failures are present or the
// last run did not complete (a null completed_at = a killed/thrown run).
function HealthCard({ health }: { health: HealthSummary }) {
  const { saveFailures7d, lastRun } = health;
  const hasFailures = saveFailures7d > 0;
  const didNotComplete = lastRun !== null && lastRun.completedAt === null;
  const attention = hasFailures || didNotComplete;

  return (
    <div
      className={`block rounded-lg border p-5 ${
        attention ? 'border-red-300 bg-red-50' : 'border-slate-200'
      }`}
    >
      <h2 className="text-lg font-semibold text-slate-900">Health</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Save failures and the last generation run.
      </p>
      <dl className="mt-3 space-y-1 text-sm text-slate-600">
        <div className="flex justify-between gap-3">
          <dt>Save failures (7d)</dt>
          <dd
            className={`font-medium ${
              hasFailures ? 'text-red-700' : 'text-slate-900'
            }`}
          >
            {saveFailures7d}
          </dd>
        </div>
        {lastRun === null ? (
          <div className="flex justify-between gap-3">
            <dt>Last generation run</dt>
            <dd className="font-medium text-slate-500">no runs recorded yet</dd>
          </div>
        ) : (
          <>
            <div className="flex justify-between gap-3">
              <dt>Last generation run</dt>
              <dd
                className="font-medium text-slate-900"
                title={formatAbsolute(lastRun.startedAt)}
              >
                {formatRelative(lastRun.startedAt)}
              </dd>
            </div>
            {didNotComplete && (
              <div className="flex justify-between gap-3">
                <dt className="text-red-700">Status</dt>
                <dd className="font-medium text-red-700">did not complete</dd>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <dt>Accepted / calibrated / flagged</dt>
              <dd className="font-medium text-slate-900">
                {lastRun.accepted ?? '—'} / {lastRun.calibrated ?? '—'} /{' '}
                {lastRun.flaggedForReview ?? '—'}
              </dd>
            </div>
            {lastRun.aiEnabled === false && (
              <div className="flex justify-between gap-3">
                <dt>AI</dt>
                <dd className="font-medium text-amber-700">AI disabled</dd>
              </div>
            )}
          </>
        )}
      </dl>
    </div>
  );
}

export default async function AdminOverviewPage() {
  const [counts, userStats, openFlags, dailyLimit, reviewQueue, health] =
    await Promise.all([
      getPoolCounts(),
      getUsersStats(),
      countOpenFlags(),
      getDailyAttemptLimit(),
      getReviewQueue(),
      getHealthSummary(),
    ]);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Admin overview</h1>
      <p className="text-sm text-slate-500">
        Manage the question pool, users, flags, and app settings.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Card
          title="Question pool"
          href="/admin/questions"
          description="Browse and moderate generated questions."
          stats={[
            { label: 'Total', value: counts.total },
            { label: 'Enabled', value: counts.enabled },
            { label: 'Disabled', value: counts.disabled },
            { label: 'AI / Seed', value: `${counts.ai} / ${counts.seed}` },
          ]}
        />
        <Card
          title="Users"
          href="/admin/users"
          description="See student activity and per-user analytics."
          stats={[
            { label: 'Total users', value: userStats.total },
            { label: 'Students', value: userStats.students },
            { label: 'Active (30d)', value: userStats.active },
          ]}
        />
        <Card
          title="Open flags"
          href="/admin/flags"
          description="Review user-reported issues with questions."
          stats={[{ label: 'Awaiting review', value: openFlags }]}
        />
        <Card
          title="Needs review"
          href="/admin/review"
          description="Item-quality anomalies: heavily flagged or too hard/easy."
          stats={[{ label: 'Needs review', value: reviewQueue.length }]}
        />
        <Card
          title="Settings"
          href="/admin/settings"
          description="App-wide configuration."
          stats={[{ label: 'Daily attempt limit', value: dailyLimit }]}
        />
        <HealthCard health={health} />
      </div>
    </main>
  );
}

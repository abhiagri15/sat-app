import Link from 'next/link';
import type { ReactNode } from 'react';
import { getPoolCounts } from '@/app/lib/admin/queries';
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

export default async function AdminOverviewPage() {
  const [counts, userStats, openFlags, dailyLimit] = await Promise.all([
    getPoolCounts(),
    getUsersStats(),
    countOpenFlags(),
    getDailyAttemptLimit(),
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
          title="Settings"
          href="/admin/settings"
          description="App-wide configuration."
          stats={[{ label: 'Daily attempt limit', value: dailyLimit }]}
        />
      </div>
    </main>
  );
}

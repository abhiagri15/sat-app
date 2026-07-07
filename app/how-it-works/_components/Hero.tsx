// app/how-it-works/_components/Hero.tsx
import Link from 'next/link';
import type { PublicPoolStats } from '@/app/lib/marketing/queries';

interface HeroProps {
  stats: PublicPoolStats | null;
}

export function Hero({ stats }: HeroProps) {
  return (
    <section id="top" className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
      <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
        Digital SAT practice, built around how the real test actually works.
      </h1>
      <p className="mt-4 max-w-2xl text-lg text-slate-600">
        Adaptive modules, every skill the College Board tests, a fresh question
        every time — plus targeted practice and a personal coach&apos;s update
        built from your own mistakes.
      </p>

      {stats && (
        <p className="mt-6 text-sm text-slate-500">
          <span className="font-semibold text-slate-900">{stats.totalEnabled}</span> questions
          {' · '}
          <span className="font-semibold text-slate-900">{stats.skillCount}</span> skills
          {' · '}
          refreshed hourly
        </p>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          href="/register"
          className="rounded-md bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Start practicing
        </Link>
        <Link
          href="/login"
          className="rounded-md px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
        >
          Sign in
        </Link>
      </div>
    </section>
  );
}

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface GuidanceRefresherProps {
  skill: string;
  // 'initial' — no guidance exists yet (first-ever generation); render a
  //   prominent shimmer card while it generates.
  // 'refresh' — guidance already exists but is stale; render a slim inline
  //   line under the existing CoachUpdate while it refreshes.
  mode: 'refresh' | 'initial';
}

type Phase = 'pending' | 'upToDate' | 'error';

// Small 'use client' wrapper that POSTs /api/practice/guidance on mount to
// (re)generate the student's coaching, then router.refresh()es to swap in the
// new content (see the Dynamic Practice spec §B/§E). Single-fire ref guard
// against React Strict Mode's dev double-invoke. Fully unobtrusive — the drill
// and lesson never depend on it.
export function GuidanceRefresher({ skill, mode }: GuidanceRefresherProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('pending');
  const firedRef = useRef(false);

  const run = useCallback(async () => {
    setPhase('pending');
    try {
      const res = await fetch('/api/practice/guidance', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skill }),
      });
      if (!res.ok) {
        setPhase('error');
        return;
      }
      const data = (await res.json()) as { status?: string };
      if (data.status === 'regenerated') {
        // New coaching landed — pull it in.
        router.refresh();
        return;
      }
      // 'fresh' | 'cooled_down' → the existing coaching is current.
      setPhase('upToDate');
    } catch {
      setPhase('error');
    }
  }, [skill, router]);

  // Fire once on mount (ref-guarded against Strict-Mode double-invoke).
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    void run();
  }, [run]);

  const retry = useCallback(() => {
    void run();
  }, [run]);

  if (phase === 'pending') {
    if (mode === 'initial') {
      return (
        <div className="animate-pulse rounded-lg border border-blue-200 bg-blue-50 p-4 sm:p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
            Updating your coaching…
          </div>
          <div className="mt-3 space-y-2">
            <div className="h-3 w-3/4 rounded bg-blue-200/70" />
            <div className="h-3 w-full rounded bg-blue-200/70" />
            <div className="h-3 w-5/6 rounded bg-blue-200/70" />
          </div>
        </div>
      );
    }
    // mode === 'refresh' — slim inline line under the existing CoachUpdate.
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-slate-500">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
        Updating your coaching…
      </p>
    );
  }

  if (phase === 'error') {
    return (
      <p className="mt-2 text-xs text-slate-500">
        Couldn&apos;t update coaching —{' '}
        <button
          type="button"
          onClick={retry}
          className="underline hover:text-slate-700"
        >
          retry
        </button>
      </p>
    );
  }

  // phase === 'upToDate' — subtle, unobtrusive confirmation.
  return (
    <p className="mt-2 text-xs text-slate-400">Your coaching is up to date.</p>
  );
}

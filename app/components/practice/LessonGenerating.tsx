'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface LessonGeneratingProps {
  skill: string;
}

type Phase = 'pending' | 'fallback';

// Small 'use client' banner shown above the static fallback lesson when no AI
// base lesson exists yet (see the Dynamic Practice spec §A/§E). On mount it
// POSTs /api/practice/lesson once (ref-guarded against Strict-Mode
// double-invoke); on success it router.refresh()es to swap in the AI lesson.
// The first visitor eats no blocking wait — the static lesson renders below
// immediately either way.
export function LessonGenerating({ skill }: LessonGeneratingProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('pending');
  const firedRef = useRef(false);

  const run = useCallback(async () => {
    try {
      const res = await fetch('/api/practice/lesson', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skill }),
      });
      if (!res.ok) {
        setPhase('fallback');
        return;
      }
      const data = (await res.json()) as { status?: string };
      // 'generated' — we just created it; 'exists' — another visitor beat us
      // to it. Either way an AI lesson is now stored: pull it in.
      if (data.status === 'generated' || data.status === 'exists') {
        router.refresh();
        return;
      }
      // 'failed' → keep serving the static lesson quietly (no retry loop).
      setPhase('fallback');
    } catch {
      setPhase('fallback');
    }
  }, [skill, router]);

  // Fire once on mount (ref-guarded against Strict-Mode double-invoke).
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    void run();
  }, [run]);

  return (
    <div className="mb-3 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
      {phase === 'pending' ? (
        <>
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
          A tailored version of this lesson is being prepared…
        </>
      ) : (
        'Using the standard lesson for now.'
      )}
    </div>
  );
}

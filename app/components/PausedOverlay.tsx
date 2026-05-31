'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/app/components/ui/button';

// Full-screen overlay shown while a test is paused. Covers ALL test content
// (passage, question, choices, calculator/reference, nav) so a break cannot be
// used to keep working. Its only control is Resume.
//
// Keyboard/AT integrity: the visual overlay blocks pointer access, but a
// keyboard user could otherwise Tab to the (visually hidden) question controls
// underneath. So on mount we move focus to Resume, and Escape resumes — keeping
// the "content is hidden until you resume" guarantee for keyboard users too.
export function PausedOverlay({ onResume }: { onResume: () => void }) {
  const resumeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    resumeRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onResume();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onResume]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Test paused"
    >
      <h2 className="text-2xl font-semibold text-slate-800">Paused</h2>
      <p className="max-w-sm text-center text-slate-500">
        Your timer is stopped. Take your time — the question is hidden until you resume.
      </p>
      <Button ref={resumeRef} onClick={onResume}>Resume test</Button>
    </div>
  );
}

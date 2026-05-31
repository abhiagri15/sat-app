'use client';

import { Button } from '@/app/components/ui/button';

// Full-screen overlay shown while a test is paused. Covers ALL test content
// (passage, question, choices, calculator/reference, nav) so a break cannot be
// used to keep working. Its only control is Resume.
export function PausedOverlay({ onResume }: { onResume: () => void }) {
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
      <Button onClick={onResume}>Resume test</Button>
    </div>
  );
}

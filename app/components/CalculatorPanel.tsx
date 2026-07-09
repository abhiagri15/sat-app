'use client';

import { useState } from 'react';

// Floating Desmos calculator panel shown during Math sections. The real
// Digital SAT bundles the Desmos GRAPHING calculator; we offer both via a
// segmented Scientific ⇄ Graphing toggle in the panel header (default
// Scientific — the lighter tool that handles ~95% of Math-section
// computation). The mode swaps the iframe src between the two Desmos embeds:
//   scientific → https://www.desmos.com/scientific?embed
//   graphing   → https://www.desmos.com/testing/cb-digital-sat/graphing
// Graphing MUST use the College Board testing build. The plain
// desmos.com/calculator?embed page renders ONLY bare graph paper at this
// panel width — no expression bar, nothing to type into (the 2026-07-09
// "graphing calc doesn't work" student report). The cb-digital-sat build is
// the actual Bluebook test-day calculator, frames cleanly, and stacks
// graph-over-expressions at 420px.

type CalcMode = 'scientific' | 'graphing';

const CALC_SRC: Record<CalcMode, string> = {
  scientific: 'https://www.desmos.com/scientific?embed',
  graphing: 'https://www.desmos.com/testing/cb-digital-sat/graphing',
};

interface Props {
  onClose: () => void;
}

export function CalculatorPanel({ onClose }: Props) {
  const [mode, setMode] = useState<CalcMode>('scientific');

  return (
    <aside
      className="fixed right-4 top-24 z-40 w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white shadow-xl"
      role="dialog"
      aria-label="Calculator"
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
        <div
          role="radiogroup"
          aria-label="Calculator mode"
          className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5"
        >
          {(['scientific', 'graphing'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={
                mode === m
                  ? 'rounded px-2.5 py-1 text-xs font-medium bg-white text-slate-900 shadow-sm'
                  : 'rounded px-2.5 py-1 text-xs font-medium text-slate-500 hover:text-slate-700'
              }
            >
              {m === 'scientific' ? 'Scientific' : 'Graphing'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close calculator"
          className="rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          ×
        </button>
      </header>
      <iframe
        key={mode}
        src={CALC_SRC[mode]}
        loading="lazy"
        title={mode === 'scientific' ? 'Desmos Scientific Calculator' : 'Desmos Graphing Calculator'}
        className="block h-[500px] w-full rounded-b-lg"
      />
    </aside>
  );
}

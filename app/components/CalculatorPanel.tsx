'use client';

// Floating Desmos scientific calculator panel shown during Math sections.
// The real Digital SAT bundles the Desmos graphing calculator; the scientific
// embed is the simpler/lighter substitute (one URL, no setup) and handles
// ~95% of Math-section computation. To upgrade to graphing later, change the
// iframe src to https://www.desmos.com/calculator?embed.

interface Props {
  onClose: () => void;
}

export function CalculatorPanel({ onClose }: Props) {
  return (
    <aside
      className="fixed right-4 top-24 z-40 w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white shadow-xl"
      role="dialog"
      aria-label="Calculator"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-medium text-slate-700">Calculator</h2>
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
        src="https://www.desmos.com/scientific?embed"
        loading="lazy"
        title="Desmos Scientific Calculator"
        className="block h-[500px] w-full rounded-b-lg"
      />
    </aside>
  );
}

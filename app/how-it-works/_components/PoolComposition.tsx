// app/how-it-works/_components/PoolComposition.tsx
import type { PublicPoolStats } from '@/app/lib/marketing/queries';

interface PoolCompositionProps {
  stats: PublicPoolStats | null;
}

type Section = 'rw' | 'math';
type Difficulty = 'easy' | 'medium' | 'hard';

const SECTIONS: { key: Section; label: string }[] = [
  { key: 'rw', label: 'Reading & Writing' },
  { key: 'math', label: 'Math' },
];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

export function PoolComposition({ stats }: PoolCompositionProps) {
  // Build a lookup keyed by 'section|difficulty' so missing cells default to 0.
  const cellLookup = new Map<string, number>();
  if (stats) {
    for (const c of stats.cells) {
      cellLookup.set(`${c.section}|${c.difficulty}`, c.count);
    }
  }

  return (
    <section id="pool" className="bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-bold text-slate-900">Live pool composition</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          These numbers update as the generator runs (hourly). What you see is
          what new sessions draw from.
        </p>

        {stats ? (
          <>
            <div className="mt-6 overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Section</th>
                    {DIFFICULTIES.map((d) => (
                      <th key={d} className="px-4 py-2 text-right capitalize">{d}</th>
                    ))}
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {SECTIONS.map((s) => {
                    const rowTotal = s.key === 'rw' ? stats.rwCount : stats.mathCount;
                    return (
                      <tr key={s.key} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-medium text-slate-900">{s.label}</td>
                        {DIFFICULTIES.map((d) => (
                          <td key={d} className="px-4 py-2 text-right font-mono tabular-nums text-slate-700">
                            {cellLookup.get(`${s.key}|${d}`) ?? 0}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold">{rowTotal}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t border-slate-200 bg-slate-50">
                    <td className="px-4 py-2 text-xs uppercase tracking-wide text-slate-500">Total by difficulty</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{stats.easyCount}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{stats.mediumCount}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">{stats.hardCount}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold">{stats.totalEnabled}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Last refreshed: {formatTimestamp(stats.lastRefreshed)}.
            </p>
          </>
        ) : (
          <p className="mt-6 text-sm text-slate-500">
            Pool stats temporarily unavailable.
          </p>
        )}
      </div>
    </section>
  );
}

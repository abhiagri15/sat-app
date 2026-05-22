import type { TrendPoint } from '@/app/lib/analytics/compute';

const W = 560;
const H = 180;
const PAD = 32;
const MIN = 400;
const MAX = 1600;

// Inline-SVG line chart of scaled score over attempts (oldest -> newest).
// No charting dependency. Plain (non-client) component.
export function ScoreTrend({ trend }: { trend: TrendPoint[] }) {
  if (trend.length === 0) return null;

  const x = (i: number) =>
    trend.length === 1 ? W / 2 : PAD + (i * (W - 2 * PAD)) / (trend.length - 1);
  const y = (score: number) =>
    H - PAD - ((score - MIN) / (MAX - MIN)) * (H - 2 * PAD);

  const points = trend.map((p, i) => ({ cx: x(i), cy: y(p.score), score: p.score }));
  const line = points.map((p) => `${p.cx},${p.cy}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Score trend">
      {[MIN, (MIN + MAX) / 2, MAX].map((g) => (
        <g key={g}>
          <line x1={PAD} y1={y(g)} x2={W - PAD} y2={y(g)} stroke="#e2e8f0" strokeWidth={1} />
          <text x={4} y={y(g) + 4} fontSize={10} fill="#94a3b8">{g}</text>
        </g>
      ))}
      {trend.length > 1 && (
        <polyline points={line} fill="none" stroke="#2563eb" strokeWidth={2} />
      )}
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.cx} cy={p.cy} r={4} fill="#2563eb" />
          <text x={p.cx} y={p.cy - 10} fontSize={10} fill="#475569" textAnchor="middle">
            {p.score}
          </text>
        </g>
      ))}
    </svg>
  );
}

import { figureSchema, type Figure } from '@/app/lib/ai/figure-schema';

// Plain (non-client) dependency-free renderer for a math figure spec, in the
// same style as ScoreTrend: pure SVG/HTML from props, no hooks, no charting
// library, server-renderable. FigureView is the ONLY renderer for figures — it
// consumes a schema-validated spec and never model-emitted markup (design §B,
// the safety wall). All labels go through JSX interpolation, so React escapes
// them; there is no dangerouslySetInnerHTML anywhere here.
//
// Defensive: the figure is re-validated with safeParse at the top. Anything
// invalid / unknown renders nothing (the question stays fully answerable from
// text — the generator restates key given values in the prompt).

const W = 400;
const H = 260;
const PAD = 40;

const AXIS = '#94a3b8'; // slate-400 axis lines
const AXIS_TEXT = '#64748b'; // slate-500 axis labels
const MARK = '#2563eb'; // blue-600 data marks
const MARK_FILL = '#3b82f6'; // blue-500 fills

export function FigureView({ figure }: { figure: unknown }) {
  const parsed = figureSchema.safeParse(figure);
  if (!parsed.success) return null;
  const f = parsed.data;

  switch (f.kind) {
    case 'table':
      return <TableFigure figure={f} />;
    case 'bar-chart':
      return <BarChartFigure figure={f} />;
    case 'line-graph':
      return <LineGraphFigure figure={f} />;
    case 'scatterplot':
      return <ScatterplotFigure figure={f} />;
    case 'triangle':
      return <TriangleFigure figure={f} />;
    case 'circle':
      return <CircleFigure figure={f} />;
  }
}

// --- shared helpers --------------------------------------------------------

// Rounds a chart coordinate to 2dp so the rendered SVG string is stable.
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Linear scale from a data domain [min, max] to a pixel range [lo, hi]. A
// zero-width domain (all values equal) maps to the range midpoint.
function scaler(min: number, max: number, lo: number, hi: number) {
  const span = max - min;
  return (v: number) => (span === 0 ? (lo + hi) / 2 : lo + ((v - min) / span) * (hi - lo));
}

function ChartFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full max-w-md"
      role="img"
      aria-label={label}
    >
      {children}
    </svg>
  );
}

// --- table -----------------------------------------------------------------

function TableFigure({ figure }: { figure: Extract<Figure, { kind: 'table' }> }) {
  const label = `Table with columns ${figure.columns.join(', ')}`;
  return (
    <div role="img" aria-label={label} className="max-w-md overflow-x-auto">
      <table className="w-full border-collapse text-sm text-slate-700">
        <thead>
          <tr>
            {figure.columns.map((col, i) => (
              <th
                key={i}
                className="border border-slate-300 bg-slate-100 px-3 py-2 text-left font-semibold text-slate-800"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {figure.rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-slate-300 px-3 py-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- bar-chart -------------------------------------------------------------

function BarChartFigure({ figure }: { figure: Extract<Figure, { kind: 'bar-chart' }> }) {
  const label = `Bar chart of ${figure.yLabel} by ${figure.xLabel}`;
  const values = figure.bars.map((b) => b.value);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const y = scaler(min, max, H - PAD, PAD);
  const baseline = y(0);

  const slot = (W - 2 * PAD) / figure.bars.length;
  const barW = slot * 0.6;

  return (
    <ChartFrame label={label}>
      <line x1={PAD} y1={baseline} x2={W - PAD} y2={baseline} stroke={AXIS} strokeWidth={1} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={AXIS} strokeWidth={1} />
      {figure.bars.map((bar, i) => {
        const cx = PAD + slot * i + slot / 2;
        const top = y(bar.value);
        const barY = Math.min(top, baseline);
        const barH = Math.abs(baseline - top);
        return (
          <g key={i}>
            <rect
              x={r2(cx - barW / 2)}
              y={r2(barY)}
              width={r2(barW)}
              height={r2(barH)}
              fill={MARK_FILL}
            />
            <text x={r2(cx)} y={r2(top - 4)} fontSize={9} fill={AXIS_TEXT} textAnchor="middle">
              {bar.value}
            </text>
            <text x={r2(cx)} y={H - PAD + 14} fontSize={9} fill={AXIS_TEXT} textAnchor="middle">
              {bar.label}
            </text>
          </g>
        );
      })}
      <text x={W / 2} y={H - 6} fontSize={10} fill={AXIS_TEXT} textAnchor="middle">
        {figure.xLabel}
      </text>
      <text x={12} y={H / 2} fontSize={10} fill={AXIS_TEXT} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`}>
        {figure.yLabel}
      </text>
    </ChartFrame>
  );
}

// --- line-graph & scatterplot share XY plotting ----------------------------

function xyBounds(points: { x: number; y: number }[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function Axes({ xLabel, yLabel }: { xLabel: string; yLabel: string }) {
  return (
    <>
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={AXIS} strokeWidth={1} />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={AXIS} strokeWidth={1} />
      <text x={W / 2} y={H - 6} fontSize={10} fill={AXIS_TEXT} textAnchor="middle">
        {xLabel}
      </text>
      <text x={12} y={H / 2} fontSize={10} fill={AXIS_TEXT} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`}>
        {yLabel}
      </text>
    </>
  );
}

function LineGraphFigure({ figure }: { figure: Extract<Figure, { kind: 'line-graph' }> }) {
  const label = `Line graph of ${figure.yLabel} versus ${figure.xLabel}`;
  const { minX, maxX, minY, maxY } = xyBounds(figure.points);
  const sx = scaler(minX, maxX, PAD, W - PAD);
  const sy = scaler(minY, maxY, H - PAD, PAD);
  const pts = figure.points.map((p) => ({ cx: r2(sx(p.x)), cy: r2(sy(p.y)) }));
  const poly = pts.map((p) => `${p.cx},${p.cy}`).join(' ');

  return (
    <ChartFrame label={label}>
      <Axes xLabel={figure.xLabel} yLabel={figure.yLabel} />
      <polyline points={poly} fill="none" stroke={MARK} strokeWidth={2} />
      {pts.map((p, i) => (
        <circle key={i} cx={p.cx} cy={p.cy} r={3} fill={MARK} />
      ))}
    </ChartFrame>
  );
}

function ScatterplotFigure({ figure }: { figure: Extract<Figure, { kind: 'scatterplot' }> }) {
  const label = `Scatterplot of ${figure.yLabel} versus ${figure.xLabel}`;
  const { minX, maxX, minY, maxY } = xyBounds(figure.points);
  const sx = scaler(minX, maxX, PAD, W - PAD);
  const sy = scaler(minY, maxY, H - PAD, PAD);

  // Trend line: draw across the visible x-domain using the given slope/intercept.
  let trend: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (figure.trendLine) {
    const { slope, intercept } = figure.trendLine;
    trend = {
      x1: r2(sx(minX)),
      y1: r2(sy(slope * minX + intercept)),
      x2: r2(sx(maxX)),
      y2: r2(sy(slope * maxX + intercept)),
    };
  }

  return (
    <ChartFrame label={label}>
      <Axes xLabel={figure.xLabel} yLabel={figure.yLabel} />
      {trend && (
        <line
          x1={trend.x1}
          y1={trend.y1}
          x2={trend.x2}
          y2={trend.y2}
          stroke={MARK}
          strokeWidth={1.5}
          strokeDasharray="4 3"
        />
      )}
      {figure.points.map((p, i) => (
        <circle key={i} cx={r2(sx(p.x))} cy={r2(sy(p.y))} r={3} fill={MARK_FILL} />
      ))}
    </ChartFrame>
  );
}

// --- triangle --------------------------------------------------------------

function TriangleFigure({ figure }: { figure: Extract<Figure, { kind: 'triangle' }> }) {
  const [a, b, c] = figure.vertices;
  const label = `Triangle with vertices ${a}, ${b}, ${c}`;

  // Fixed reference triangle (a plausible generic shape; the figure carries no
  // coordinates — lengths/angles are shown as given text, not solved).
  const A = { x: 60, y: H - PAD };
  const B = { x: W - 60, y: H - PAD };
  const C = { x: 120, y: PAD };
  const path = `M ${A.x} ${A.y} L ${B.x} ${B.y} L ${C.x} ${C.y} Z`;

  // Midpoints for side labels.
  const midAB = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
  const midBC = { x: (B.x + C.x) / 2, y: (B.y + C.y) / 2 };
  const midCA = { x: (C.x + A.x) / 2, y: (C.y + A.y) / 2 };

  const rightAt =
    figure.rightAngleAt === 'a' ? A : figure.rightAngleAt === 'b' ? B : figure.rightAngleAt === 'c' ? C : null;

  return (
    <ChartFrame label={label}>
      <path d={path} fill="#eff6ff" stroke={MARK} strokeWidth={2} />

      {/* right-angle square marker */}
      {rightAt && (
        <rect x={rightAt.x - (rightAt === B ? 14 : 0)} y={rightAt.y - 14} width={14} height={14} fill="none" stroke={MARK} strokeWidth={1} />
      )}

      {/* vertex labels */}
      <text x={A.x - 8} y={A.y + 14} fontSize={12} fill="#1e293b" textAnchor="middle" fontWeight="bold">
        {a}
      </text>
      <text x={B.x + 8} y={B.y + 14} fontSize={12} fill="#1e293b" textAnchor="middle" fontWeight="bold">
        {b}
      </text>
      <text x={C.x} y={C.y - 6} fontSize={12} fill="#1e293b" textAnchor="middle" fontWeight="bold">
        {c}
      </text>

      {/* side length labels */}
      {figure.sides?.ab && (
        <text x={midAB.x} y={midAB.y + 16} fontSize={10} fill={AXIS_TEXT} textAnchor="middle">
          {figure.sides.ab}
        </text>
      )}
      {figure.sides?.bc && (
        <text x={midBC.x + 10} y={midBC.y} fontSize={10} fill={AXIS_TEXT} textAnchor="middle">
          {figure.sides.bc}
        </text>
      )}
      {figure.sides?.ca && (
        <text x={midCA.x - 12} y={midCA.y} fontSize={10} fill={AXIS_TEXT} textAnchor="middle">
          {figure.sides.ca}
        </text>
      )}

      {/* angle degree labels near the relevant vertex */}
      {figure.angles?.a && (
        <text x={A.x + 18} y={A.y - 6} fontSize={10} fill={MARK} textAnchor="middle">
          {figure.angles.a}
        </text>
      )}
      {figure.angles?.b && (
        <text x={B.x - 18} y={B.y - 6} fontSize={10} fill={MARK} textAnchor="middle">
          {figure.angles.b}
        </text>
      )}
      {figure.angles?.c && (
        <text x={C.x + 6} y={C.y + 14} fontSize={10} fill={MARK} textAnchor="middle">
          {figure.angles.c}
        </text>
      )}
    </ChartFrame>
  );
}

// --- circle ----------------------------------------------------------------

function CircleFigure({ figure }: { figure: Extract<Figure, { kind: 'circle' }> }) {
  const parts: string[] = [];
  if (figure.centerLabel) parts.push(`center ${figure.centerLabel}`);
  if (figure.radiusLabel) parts.push(`radius ${figure.radiusLabel}`);
  if (figure.sectorAngleDeg !== undefined) parts.push(`${figure.sectorAngleDeg} degree sector`);
  const label = parts.length > 0 ? `Circle with ${parts.join(', ')}` : 'Circle';

  const cx = W / 2;
  const cy = H / 2;
  const radius = 80;

  // Radius line drawn horizontally to the right.
  const edge = { x: cx + radius, y: cy };

  // Optional shaded sector: an arc from angle 0 sweeping sectorAngleDeg
  // (measured clockwise in screen space so it reads like a math sector).
  let sectorPath: string | null = null;
  if (figure.sectorAngleDeg !== undefined && figure.sectorAngleDeg > 0) {
    const deg = Math.min(figure.sectorAngleDeg, 360);
    const rad = (deg * Math.PI) / 180;
    const endX = r2(cx + radius * Math.cos(-rad));
    const endY = r2(cy + radius * Math.sin(-rad));
    const largeArc = deg > 180 ? 1 : 0;
    // Sweep-flag 0 with negated y goes counter-clockwise on screen = up.
    sectorPath = `M ${cx} ${cy} L ${edge.x} ${edge.y} A ${radius} ${radius} 0 ${largeArc} 0 ${endX} ${endY} Z`;
  }

  return (
    <ChartFrame label={label}>
      {sectorPath && <path d={sectorPath} fill="#dbeafe" stroke="none" />}
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke={MARK} strokeWidth={2} />
      <line x1={cx} y1={cy} x2={edge.x} y2={edge.y} stroke={MARK} strokeWidth={1.5} />
      <circle cx={cx} cy={cy} r={3} fill={MARK} />

      {figure.centerLabel && (
        <text x={cx - 6} y={cy + 16} fontSize={11} fill="#1e293b" textAnchor="middle" fontWeight="bold">
          {figure.centerLabel}
        </text>
      )}
      {figure.radiusLabel && (
        <text x={cx + radius / 2} y={cy - 6} fontSize={10} fill={AXIS_TEXT} textAnchor="middle">
          {figure.radiusLabel}
        </text>
      )}
      {figure.sectorAngleDeg !== undefined && (
        <text x={cx + 20} y={cy - 16} fontSize={10} fill={MARK} textAnchor="middle">
          {figure.sectorAngleDeg}°
        </text>
      )}
    </ChartFrame>
  );
}

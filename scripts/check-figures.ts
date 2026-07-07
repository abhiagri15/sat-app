// Scripted check for the figure spec schema + describeFigure (no unit-test
// runner — see CLAUDE.md). Three jobs:
//   1. ACCEPTANCE: one valid fixture per kind parses against figureSchema.
//   2. REJECTION: the schema is the safety wall — a 6-column table, a
//      row-length mismatch, an Infinity point, and a 25-point scatterplot each
//      REJECT (reject, never repair).
//   3. describeFigure: non-empty AND deterministic (call twice, strict-equal)
//      for every kind fixture — the solver reads this text, not the SVG.
// Run: pnpm dlx tsx scripts/check-figures.ts
import { figureSchema, describeFigure, type Figure } from '../app/lib/ai/figure-schema';

let count = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  count += 1;
  console.log('  ok —', msg);
}

// --- one valid fixture per kind --------------------------------------------
const fixtures: Record<Figure['kind'], Figure> = {
  table: {
    kind: 'table',
    columns: ['Year', 'Population'],
    rows: [
      ['2000', '1200'],
      ['2010', '1850'],
      ['2020', '2600'],
    ],
  },
  'bar-chart': {
    kind: 'bar-chart',
    xLabel: 'Month',
    yLabel: 'Sales',
    bars: [
      { label: 'Jan', value: 120 },
      { label: 'Feb', value: 150 },
      { label: 'Mar', value: 90 },
    ],
  },
  'line-graph': {
    kind: 'line-graph',
    xLabel: 'Time (s)',
    yLabel: 'Distance (m)',
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 4 },
      { x: 2, y: 9 },
      { x: 3, y: 16 },
    ],
  },
  scatterplot: {
    kind: 'scatterplot',
    xLabel: 'Study hours',
    yLabel: 'Score',
    points: [
      { x: 1, y: 60 },
      { x: 2, y: 68 },
      { x: 3, y: 75 },
      { x: 4, y: 80 },
      { x: 5, y: 88 },
    ],
    trendLine: { slope: 6.8, intercept: 54 },
  },
  triangle: {
    kind: 'triangle',
    vertices: ['A', 'B', 'C'],
    sides: { ab: '3', bc: '4', ca: '5' },
    angles: { c: '90°' },
    rightAngleAt: 'c',
  },
  circle: {
    kind: 'circle',
    radiusLabel: 'r = 5',
    centerLabel: 'O',
    sectorAngleDeg: 90,
  },
};

// 1. ACCEPTANCE — every kind's valid fixture parses.
for (const [kind, fixture] of Object.entries(fixtures)) {
  const result = figureSchema.safeParse(fixture);
  assert(
    result.success,
    `valid ${kind} fixture parses` +
      (result.success ? '' : ` — ${JSON.stringify(result.error.issues)}`),
  );
}

// 2. REJECTION — the safety wall.

// 6-column table (columns max 5).
assert(
  !figureSchema.safeParse({
    kind: 'table',
    columns: ['a', 'b', 'c', 'd', 'e', 'f'],
    rows: [['1', '2', '3', '4', '5', '6']],
  }).success,
  '6-column table is rejected (columns max 5)',
);

// row length !== columns length.
assert(
  !figureSchema.safeParse({
    kind: 'table',
    columns: ['Year', 'Population'],
    rows: [['2000', '1200'], ['2010']],
  }).success,
  'table row-length mismatch is rejected',
);

// Infinity in a point (numbers must be .finite()).
assert(
  !figureSchema.safeParse({
    kind: 'line-graph',
    xLabel: 'x',
    yLabel: 'y',
    points: [
      { x: 0, y: 0 },
      { x: 1, y: Infinity },
    ],
  }).success,
  'Infinity in a point is rejected (numbers must be finite)',
);

// 25-point scatterplot (points max 20).
assert(
  !figureSchema.safeParse({
    kind: 'scatterplot',
    xLabel: 'x',
    yLabel: 'y',
    points: Array.from({ length: 25 }, (_, i) => ({ x: i, y: i * 2 })),
  }).success,
  '25-point scatterplot is rejected (points max 20)',
);

// 3. describeFigure — non-empty AND deterministic for every kind.
for (const [kind, fixture] of Object.entries(fixtures)) {
  const first = describeFigure(fixture);
  const second = describeFigure(fixture);
  assert(first.length > 0, `describeFigure(${kind}) returns non-empty text`);
  assert(first === second, `describeFigure(${kind}) is deterministic (two calls strict-equal)`);
}

console.log(`\ncheck-figures: ${count} assertions passed`);

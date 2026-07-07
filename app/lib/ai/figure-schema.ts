import { z } from 'zod';

// The math-figure spec model (design spec §B). A model NEVER emits SVG/HTML —
// it emits one of these structured, schema-validated shapes and the app renders
// it with its own components (app/components/FigureView.tsx). This schema is the
// SAFETY WALL: it validates the spec and rejects anything malformed; it never
// repairs. A discriminated union on `kind` with 6 kinds (table / bar-chart /
// line-graph / scatterplot / triangle / circle).
//
// Bounds discipline (design §B): every string is length-bounded (.max(80)),
// every number is finite (.finite()), every array is size-bounded. Reject,
// never repair.

// Shared leaf validators.
const label = z.string().min(1).max(80);
const optionalLabel = z.string().min(1).max(80).optional();
const num = z.number().finite();

const pointSchema = z.object({ x: num, y: num });

// --- table -----------------------------------------------------------------
// columns 2–5; rows 1–8; every row's length === columns.length.
const tableSchema = z
  .object({
    kind: z.literal('table'),
    columns: z.array(label).min(2).max(5),
    rows: z.array(z.array(label)).min(1).max(8),
  })
  .refine((f) => f.rows.every((row) => row.length === f.columns.length), {
    message: 'every row length must equal columns.length',
    path: ['rows'],
  });

// --- bar-chart -------------------------------------------------------------
// 2–8 bars, each {label, value}.
const barChartSchema = z.object({
  kind: z.literal('bar-chart'),
  xLabel: label,
  yLabel: label,
  bars: z.array(z.object({ label, value: num })).min(2).max(8),
});

// --- line-graph ------------------------------------------------------------
// single series, 2–12 points.
const lineGraphSchema = z.object({
  kind: z.literal('line-graph'),
  xLabel: label,
  yLabel: label,
  points: z.array(pointSchema).min(2).max(12),
});

// --- scatterplot -----------------------------------------------------------
// 4–20 points, optional trend line {slope, intercept}.
const scatterplotSchema = z.object({
  kind: z.literal('scatterplot'),
  xLabel: label,
  yLabel: label,
  points: z.array(pointSchema).min(4).max(20),
  trendLine: z.object({ slope: num, intercept: num }).optional(),
});

// --- triangle --------------------------------------------------------------
// 3 vertex labels; optional per-side lengths + per-angle degree labels (shown
// as given STRINGS — no geometry solving); optional rightAngleAt vertex label.
const triangleSchema = z.object({
  kind: z.literal('triangle'),
  vertices: z.tuple([label, label, label]),
  sides: z
    .object({ ab: optionalLabel, bc: optionalLabel, ca: optionalLabel })
    .optional(),
  angles: z
    .object({ a: optionalLabel, b: optionalLabel, c: optionalLabel })
    .optional(),
  rightAngleAt: z.enum(['a', 'b', 'c']).optional(),
});

// --- circle ----------------------------------------------------------------
// optional radiusLabel / centerLabel / sectorAngleDeg.
const circleSchema = z.object({
  kind: z.literal('circle'),
  radiusLabel: optionalLabel,
  centerLabel: optionalLabel,
  sectorAngleDeg: num.min(0).max(360).optional(),
});

export const figureSchema = z.discriminatedUnion('kind', [
  tableSchema,
  barChartSchema,
  lineGraphSchema,
  scatterplotSchema,
  triangleSchema,
  circleSchema,
]);

export type Figure = z.infer<typeof figureSchema>;

// Deterministic plain-text serialization of a figure, for solver prompts. Each
// kind produces a complete sentence/paragraph containing ALL data values, so a
// model can solve the item from text alone (the self-verify solver never sees
// the SVG). MUST be deterministic — same input yields byte-identical output.
export function describeFigure(figure: Figure): string {
  switch (figure.kind) {
    case 'table': {
      const header = figure.columns.join(', ');
      const rows = figure.rows
        .map((row, i) => `row ${i + 1}: ${row.join(', ')}`)
        .join('; ');
      return `Table with columns: ${header}. ${rows}.`;
    }
    case 'bar-chart': {
      const bars = figure.bars
        .map((b) => `${b.label} = ${b.value}`)
        .join(', ');
      return `Bar chart, x-axis "${figure.xLabel}", y-axis "${figure.yLabel}". Bars: ${bars}.`;
    }
    case 'line-graph': {
      const pts = figure.points.map((p) => `(${p.x}, ${p.y})`).join(', ');
      return `Line graph, x-axis "${figure.xLabel}", y-axis "${figure.yLabel}". Points: ${pts}.`;
    }
    case 'scatterplot': {
      const pts = figure.points.map((p) => `(${p.x}, ${p.y})`).join(', ');
      const trend = figure.trendLine
        ? ` Trend line: y = ${figure.trendLine.slope}x + ${figure.trendLine.intercept}.`
        : '';
      return `Scatterplot of "${figure.yLabel}" vs "${figure.xLabel}". Points: ${pts}.${trend}`;
    }
    case 'triangle': {
      const [a, b, c] = figure.vertices;
      let text = `Triangle with vertices ${a}, ${b}, and ${c}.`;
      const sideParts: string[] = [];
      if (figure.sides?.ab) sideParts.push(`side ${a}${b} = ${figure.sides.ab}`);
      if (figure.sides?.bc) sideParts.push(`side ${b}${c} = ${figure.sides.bc}`);
      if (figure.sides?.ca) sideParts.push(`side ${c}${a} = ${figure.sides.ca}`);
      if (sideParts.length > 0) text += ` ${sideParts.join(', ')}.`;
      const angleParts: string[] = [];
      if (figure.angles?.a) angleParts.push(`angle ${a} = ${figure.angles.a}`);
      if (figure.angles?.b) angleParts.push(`angle ${b} = ${figure.angles.b}`);
      if (figure.angles?.c) angleParts.push(`angle ${c} = ${figure.angles.c}`);
      if (angleParts.length > 0) text += ` ${angleParts.join(', ')}.`;
      if (figure.rightAngleAt) {
        const idx = { a: 0, b: 1, c: 2 }[figure.rightAngleAt];
        text += ` There is a right angle at vertex ${figure.vertices[idx]}.`;
      }
      return text;
    }
    case 'circle': {
      const parts: string[] = [];
      if (figure.centerLabel) parts.push(`center ${figure.centerLabel}`);
      if (figure.radiusLabel) parts.push(`radius ${figure.radiusLabel}`);
      if (figure.sectorAngleDeg !== undefined) {
        parts.push(`a shaded sector of ${figure.sectorAngleDeg} degrees`);
      }
      return parts.length > 0
        ? `Circle with ${parts.join(', ')}.`
        : 'Circle.';
    }
  }
}

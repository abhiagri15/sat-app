'use client';

// Math reference sheet shown during Math sections. Static formula list,
// matching the College Board's published Digital SAT formula sheet.
// Same shell as CalculatorPanel — fixed-position overlay with an X button.

interface Props {
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      <ul className="space-y-1 text-sm text-slate-800">{children}</ul>
    </div>
  );
}

function Formula({ name, formula }: { name: string; formula: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="text-slate-600">{name}</span>
      <span className="font-mono text-slate-900">{formula}</span>
    </li>
  );
}

export function ReferencePanel({ onClose }: Props) {
  return (
    <aside
      className="fixed right-4 top-24 z-40 w-[420px] max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white shadow-xl"
      role="dialog"
      aria-label="Math reference sheet"
    >
      <header className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
        <h2 className="text-sm font-medium text-slate-700">Math reference</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close reference sheet"
          className="rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
        >
          ×
        </button>
      </header>
      <div className="max-h-[500px] space-y-4 overflow-y-auto p-4">
        <Section title="Area">
          <Formula name="Triangle" formula="A = ½ b h" />
          <Formula name="Rectangle" formula="A = l w" />
          <Formula name="Circle" formula="A = π r²" />
          <Formula name="Circumference" formula="C = 2 π r" />
        </Section>

        <Section title="Pythagorean / Special Triangles">
          <Formula name="Pythagorean" formula="a² + b² = c²" />
          <Formula name="30-60-90 sides" formula="1 : √3 : 2" />
          <Formula name="45-45-90 sides" formula="1 : 1 : √2" />
        </Section>

        <Section title="Volume">
          <Formula name="Rect. prism / box" formula="V = l w h" />
          <Formula name="Cylinder" formula="V = π r² h" />
          <Formula name="Sphere" formula="V = ⁴⁄₃ π r³" />
          <Formula name="Cone" formula="V = ⅓ π r² h" />
          <Formula name="Pyramid" formula="V = ⅓ l w h" />
        </Section>

        <Section title="Angles">
          <Formula name="Sum of triangle angles" formula="180°" />
          <Formula name="Degrees in a circle" formula="360°" />
          <Formula name="Radians in a circle" formula="2π" />
        </Section>
      </div>
    </aside>
  );
}

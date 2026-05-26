// app/how-it-works/_components/Parity.tsx
const CLAIMS = [
  {
    title: 'Two-module adaptive structure',
    body: 'Module 2 routes Easier or Harder based on Module 1 performance — same routing logic as the real Digital SAT.',
  },
  {
    title: 'All 35 College Board skills',
    body: '14 Reading & Writing skills and 21 Math skills, matching the official Digital SAT skill taxonomy.',
  },
  {
    title: 'Three difficulty tiers',
    body: 'Easy, Medium, Hard — used by the adaptive engine to choose Module 2.',
  },
  {
    title: 'Section weighting matches',
    body: 'Reading & Writing and Math question counts mirror real Digital SAT distributions.',
  },
  {
    title: 'Fresh content per student',
    body: 'Questions you’ve already attempted are never re-served. The pool is refilled hourly.',
  },
  {
    title: 'Honest about what’s different',
    body: 'We don’t reproduce the official Bluebook tools, and our scoring scale is approximate, not official.',
  },
];

export function Parity() {
  return (
    <section id="why-its-close" className="bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-bold text-slate-900">Why it&apos;s close to the real Digital SAT</h2>
        <ul className="mt-8 space-y-4">
          {CLAIMS.map((c) => (
            <li key={c.title} className="rounded-lg border border-slate-200 bg-white p-5">
              <h3 className="text-base font-semibold text-slate-900">{c.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{c.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

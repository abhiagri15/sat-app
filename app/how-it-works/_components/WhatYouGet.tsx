// app/how-it-works/_components/WhatYouGet.tsx
const CARDS = [
  {
    title: 'A real Digital SAT structure',
    body: 'Module 1 then Module 2 (Easier or Harder), section split, timed — the same shape as the real test.',
  },
  {
    title: 'Questions you haven’t seen',
    body: 'Per-student no-repeat. The pool grows every hour, so every session brings fresh material.',
  },
  {
    title: 'Explanations, not just answers',
    body: 'Every question has a plain-text rationale. Review your attempt after each test to see what you missed.',
  },
];

export function WhatYouGet() {
  return (
    <section className="bg-slate-50">
      <div className="mx-auto max-w-5xl px-6 py-16">
        <h2 className="text-2xl font-bold text-slate-900">What you get</h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {CARDS.map((c) => (
            <div key={c.title} className="rounded-lg border border-slate-200 bg-white p-5">
              <h3 className="text-base font-semibold text-slate-900">{c.title}</h3>
              <p className="mt-2 text-sm text-slate-600">{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// app/how-it-works/_components/WhatYouGet.tsx
const CARDS = [
  {
    title: 'A real Digital SAT structure',
    body: 'Module 1 then Module 2 (Easier or Harder), section split, timed — the same shape as the real test.',
  },
  {
    title: 'Questions you haven’t seen',
    body: 'Per-student no-repeat on tests. The pool grows every hour — and answering questions in practice triggers fresh ones for you.',
  },
  {
    title: 'Explanations, not just answers',
    body: 'Every question has a plain-text rationale. In practice drills the explanation appears the moment you answer.',
  },
  {
    title: 'Targeted skill practice',
    body: 'Your weakest skills become focus areas, each with a skill lesson and untimed drills that resurface the exact questions you missed.',
  },
  {
    title: 'A coach that knows your work',
    body: 'Each skill page carries a personal coach’s update — written from your actual answers and refreshed as your performance changes.',
  },
  {
    title: 'Difficulty that adapts to you',
    body: 'Drills lean easier while you’re building a skill and harder once you’re strong, based on your recent accuracy.',
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

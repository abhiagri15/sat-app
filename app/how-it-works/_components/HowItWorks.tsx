// app/how-it-works/_components/HowItWorks.tsx
const STEPS = [
  { n: 1, title: 'Sign up', body: 'Free, email or Google.' },
  { n: 2, title: 'Take a practice test', body: 'Same module / timing structure as the real Digital SAT.' },
  { n: 3, title: 'Review', body: 'Correct answer, your answer, plain-text explanation.' },
  {
    n: 4,
    title: 'Drill your weak spots',
    body: 'Focus areas link to skill lessons and untimed drills with instant feedback — missed questions come back until you beat them.',
  },
  {
    n: 5,
    title: 'Track progress',
    body: 'Per-skill accuracy, score trend, drill history, and a coach’s update that reflects your latest work.',
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="text-2xl font-bold text-slate-900">How it works</h2>
      <ol className="mt-8 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {STEPS.map((s) => (
          <li key={s.n} className="rounded-lg border border-slate-200 p-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
              {s.n}
            </div>
            <h3 className="mt-3 text-base font-semibold text-slate-900">{s.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

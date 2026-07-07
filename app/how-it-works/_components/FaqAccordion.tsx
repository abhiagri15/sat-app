// app/how-it-works/_components/FaqAccordion.tsx
//
// Native <details>/<summary> accordion. No React state, no client-side JS.
// Keeps the page server-only and accessible by default.

const FAQS = [
  {
    q: 'Is this free?',
    a: 'Yes. Sign up with email or Google and start practicing.',
  },
  {
    q: 'Are the questions written by AI?',
    a: 'Yes. Every question is AI-generated and cross-verified by a second AI model before it’s served. See "How questions are made" above for the full validation pipeline.',
  },
  {
    q: 'How is this different from official Bluebook practice?',
    a: 'We mirror the structure of the real Digital SAT (modules, timing, skill mix) but not the look. Our practice is free, unlimited, and the question pool refreshes hourly.',
  },
  {
    q: 'Will I get the same question twice?',
    a: 'Not on tests — we track every question you’ve seen (including in drills) and tests never re-serve them as fresh material. Practice drills are the one deliberate exception: they resurface questions you previously got wrong so you can beat them, then move you onto new material.',
  },
  {
    q: 'What are practice drills and skill lessons?',
    a: 'The Practice section turns your weakest skills into focus areas. Each skill page has a lesson (strategy, a worked example, common traps), an untimed 10-question drill with instant feedback, and a personal coach’s update. Drills don’t affect your test analytics — tests stay the honest measure.',
  },
  {
    q: 'What is the coach’s update?',
    a: 'A short, personalized read on where you stand in a skill — written by AI from your actual recent answers (what you chose vs. what was right) and refreshed automatically once you’ve done new work. Only you can see it.',
  },
  {
    q: 'What happens to questions I flag?',
    a: 'Flags go to an admin review queue. If the question is confirmed incorrect or ambiguous, an admin disables it and it’s never served again.',
  },
  {
    q: 'Is my data private?',
    a: 'Yes. Only your account sees your attempt history and analytics. Aggregate pool numbers on this page are public, but per-user data is not.',
  },
  {
    q: 'How accurate is the difficulty rating?',
    a: 'Every question is classified Easy / Medium / Hard at generation time. Admins periodically review and reclassify questions as needed.',
  },
  {
    q: 'Can I use this on mobile?',
    a: 'The practice flow works on phones and tablets, though larger screens give a more comfortable test-day feel.',
  },
];

export function FaqAccordion() {
  return (
    <section id="faq" className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="text-2xl font-bold text-slate-900">Frequently asked questions</h2>
      <div className="mt-8 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
        {FAQS.map((f) => (
          <details key={f.q} className="group p-5 [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer items-center justify-between text-base font-medium text-slate-900">
              <span>{f.q}</span>
              <span aria-hidden className="ml-4 text-slate-400 transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-3 text-sm text-slate-600">{f.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

// app/how-it-works/_components/QuestionPipeline.tsx
//
// Methodology section. CSS-only "flow diagram" — 5 pills connected by
// chevrons. Validates that the implementation claim ("two independent
// models must agree") matches the live generator pipeline before this
// page ships — see spec implementation note.
const STAGES = ['Generate', 'Self-verify', 'Cross-model agreement', 'Multi-validity check', 'Insert into pool'];

export function QuestionPipeline() {
  return (
    <section id="methodology" className="mx-auto max-w-5xl px-6 py-16">
      <h2 className="text-2xl font-bold text-slate-900">How questions are made</h2>

      <div className="mt-6 space-y-4 text-slate-700">
        <p>
          Every question is AI-generated, then cross-verified by a second AI
          model before it&apos;s served. We&apos;re upfront about this — and
          we put serious guardrails in place to keep quality high.
        </p>
        <p>
          The pipeline runs four validation stages before a candidate makes
          it into the pool. Two independent models must agree on the answer
          before the question is accepted. If they disagree, a third model
          breaks the tie. The candidate is then checked for choice-list
          issues (e.g. multiple valid answers) before insertion.
        </p>
        <p>
          You can flag any question while reviewing your attempt. Flagged
          questions go to an admin review queue and are disabled if they
          turn out to be incorrect or ambiguous.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-2">
        {STAGES.map((s, i) => (
          <div key={s} className="flex items-center">
            <span className="rounded-md bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 ring-1 ring-blue-200">
              {s}
            </span>
            {i < STAGES.length - 1 && (
              <span aria-hidden className="mx-1 text-slate-300">&rarr;</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

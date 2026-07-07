import type { Lesson } from '@/app/lib/lessons/types';

// Renders one static lesson. Plain (server-renderable, no hooks). Every lesson
// field is plain text data, so all content renders React-escaped — no
// dangerouslySetInnerHTML anywhere here. The worked-example passage uses
// whitespace-pre-line to preserve student-notes bullets (which contain \n).
export function LessonView({ lesson }: { lesson: Lesson }) {
  const ex = lesson.workedExample;
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      <p className="text-lg font-semibold text-slate-900">{lesson.tagline}</p>

      <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-700">
        {lesson.overview.map((para, i) => (
          <p key={i}>{para}</p>
        ))}
      </div>

      <section className="mt-6">
        <h3 className="text-base font-semibold text-slate-900">
          How to approach it
        </h3>
        <ol className="mt-3 space-y-3">
          {lesson.strategies.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">{s.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-700">
                  {s.body}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-6">
        <h3 className="text-base font-semibold text-slate-900">Worked example</h3>
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
          {ex.passage && (
            <div className="mb-3 whitespace-pre-line rounded-md border-l-4 border-blue-500 bg-white p-3 text-sm text-slate-700">
              {ex.passage}
            </div>
          )}
          <p className="text-sm font-semibold text-slate-900">{ex.prompt}</p>

          {ex.choices && ex.choices.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {ex.choices.map((choice, i) => {
                const isCorrect = choice === ex.correct;
                return (
                  <li
                    key={i}
                    className={
                      isCorrect
                        ? 'flex items-start gap-2 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm'
                        : 'flex items-start gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700'
                    }
                  >
                    {isCorrect ? (
                      <span
                        aria-hidden="true"
                        className="mt-0.5 font-bold text-green-600"
                      >
                        ✓
                      </span>
                    ) : (
                      <span aria-hidden="true" className="mt-0.5 text-slate-300">
                        •
                      </span>
                    )}
                    <span className={isCorrect ? 'text-green-900' : undefined}>
                      {choice}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="mt-3 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm">
              <span className="font-semibold text-green-800">Answer: </span>
              <span className="text-green-900">{ex.correct}</span>
            </div>
          )}

          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Walkthrough
            </p>
            <ol className="mt-2 space-y-1.5">
              {ex.walkthrough.map((step, i) => (
                <li key={i} className="flex gap-2 text-sm text-slate-700">
                  <span className="font-semibold text-blue-600">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="mt-6">
        <h3 className="text-base font-semibold text-slate-900">Traps to avoid</h3>
        <ul className="mt-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
          {lesson.traps.map((trap, i) => (
            <li key={i} className="flex gap-2 text-sm text-amber-900">
              <span aria-hidden="true" className="font-bold text-amber-600">
                !
              </span>
              <span>{trap}</span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

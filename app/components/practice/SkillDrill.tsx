'use client';

import type { SectionKey } from '@/app/lib/questions';
import { usePracticeSession } from '@/app/hooks/usePracticeSession';
import { DrillQuestion } from './DrillQuestion';
import { DrillSummary } from './DrillSummary';

interface SkillDrillProps {
  section: SectionKey;
  skill: string;
  autoStart: boolean;
  nextFocus?: { skill: string; slug: string };
}

// The drill FSM root. 'use client'. Owns usePracticeSession and renders the
// current phase: idle (start card), loading (spinner), error (retry card),
// drilling (progress header + DrillQuestion), summary (DrillSummary). The
// `?drill=1` query flag arrives here as `autoStart`.
export function SkillDrill({ section, skill, autoStart, nextFocus }: SkillDrillProps) {
  const s = usePracticeSession(section, skill, autoStart);

  if (s.phase === 'idle') {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center">
        <p className="text-sm text-slate-600">
          10 questions · untimed · instant feedback
        </p>
        <button
          type="button"
          onClick={s.start}
          className="mt-4 rounded-md bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          Start practice
        </button>
      </div>
    );
  }

  if (s.phase === 'loading') {
    return (
      <div className="flex items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" />
        Loading your drill…
      </div>
    );
  }

  if (s.phase === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6">
        <p className="text-sm font-semibold text-red-800">
          Couldn&apos;t start this drill
        </p>
        {s.error && <p className="mt-1 text-sm text-red-700">{s.error}</p>}
        <button
          type="button"
          onClick={s.start}
          className="mt-4 rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
        >
          Try again
        </button>
      </div>
    );
  }

  if (s.phase === 'summary') {
    return (
      <DrillSummary
        skill={skill}
        results={s.results}
        correctCount={s.correctCount}
        saveStatus={s.saveStatus}
        saveError={s.saveError}
        onRestart={s.start}
        onRetrySave={s.retrySave}
        nextFocus={nextFocus}
      />
    );
  }

  // phase === 'drilling'
  const question = s.questions[s.qIdx];
  const answered = s.qIdx + (s.checked ? 1 : 0);
  const progressPct =
    s.questions.length > 0 ? (answered / s.questions.length) * 100 : 0;

  return (
    <div>
      <div className="mb-4">
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            Question {s.qIdx + 1} of {s.questions.length}
          </span>
          <span className="text-slate-500">
            <span className="font-semibold text-green-600">
              ✓ {s.correctCount} correct
            </span>
            {s.streak > 1 && (
              <span className="ml-2 text-amber-600">
                · {s.streak} streak
              </span>
            )}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {question && (
        <DrillQuestion
          question={question}
          checked={s.checked}
          selected={s.selected}
          entered={s.entered}
          lastCorrect={s.lastCorrect}
          onSelect={s.select}
          onEntered={s.setEntered}
          onCheck={s.check}
          onNext={s.next}
          isLast={s.qIdx >= s.questions.length - 1}
          index={s.qIdx}
          total={s.questions.length}
        />
      )}
    </div>
  );
}

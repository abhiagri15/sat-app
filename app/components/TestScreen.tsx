'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import type { TestSection, ResponseValue } from '@/app/lib/test';
import { addInterval, removeIntervalAt, setNoteAt, type Interval } from '@/app/lib/highlights';
import { TopBar } from './TopBar';
import { QuestionView } from './QuestionView';
import { QuestionNavigator } from './QuestionNavigator';
import { CheckYourWork } from './CheckYourWork';
import { CalculatorPanel } from './CalculatorPanel';
import { ReferencePanel } from './ReferencePanel';
import { PausedOverlay } from './PausedOverlay';

interface TestScreenProps {
  section: TestSection;
  secIdx: number;
  modIdx: number;
  totalSections: number;
  qIdx: number;
  // Module-scoped slice: the per-question responses for the active module.
  sectionResponses: ResponseValue[];
  remaining: number;
  studentName: string;
  testLength: 'short' | 'full';
  onAnswer: (value: number | string) => void;
  onGoToQuestion: (qi: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onSubmitModule: () => void;
  // Mark-for-review (sub-project #16). `marked` is the whole global Set (keyed
  // "${secIdx}-${modIdx}-${qIdx}"); TestScreen closes over it into a
  // module-scoped `isMarked` predicate. `onToggleMarked` toggles the current
  // question. The review handlers open/close the Check-Your-Work page.
  marked: Set<string>;
  onToggleMarked: () => void;
  moduleReview: boolean;
  onOpenReview: () => void;
  onCloseReview: (qi?: number) => void;
  hideModule2Path?: boolean;
  breaksEnabled?: boolean;
  paused?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  // In-test Module-2 assembly failure (after one automatic retry): when set,
  // an overlay with a manual Retry is shown. null unless errored.
  module2Error?: string | null;
  onRetryModule2?: () => void;
}

export function TestScreen(props: TestScreenProps) {
  const {
    section, secIdx, modIdx, totalSections, qIdx, sectionResponses, remaining,
    studentName, testLength, onAnswer, onGoToQuestion, onPrev, onNext, onSubmitModule,
    marked, onToggleMarked, moduleReview, onOpenReview, onCloseReview,
    breaksEnabled = false,
    paused = false,
    onPause = () => {},
    onResume = () => {},
    module2Error = null,
    onRetryModule2 = () => {},
  } = props;
  const mod = section.modules[modIdx];
  const question = mod.questions[qIdx];
  const isLastSection = secIdx === totalSections - 1;
  const isLastModule = modIdx === section.modules.length - 1;
  const isMath = section.key === 'math';
  const isMcq = question.response_format !== 'spr';
  const isLastQuestion = qIdx === mod.questions.length - 1;

  // #16: the FSM-next submit label (lifted from QuestionNavigator so it can be
  // shared with the Check-Your-Work page). Mirrors the old navigator logic.
  const submitLabel = testLength === 'short'
    ? (isLastSection ? 'Submit test' : 'Submit section')
    : !isLastModule
      ? 'Continue to Module 2'
      : isLastSection
        ? 'Submit test'
        : 'Submit section';

  // #16: current-question mark state, and a module-scoped predicate for the
  // navigator + review page (the global key format stays inside TestScreen).
  const markKeyPrefix = `${secIdx}-${modIdx}-`;
  const isMarked = (qi: number) => marked.has(`${markKeyPrefix}${qi}`);
  const currentMarked = isMarked(qIdx);

  // #16: on the last question, "Next" opens the review page (Bluebook) instead
  // of the normal advance. QuestionView renders it as a "Review" button.
  function handleNext() {
    if (isLastQuestion) onOpenReview();
    else onNext();
  }

  // Calculator + Reference panels are Math-only tools. State lives at this
  // level so panels persist as the student moves between questions in the
  // same section. They unmount automatically when the section flips to R&W
  // because `isMath` becomes false on the next render.
  const [calcOpen, setCalcOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);

  // Answer eliminator (design spec §D). UI-STATE ONLY — never persisted, never
  // in the payload. `eliminatorOn` is the toolbar toggle (visible for ALL
  // tests, not math-only). `eliminated` maps a question id → the Set of struck
  // choice indices for that question, so eliminations survive navigating
  // between questions within the runner. Keyed by id (stable across shuffles).
  const [eliminatorOn, setEliminatorOn] = useState(false);
  const [eliminated, setEliminated] = useState<Map<string, Set<number>>>(new Map());

  const currentEliminated = eliminated.get(question.id);

  // Passage tools (design spec §A). UI-STATE ONLY — never persisted, never in
  // the payload (the eliminator/marks precedent). `highlighterOn` /
  // `lineReaderOn` are the two toolbar toggles, shown only when the current
  // question HAS a passage (gate on `question.passage`, not the section).
  // `highlights` maps a question id → its highlight intervals, so highlights
  // survive navigating between questions within the test. Keyed by id (stable
  // across shuffles), per-session only.
  const [highlighterOn, setHighlighterOn] = useState(false);
  const [lineReaderOn, setLineReaderOn] = useState(false);
  const [highlights, setHighlights] = useState<Map<string, Interval[]>>(new Map());

  const hasPassage = Boolean(question.passage);
  const currentHighlights = highlights.get(question.id) ?? [];

  function addHighlight(interval: Interval) {
    const textLength = question.passage?.length ?? 0;
    setHighlights((prev) => {
      const next = new Map(prev);
      next.set(question.id, addInterval(next.get(question.id) ?? [], interval, textLength));
      return next;
    });
  }

  function removeHighlightAt(pos: number) {
    setHighlights((prev) => {
      const next = new Map(prev);
      next.set(question.id, removeIntervalAt(next.get(question.id) ?? [], pos));
      return next;
    });
  }

  // Notes on highlights (spec §C). Sets (or, for an empty string, clears) the
  // note on the highlight interval containing `pos`. Per-session UI state only.
  function setHighlightNote(pos: number, note: string) {
    setHighlights((prev) => {
      const next = new Map(prev);
      next.set(question.id, setNoteAt(next.get(question.id) ?? [], pos, note));
      return next;
    });
  }

  function toggleEliminate(i: number) {
    setEliminated((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(question.id) ?? []);
      if (set.has(i)) set.delete(i);
      else set.add(i);
      next.set(question.id, set);
      return next;
    });
  }

  // Selecting a choice clears its elimination (design spec §D). Then defer to
  // the real answer handler.
  function handleAnswer(value: number | string) {
    if (typeof value === 'number' && eliminated.get(question.id)?.has(value)) {
      setEliminated((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(question.id) ?? []);
        set.delete(value);
        next.set(question.id, set);
        return next;
      });
    }
    onAnswer(value);
  }

  return (
    <>
      <TopBar
        secIdx={secIdx}
        qIdx={qIdx}
        totalQ={mod.questions.length}
        studentName={studentName}
        remaining={remaining}
      />
      <div className="mx-auto max-w-3xl px-4 sm:px-5 pt-6 pb-16">
        {testLength === 'full' && (
          <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
            <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
              {section.name} · Module {modIdx + 1} of {section.modules.length}
            </span>
          </div>
        )}

        {moduleReview ? (
          <CheckYourWork
            section={section}
            modIdx={modIdx}
            sectionResponses={sectionResponses}
            isMarked={isMarked}
            submitLabel={submitLabel}
            onJump={onCloseReview}
            onBack={() => onCloseReview()}
            onSubmit={onSubmitModule}
          />
        ) : (
          <>
            {breaksEnabled && (
              <div className="mb-3">
                <button
                  type="button"
                  onClick={onPause}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-blue-500 hover:bg-blue-50"
                >
                  ⏸ Pause
                </button>
              </div>
            )}

            {/* Tool toolbar: the Mark-for-Review toggle + answer eliminator are
                available on ALL tests (not math-only, unlike calculator/
                reference). The eliminator only takes effect on mcq choice rows. */}
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onToggleMarked}
                aria-pressed={currentMarked}
                title="Mark this question to review before you submit"
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition',
                  currentMarked
                    ? 'border-amber-400 bg-amber-50 text-amber-700'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-amber-400 hover:bg-amber-50',
                )}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="h-4 w-4"
                  fill={currentMarked ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M6 3.5A1.5 1.5 0 0 1 7.5 2h9A1.5 1.5 0 0 1 18 3.5V21l-6-3.6L6 21V3.5Z" />
                </svg>
                {currentMarked ? 'Marked for review' : 'Mark for Review'}
              </button>
              <button
                type="button"
                onClick={() => setEliminatorOn((v) => !v)}
                aria-pressed={eliminatorOn}
                title="Cross out answer choices you've ruled out"
                className={clsx(
                  'rounded-md border px-3 py-1.5 text-sm transition',
                  eliminatorOn
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-slate-300 bg-white text-slate-700 hover:border-blue-500 hover:bg-blue-50',
                )}
              >
                <span className="line-through">ABC</span>{' '}
                {eliminatorOn ? 'On' : 'Cross out'}
              </button>
              {/* Passage tools (design spec §A): Highlighter + Line reader.
                  Shown ONLY when the current question has a passage (gate on
                  question.passage, not the section). Per-session UI state. */}
              {hasPassage && (
                <>
                  <button
                    type="button"
                    onClick={() => setHighlighterOn((v) => !v)}
                    aria-pressed={highlighterOn}
                    title="Select passage text to highlight it; click a highlight to remove it"
                    className={clsx(
                      'rounded-md border px-3 py-1.5 text-sm transition',
                      highlighterOn
                        ? 'border-yellow-400 bg-yellow-50 text-yellow-700'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-yellow-400 hover:bg-yellow-50',
                    )}
                  >
                    ✏️ {highlighterOn ? 'Highlighter on' : 'Highlighter'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLineReaderOn((v) => !v)}
                    aria-pressed={lineReaderOn}
                    title="Show a focus band over the passage that follows your pointer"
                    className={clsx(
                      'rounded-md border px-3 py-1.5 text-sm transition',
                      lineReaderOn
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-blue-500 hover:bg-blue-50',
                    )}
                  >
                    ▭ {lineReaderOn ? 'Line reader on' : 'Line reader'}
                  </button>
                </>
              )}
              {isMath && (
                <>
                  <button
                    type="button"
                    onClick={() => setCalcOpen((v) => !v)}
                    aria-pressed={calcOpen}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-blue-500 hover:bg-blue-50"
                  >
                    {calcOpen ? '× Calculator' : '🖩 Calculator'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setRefOpen((v) => !v)}
                    aria-pressed={refOpen}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:border-blue-500 hover:bg-blue-50"
                  >
                    {refOpen ? '× Reference' : '📐 Reference'}
                  </button>
                </>
              )}
            </div>

            <QuestionView
              section={{ name: section.name }}
              question={question}
              selected={sectionResponses[qIdx] ?? null}
              onAnswer={handleAnswer}
              onPrev={onPrev}
              onNext={handleNext}
              isFirst={qIdx === 0}
              isLast={isLastQuestion}
              eliminatorOn={eliminatorOn && isMcq}
              eliminated={currentEliminated}
              onToggleEliminate={toggleEliminate}
              highlights={currentHighlights}
              highlighterOn={highlighterOn}
              onAddHighlight={addHighlight}
              onRemoveHighlightAt={removeHighlightAt}
              onSetHighlightNote={setHighlightNote}
              lineReaderOn={lineReaderOn}
              onLineReaderClose={() => setLineReaderOn(false)}
            />
            <QuestionNavigator
              section={section}
              modIdx={modIdx}
              qIdx={qIdx}
              sectionResponses={sectionResponses}
              isMarked={isMarked}
              onGoToQuestion={onGoToQuestion}
              onOpenReview={onOpenReview}
              submitLabel={submitLabel}
            />
          </>
        )}
      </div>

      {!moduleReview && isMath && calcOpen && <CalculatorPanel onClose={() => setCalcOpen(false)} />}
      {!moduleReview && isMath && refOpen && <ReferencePanel onClose={() => setRefOpen(false)} />}
      {paused && <PausedOverlay onResume={onResume} />}
      {module2Error && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-white/95 px-6 backdrop-blur-sm"
          role="alertdialog"
          aria-modal="true"
          aria-label="Module 2 connection problem"
        >
          <h2 className="text-2xl font-semibold text-slate-800">Connection problem building Module 2</h2>
          <p className="max-w-md text-center text-slate-500">{module2Error}</p>
          <button
            type="button"
            onClick={onRetryModule2}
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      )}
    </>
  );
}

'use client';

import { useState } from 'react';
import type { TestSection, ResponseValue } from '@/app/lib/test';
import { TopBar } from './TopBar';
import { QuestionView } from './QuestionView';
import { QuestionNavigator } from './QuestionNavigator';
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

  // Calculator + Reference panels are Math-only tools. State lives at this
  // level so panels persist as the student moves between questions in the
  // same section. They unmount automatically when the section flips to R&W
  // because `isMath` becomes false on the next render.
  const [calcOpen, setCalcOpen] = useState(false);
  const [refOpen, setRefOpen] = useState(false);

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

        {isMath && (
          <div className="mb-3 flex flex-wrap gap-2">
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
          </div>
        )}

        <QuestionView
          section={{ name: section.name }}
          question={question}
          selected={sectionResponses[qIdx] ?? null}
          onAnswer={onAnswer}
          onPrev={onPrev}
          onNext={onNext}
          isFirst={qIdx === 0}
          isLast={qIdx === mod.questions.length - 1}
        />
        <QuestionNavigator
          section={section}
          modIdx={modIdx}
          qIdx={qIdx}
          sectionResponses={sectionResponses}
          onGoToQuestion={onGoToQuestion}
          onSubmitModule={onSubmitModule}
          isLastSection={isLastSection}
          isLastModule={isLastModule}
          testLength={testLength}
        />
      </div>

      {isMath && calcOpen && <CalculatorPanel onClose={() => setCalcOpen(false)} />}
      {isMath && refOpen && <ReferencePanel onClose={() => setRefOpen(false)} />}
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

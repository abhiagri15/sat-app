'use client';

import { useState } from 'react';
import type { TestSection, ResponseValue } from '@/app/lib/test';
import { TopBar } from './TopBar';
import { QuestionView } from './QuestionView';
import { QuestionNavigator } from './QuestionNavigator';
import { CalculatorPanel } from './CalculatorPanel';
import { ReferencePanel } from './ReferencePanel';

interface TestScreenProps {
  section: TestSection;
  secIdx: number;
  totalSections: number;
  qIdx: number;
  sectionResponses: ResponseValue[];
  remaining: number;
  studentName: string;
  onAnswer: (value: number | string) => void;
  onGoToQuestion: (qi: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onSubmitSection: () => void;
}

export function TestScreen(props: TestScreenProps) {
  const {
    section, secIdx, totalSections, qIdx, sectionResponses, remaining,
    studentName, onAnswer, onGoToQuestion, onPrev, onNext, onSubmitSection,
  } = props;
  const question = section.questions[qIdx];
  const isLastSection = secIdx === totalSections - 1;
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
        totalQ={section.questions.length}
        studentName={studentName}
        remaining={remaining}
      />
      <div className="mx-auto max-w-3xl px-4 sm:px-5 pt-6 pb-16">
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
          isLast={qIdx === section.questions.length - 1}
        />
        <QuestionNavigator
          section={section}
          qIdx={qIdx}
          sectionResponses={sectionResponses}
          onGoToQuestion={onGoToQuestion}
          onSubmitSection={onSubmitSection}
          isLastSection={isLastSection}
        />
      </div>

      {isMath && calcOpen && <CalculatorPanel onClose={() => setCalcOpen(false)} />}
      {isMath && refOpen && <ReferencePanel onClose={() => setRefOpen(false)} />}
    </>
  );
}

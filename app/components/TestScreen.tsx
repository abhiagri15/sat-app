'use client';

import type { TestSection } from '@/app/lib/test';
import { TopBar } from './TopBar';
import { QuestionView } from './QuestionView';
import { QuestionNavigator } from './QuestionNavigator';

interface TestScreenProps {
  section: TestSection;
  secIdx: number;
  totalSections: number;
  qIdx: number;
  sectionResponses: (number | null)[];
  remaining: number;
  studentName: string;
  onSelect: (i: number) => void;
  onGoToQuestion: (qi: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onSubmitSection: () => void;
}

export function TestScreen(props: TestScreenProps) {
  const {
    section, secIdx, totalSections, qIdx, sectionResponses, remaining,
    studentName, onSelect, onGoToQuestion, onPrev, onNext, onSubmitSection,
  } = props;
  const question = section.questions[qIdx];
  const isLastSection = secIdx === totalSections - 1;
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
        <QuestionView
          section={{ name: section.name }}
          question={question}
          selected={sectionResponses[qIdx]}
          onSelect={onSelect}
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
    </>
  );
}

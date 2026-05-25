'use client';

import { useTestSession } from '@/app/hooks/useTestSession';
import { StartScreen } from './StartScreen';
import { TestScreen } from './TestScreen';
import { ResultsScreen } from './ResultsScreen';

export default function SatPractice({
  studentName,
  attemptsUsedToday,
  dailyAttemptLimit,
}: {
  studentName: string;
  attemptsUsedToday: number;
  dailyAttemptLimit: number;
}) {
  const s = useTestSession(studentName);

  if (s.screen === 'start') {
    // Server-rendered count + tests completed this session (so the gate stays
    // accurate as the user takes more tests without a page reload).
    const usedToday = attemptsUsedToday + s.sessionCompletions;
    const attemptsRemaining = Math.max(0, dailyAttemptLimit - usedToday);
    return (
      <StartScreen
        testLength={s.testLength}
        setTestLength={s.setTestLength}
        onStart={s.start}
        loading={s.loading}
        dailyAttemptLimit={dailyAttemptLimit}
        attemptsRemaining={attemptsRemaining}
      />
    );
  }

  if (s.screen === 'test' && s.test) {
    const section = s.test.sections[s.secIdx];
    const totalSections = s.test.sections.length;
    const mod = section.modules[s.modIdx];
    const sectionResponses = s.responses[s.secIdx]?.[s.modIdx] ?? [];
    const remaining = s.remaining[s.secIdx]?.[s.modIdx] ?? 0;
    return (
      <TestScreen
        section={section}
        secIdx={s.secIdx}
        modIdx={s.modIdx}
        totalSections={totalSections}
        qIdx={s.qIdx}
        sectionResponses={sectionResponses}
        remaining={remaining}
        studentName={s.test.name}
        testLength={s.test.length}
        onAnswer={s.setAnswer}
        onGoToQuestion={s.goToQuestion}
        onPrev={() => s.goToQuestion(Math.max(0, s.qIdx - 1))}
        onNext={() => s.goToQuestion(Math.min(mod.questions.length - 1, s.qIdx + 1))}
        onSubmitModule={s.submitModule}
      />
    );
  }

  // screen === 'results' (or invalid mid-state; treat as nothing rendered)
  if (s.results && s.test) {
    return (
      <ResultsScreen
        test={s.test}
        responses={s.responses}
        results={s.results}
        saveStatus={s.saveStatus}
        showReview={s.showReview}
        onToggleReview={s.toggleReview}
        onNewTest={s.newTest}
      />
    );
  }

  return null;
}

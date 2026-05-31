'use client';

import { useTestSession } from '@/app/hooks/useTestSession';
import { StartScreen } from './StartScreen';
import { TestScreen } from './TestScreen';
import { ResultsScreen } from './ResultsScreen';

export default function SatPractice({
  studentName,
  attemptsUsedToday,
  dailyAttemptLimit,
  hideModule2Path = false,
}: {
  studentName: string;
  attemptsUsedToday: number;
  dailyAttemptLimit: number;
  hideModule2Path?: boolean;
}) {
  const s = useTestSession(studentName);

  if (s.screen === 'start') {
    // Server-rendered count + tests completed this session (so the gate stays
    // accurate as the user takes more tests without a page reload).
    const usedToday = attemptsUsedToday + s.sessionCompletions;
    const attemptsRemaining = Math.max(0, dailyAttemptLimit - usedToday);
    return (
      <>
        {/* Recovery banner: a prior attempt was found backed up on this device
            and is being resaved in the background. */}
        {s.resaveStatus === 'saving' && (
          <div className="mx-auto max-w-3xl px-4 pt-4">
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm text-amber-800">
              Recovering an unsaved result from a previous session…
            </p>
          </div>
        )}
        {s.resaveStatus === 'saved' && (
          <div className="mx-auto max-w-3xl px-4 pt-4">
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-sm text-emerald-800">
              Recovered an unsaved result and saved it to your dashboard ✓
            </p>
          </div>
        )}
        <StartScreen
          testLength={s.testLength}
          setTestLength={s.setTestLength}
          onStart={s.start}
          loading={s.loading}
          dailyAttemptLimit={dailyAttemptLimit}
          attemptsRemaining={attemptsRemaining}
          hideModule2Path={hideModule2Path}
          breaksEnabled={s.breaksEnabled}
          setBreaksEnabled={s.setBreaksEnabled}
        />
      </>
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
        hideModule2Path={hideModule2Path}
        breaksEnabled={s.breaksEnabled}
        paused={s.paused}
        onPause={s.pause}
        onResume={s.resume}
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
        saveError={s.saveError}
        onRetrySave={s.retrySave}
        showReview={s.showReview}
        onToggleReview={s.toggleReview}
        onNewTest={s.newTest}
        breaksUsed={s.breaksUsed}
      />
    );
  }

  return null;
}

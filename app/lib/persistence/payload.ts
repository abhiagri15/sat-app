import type { SectionKey } from '@/app/lib/questions';
import type { Test, Results, TestLength } from '@/app/lib/test';

// One persisted question in an attempt — the question AS PRESENTED plus the
// user's answer. `choices`/`answerIndex` are the shuffled values (spec D4).
export interface AttemptResponsePayload {
  sectionKey: SectionKey;
  sectionName: string;
  position: number;            // 0-indexed within the section
  questionId: string;
  skill: string;
  source: 'seed' | 'ai';
  passage: string | null;
  prompt: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  chosenIndex: number | null;  // null = skipped
  isCorrect: boolean;
}

// A whole submitted test, in the shape the save_attempt RPC consumes.
export interface AttemptPayload {
  studentName: string;
  testLength: TestLength;
  totalCorrect: number;
  totalQuestions: number;
  scaledScore: number;
  sectionBreakdown: { name: string; correct: number; total: number }[];
  responses: AttemptResponsePayload[];
}

// Pure: maps a finished in-memory test into the persisted payload. No I/O.
export function toAttemptPayload(
  test: Test,
  responses: (number | null)[][],
  results: Results,
  testLength: TestLength,
): AttemptPayload {
  const attemptResponses: AttemptResponsePayload[] = [];
  for (let si = 0; si < test.sections.length; si++) {
    const section = test.sections[si];
    for (let qi = 0; qi < section.questions.length; qi++) {
      const q = section.questions[qi];
      const chosenIndex = responses[si]?.[qi] ?? null;
      attemptResponses.push({
        sectionKey: section.key,
        sectionName: section.name,
        position: qi,
        questionId: q.id,
        skill: q.skill,
        source: q.source,
        passage: q.passage ?? null,
        prompt: q.prompt,
        choices: q.choices,
        answerIndex: q.answerIndex,
        explanation: q.explanation,
        chosenIndex,
        isCorrect: chosenIndex === q.answerIndex,
      });
    }
  }
  const totalCorrect = results.perSection.reduce((sum, s) => sum + s.correct, 0);
  const totalQuestions = results.perSection.reduce((sum, s) => sum + s.total, 0);
  return {
    studentName: test.name,
    testLength,
    totalCorrect,
    totalQuestions,
    scaledScore: results.scaled,
    sectionBreakdown: results.perSection,
    responses: attemptResponses,
  };
}

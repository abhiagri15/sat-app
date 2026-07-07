import type { Question } from '@/app/lib/questions';
import type { SectionKey } from '@/app/lib/questions';

// One graded drill item as the runner presented it (choices already shuffled
// by shuffleChoices at draw time — snapshot-as-presented, like attempts).
export interface DrillResult {
  question: Question;
  /** mcq: index into the as-presented choices; spr: -1. */
  chosenIndex: number;
  /** spr: the raw string the student typed; mcq: null. */
  enteredValue: string | null;
  /** Client-graded for instant feedback; server re-verifies at save. */
  isCorrect: boolean;
  /**
   * Sub-project #15: active-display milliseconds for this drill question
   * (display → check), capped at TIME_MS_CAP. null when unmeasured or 0.
   * Display/analytics-only — never feeds correctness.
   */
  timeMs: number | null;
}

export interface PracticeResponsePayload {
  position: number;
  questionId: string;
  skill: string;
  source: string;
  passage: string | null;
  prompt: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  chosenIndex: number;
  isCorrect: boolean;
  responseFormat: 'mcq' | 'spr';
  enteredValue: string | null;
  correctAnswer: string | null;
  answerTolerance: number | null;
  timeMs: number | null;           // Sub-project #15: per-question active-display ms. null = absent/0.
  figure: unknown | null;          // Sub-project #15: figure snapshot as presented. null = no figure.
}

export interface PracticePayload {
  sessionUuid: string;
  section: SectionKey;
  skill: string;
  total: number;
  correct: number;
  responses: PracticeResponsePayload[];
}

export function toPracticePayload(
  sessionUuid: string,
  section: SectionKey,
  skill: string,
  results: DrillResult[],
): PracticePayload {
  const responses = results.map((r, i) => {
    const q = r.question;
    // Question's SPR fields are snake_case (response_format, correct_answer,
    // answer_tolerance) — see the interface in app/lib/questions.ts.
    const spr = q.response_format === 'spr';
    return {
      position: i,
      questionId: q.id,
      skill: q.skill,
      source: q.source,
      passage: q.passage ?? null,
      prompt: q.prompt,
      choices: spr ? [] : q.choices,
      answerIndex: spr ? 0 : q.answerIndex,
      explanation: q.explanation,
      chosenIndex: spr ? -1 : r.chosenIndex,
      isCorrect: r.isCorrect,
      responseFormat: (spr ? 'spr' : 'mcq') as 'mcq' | 'spr',
      enteredValue: spr ? r.enteredValue : null,
      correctAnswer: spr ? (q.correct_answer ?? null) : null,
      answerTolerance: spr ? (q.answer_tolerance ?? null) : null,
      // Per-question time: null when unmeasured or 0. Display/analytics only.
      timeMs: r.timeMs != null && r.timeMs > 0 ? r.timeMs : null,
      // Figure snapshot as presented (Task 5 narrows the type).
      figure: q.figure ?? null,
    };
  });
  return {
    sessionUuid,
    section,
    skill,
    total: responses.length,
    correct: responses.filter((r) => r.isCorrect).length,
    responses,
  };
}

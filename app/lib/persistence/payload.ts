import type { SectionKey } from '@/app/lib/questions';
import type { Test, Results, TestLength, ResponseValue } from '@/app/lib/test';
import { isSprCorrect } from '@/app/lib/spr';

// One persisted question in an attempt — the question AS PRESENTED plus the
// user's answer. `choices`/`answerIndex` are the shuffled values (spec D4)
// for mcq rows; placeholder for spr rows (correct_answer + entered_value
// carry the meaningful comparison).
export interface AttemptResponsePayload {
  sectionKey: SectionKey;
  sectionName: string;
  position: number;                // 0-indexed within the section (across modules)
  questionId: string;
  skill: string;
  source: 'seed' | 'ai';
  passage: string | null;
  prompt: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  responseFormat: 'mcq' | 'spr';
  chosenIndex: number | null;      // mcq: chosen 0..3 / null = skipped. SPR: null.
  enteredValue: string | null;     // SPR: what the student typed / null. mcq: null.
  correctAnswer: string | null;    // SPR canonical answer (snapshot). null for mcq.
  answerTolerance: number | null;  // SPR float tolerance (snapshot). null for mcq.
  isCorrect: boolean;
  moduleIndex: number | null;      // Sub-project #11: 0 = Module 1, 1 = Module 2. null for short.
}

// A whole submitted test, in the shape the save_attempt RPC consumes.
export interface AttemptPayload {
  studentName: string;
  testLength: TestLength;
  totalCorrect: number;
  totalQuestions: number;
  scaledScore: number;
  breaksUsed: boolean;   // informational — did the student pause during this attempt?
  sectionBreakdown: {
    name: string;
    sectionKey: SectionKey;
    correct: number;
    total: number;
    module2Path?: 'easier' | 'harder' | null;   // null/omitted for short tests
  }[];
  responses: AttemptResponsePayload[];
}

// Pure: maps a finished in-memory test into the persisted payload. No I/O.
// Iterates the 3-D responses matrix ([section][module][question]); per
// response sets `moduleIndex` to the module ordinal (0|1) on full tests
// and null on short. Branches per question on response_format: mcq writes
// chosenIndex from the numeric response; spr writes enteredValue from the
// string. isCorrect is computed here (JS) AND server-side (sat.spr_is_correct
// via save_attempt) — the server is the source of truth; this value is a
// hint used for the immediate post-submit results screen.
export function toAttemptPayload(
  test: Test,
  responses: ResponseValue[][][],
  results: Results,
  testLength: TestLength,
  breaksUsed: boolean,
): AttemptPayload {
  const attemptResponses: AttemptResponsePayload[] = [];
  for (let si = 0; si < test.sections.length; si++) {
    const section = test.sections[si];
    let position = 0;
    for (let mi = 0; mi < section.modules.length; mi++) {
      const mod = section.modules[mi];
      for (let qi = 0; qi < mod.questions.length; qi++) {
        const q = mod.questions[qi];
        const v = responses[si]?.[mi]?.[qi] ?? null;
        const isSpr = q.response_format === 'spr';

        const chosenIndex = !isSpr && typeof v === 'number' ? v : null;
        const enteredValue = isSpr && typeof v === 'string' ? v : null;

        const isCorrect = isSpr
          ? enteredValue !== null &&
            q.correct_answer != null &&
            isSprCorrect(enteredValue, q.correct_answer, q.answer_tolerance ?? null)
          : chosenIndex === q.answerIndex;

        attemptResponses.push({
          sectionKey: section.key,
          sectionName: section.name,
          position,
          questionId: q.id,
          skill: q.skill,
          source: q.source,
          passage: q.passage ?? null,
          prompt: q.prompt,
          choices: q.choices,
          answerIndex: q.answerIndex,
          explanation: q.explanation,
          responseFormat: isSpr ? 'spr' : 'mcq',
          chosenIndex,
          enteredValue,
          correctAnswer: q.correct_answer ?? null,
          answerTolerance: q.answer_tolerance ?? null,
          isCorrect,
          moduleIndex: testLength === 'short' ? null : mi,
        });
        position++;
      }
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
    breaksUsed,
    // Explicit map: pick only the fields the wire format needs. The
    // passthrough form (`results.perSection`) would also carry `scaled`
    // and `projectedRaw` — zod's default strip mode would drop them
    // silently, but a future `.strict()` swap (or a non-zod consumer)
    // would break. `scaled` is server-computed in sat.save_attempt; do
    // not send a client value for it.
    sectionBreakdown: results.perSection.map((s) => ({
      name: s.name,
      sectionKey: s.sectionKey,
      correct: s.correct,
      total: s.total,
      module2Path: s.module2Path ?? null,
    })),
    responses: attemptResponses,
  };
}

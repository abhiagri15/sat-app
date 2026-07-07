import type { GeneratedQuestion } from './schema';
import type { SectionKey } from '../questions';
import { OllamaCloudProvider } from './ollama';

// The minimum a solve call needs to re-derive the answer for either format.
// For mcq we need choices; for spr we ignore choices (always empty there).
export type SolveInput =
  | Pick<Extract<GeneratedQuestion, { responseFormat: 'mcq' }>,
      'responseFormat' | 'section' | 'skill' | 'passage' | 'prompt' | 'choices'>
  | Pick<Extract<GeneratedQuestion, { responseFormat: 'spr' }>,
      'responseFormat' | 'section' | 'skill' | 'prompt'>;

// Solver result is polymorphic across response formats. For mcq the model
// returns a 0-based choice index; for spr it returns a typed numeric string
// to be compared with the canonical answer via isSprCorrect.
export type SolveResult =
  | { responseFormat: 'mcq'; answerIndex: number }
  | { responseFormat: 'spr'; answer: string };

// One evidence line handed to generateGuidance: a single past response of the
// student's, distilled for the coach prompt. `difficulty` is null when the
// backing question row is gone (a response can outlive its question), in which
// case the prompt omits the difficulty tag. `format` mirrors the question's
// response format so the prompt can phrase mcq vs grid-in mistakes correctly.
export interface GuidanceEvidenceItem {
  prompt: string;
  chosen: string;
  correct: string;
  isCorrect: boolean;
  difficulty: string | null;
  format: 'mcq' | 'spr';
}

// Input to generateGuidance: the skill under coaching plus the student's
// accuracy picture (overall + last-10) and the recent-response evidence.
export interface GuidanceInput {
  section: SectionKey;
  skill: string;
  accuracyPct: number;
  last10Pct: number | null;
  evidence: GuidanceEvidenceItem[];
}

export interface AIProvider {
  // Generate `count` questions for one (section, skill, difficulty).
  // Caller decides mcq vs spr via the `useSpr` flag (spr is Math-only).
  // Sub-project #11 added `targetDifficulty` so the thinnest-first picker
  // can request the difficulty cell that's underfilled.
  generateQuestions(
    section: 'rw' | 'math',
    skill: string,
    count: number,
    useSpr: boolean,
    targetDifficulty: 'easy' | 'medium' | 'hard',
  ): Promise<GeneratedQuestion[]>;
  // Re-solve a question for the self-verify gate. Branches on responseFormat.
  solve(q: SolveInput): Promise<SolveResult>;
  // Multi-validity check for mcq self-verify: ask the model to identify ALL
  // valid choice indices (not just the "best"). Used to reject a candidate
  // when the choice list accidentally contains two correct answers — e.g. a
  // quadratic with two roots where both roots appear in the choice list.
  // Returns the list of 0-based indices the model judges valid (typically
  // length 1; length > 1 means the candidate is faulty).
  findValidChoices(q: Extract<SolveInput, { responseFormat: 'mcq' }>): Promise<number[]>;
  // Repair attempt for a candidate that failed the multi-validity check:
  // the intended answer is at `answerIndex`; the indices in `indicesToReplace`
  // are also valid and need to become plausible-but-wrong distractors.
  // Returns a new 4-element choice array on success, or null if the LLM
  // can't produce a clean replacement. The caller re-runs findValidChoices
  // on the repaired array — only accepts the candidate if the repair holds.
  repairMultiValid(input: {
    section: 'rw' | 'math';
    skill: string;
    passage: string | null | undefined;
    prompt: string;
    choices: string[];
    answerIndex: number;
    indicesToReplace: number[];
  }): Promise<{ choices: string[] } | null>;
  // Generate one AI base lesson for a (section, skill) as a single JSON object
  // matching the `Lesson` shape. Returns `unknown` so zod validation
  // (`lessonSchema`) stays at the caller — same posture as `generateQuestions`
  // deferring to `generatedQuestionSchema`.
  generateLesson(section: SectionKey, skill: string): Promise<unknown>;
  // Generate a per-student "Coach's update" from their accuracy + recent
  // response evidence. Returns `unknown`; the caller validates via
  // `guidanceSchema`.
  generateGuidance(input: GuidanceInput): Promise<unknown>;
}

// Provider factory — keyed on SAT_AI_PROVIDER so other providers can be added later.
export function getProvider(): AIProvider {
  const name = process.env.SAT_AI_PROVIDER ?? 'ollama';
  switch (name) {
    case 'ollama':
      return new OllamaCloudProvider();
    default:
      throw new Error(`Unknown SAT_AI_PROVIDER: ${name}`);
  }
}

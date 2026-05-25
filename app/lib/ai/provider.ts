import type { GeneratedQuestion } from './schema';
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

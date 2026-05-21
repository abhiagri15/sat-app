import type { GeneratedQuestion } from './schema';
import { OllamaCloudProvider } from './ollama';

export type SolveInput = Pick<GeneratedQuestion, 'section' | 'skill' | 'passage' | 'prompt' | 'choices'>;

export interface AIProvider {
  // Generate `count` questions for one (section, skill).
  generateQuestions(
    section: 'rw' | 'math',
    skill: string,
    count: number,
  ): Promise<GeneratedQuestion[]>;
  // Re-solve a question; returns the chosen 0-based choice index (self-verify).
  solve(q: SolveInput): Promise<number>;
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

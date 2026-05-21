import { z } from 'zod';

// Shape an AI-generated question must satisfy to enter the pool.
export const generatedQuestionSchema = z.object({
  section: z.enum(['rw', 'math']),
  skill: z.string().min(1),
  passage: z.string().optional(),
  prompt: z.string().min(1),
  choices: z.array(z.string().min(1)).length(4),
  answerIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
});

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;

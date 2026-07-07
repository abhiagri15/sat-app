import { z } from 'zod';
import { figureSchema } from './figure-schema';

// Shape an AI-generated question must satisfy to enter the pool. Discriminated
// on responseFormat: 'mcq' is the original 4-choice format; 'spr' is the
// student-produced-response (numeric / fraction) format, Math-only per the
// real Digital SAT.
//
// Sub-project #15 (figures): both branches gain an OPTIONAL `figure`, validated
// by `figureSchema` (the safety wall — reject, never repair). A candidate that
// carries a malformed figure fails the schema and is rejected under
// rejectedSchema, exactly like any other schema failure. The figure is Math-only
// on the real Digital SAT, but that restriction is enforced at the
// prompt/insert level (only FIGURE_SKILLS math targets request one) — NOT in
// this schema, which would otherwise reject a hypothetical valid figure on an
// R&W item rather than treat it as a data problem.
const figureField = { figure: figureSchema.optional() };

export const generatedQuestionSchema = z.discriminatedUnion('responseFormat', [
  z.object({
    responseFormat: z.literal('mcq'),
    section: z.enum(['rw', 'math']),
    skill: z.string().min(1),
    difficulty: z.enum(['easy', 'medium', 'hard']),   // Sub-project #11
    passage: z.string().optional(),
    prompt: z.string().min(1),
    choices: z.array(z.string().min(1)).length(4),
    answerIndex: z.number().int().min(0).max(3),
    explanation: z.string().min(1),
    ...figureField,
  }),
  z.object({
    responseFormat: z.literal('spr'),
    section: z.literal('math'),
    skill: z.string().min(1),
    difficulty: z.enum(['easy', 'medium', 'hard']),   // Sub-project #11
    prompt: z.string().min(1),
    // No passage and no choices for spr — students type a numeric answer.
    correctAnswer: z.string().min(1),
    // Optional float tolerance for decimal answers (e.g. 0.01 for π).
    answerTolerance: z.number().nonnegative().optional(),
    explanation: z.string().min(1),
    ...figureField,
  }),
]);

export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;

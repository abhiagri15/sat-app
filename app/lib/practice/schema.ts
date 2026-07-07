import { z } from 'zod';

const practiceResponseSchema = z
  .object({
    position: z.number().int().min(0),
    questionId: z.string().min(1),
    skill: z.string().min(1),
    source: z.string().min(1),
    passage: z.string().nullable(),
    prompt: z.string().min(1),
    choices: z.array(z.string()),
    answerIndex: z.number().int().min(0),
    explanation: z.string(),
    chosenIndex: z.number().int().min(-1),
    isCorrect: z.boolean(),
    responseFormat: z.enum(['mcq', 'spr']),
    enteredValue: z.string().nullable(),
    correctAnswer: z.string().nullable(),
    answerTolerance: z.number().nullable(),
  })
  .refine((r) => r.responseFormat === 'spr' || r.choices.length >= 1, {
    message: 'mcq responses need at least one choice',
  });

export const practicePayloadSchema = z.object({
  sessionUuid: z.uuid(), // zod v4 — z.string().uuid() is deprecated
  section: z.enum(['rw', 'math']),
  skill: z.string().min(1),
  total: z.number().int().min(1),
  correct: z.number().int().min(0),
  responses: z.array(practiceResponseSchema).min(1),
});

export type PracticePayloadInput = z.infer<typeof practicePayloadSchema>;

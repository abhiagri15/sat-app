import { z } from 'zod';

const attemptResponseSchema = z.object({
  sectionKey: z.enum(['rw', 'math']),
  sectionName: z.string().min(1),
  position: z.number().int().min(0),
  questionId: z.string().min(1),
  skill: z.string().min(1),
  source: z.enum(['seed', 'ai']),
  passage: z.string().nullable(),
  prompt: z.string().min(1),
  choices: z.array(z.string()).min(1),
  answerIndex: z.number().int().min(0),
  explanation: z.string().min(1),
  chosenIndex: z.number().int().min(0).nullable(),
  isCorrect: z.boolean(),
  moduleIndex: z.number().int().min(0).max(1).nullable().optional(),  // Sub-project #11: 0|1 for full, null for short
});

export const attemptPayloadSchema = z.object({
  studentName: z.string().min(1),
  testLength: z.enum(['short', 'full']),
  totalCorrect: z.number().int().min(0),
  totalQuestions: z.number().int().positive(),
  scaledScore: z.number().int().min(400).max(1600),
  breaksUsed: z.boolean().optional(),   // wire-lenient for backward compat; in-memory type is strict
  sectionBreakdown: z
    .array(
      z.object({
        name: z.string().min(1),
        sectionKey: z.enum(['rw', 'math']),    // server routes scale_section on this
        correct: z.number().int().min(0),
        total: z.number().int().min(0),
        // Sub-project #11: routing path on full attempts. null/omitted for short.
        module2Path: z.enum(['easier', 'harder']).nullable().optional(),
      }),
    )
    .min(1),
  responses: z.array(attemptResponseSchema).min(1),
});

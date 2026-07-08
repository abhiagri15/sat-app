import { z } from 'zod';

const attemptResponseSchema = z
  .object({
    sectionKey: z.enum(['rw', 'math']),
    sectionName: z.string().min(1),
    position: z.number().int().min(0),
    questionId: z.string().min(1),
    skill: z.string().min(1),
    source: z.enum(['seed', 'ai']),
    passage: z.string().nullable(),
    prompt: z.string().min(1),
    // mcq rows carry the (shuffled) choices; SPR (grid-in) rows carry [].
    // The non-empty requirement is enforced per-format in the refine below —
    // a flat .min(1) here would reject every SPR response and fail the whole save.
    choices: z.array(z.string()),
    answerIndex: z.number().int().min(0),
    explanation: z.string().min(1),
    chosenIndex: z.number().int().min(0).nullable(),
    isCorrect: z.boolean(),
    moduleIndex: z.number().int().min(0).max(1).nullable().optional(),  // Sub-project #11: 0|1 for full, null for short
    // Sub-project #15: per-question timing + figure snapshot. Listed so zod's
    // strip mode does NOT drop them — sat.save_attempt reads timeMs + figure
    // off the payload. timeMs is capped at TIME_MS_CAP (600000) at capture;
    // this bound is the airtight backstop (over-cap is rejected). figure is the
    // structured spec (Task 5 narrows it) or null.
    // BOTH must be .optional(): a tab loaded before the #15 deploy builds the
    // old payload shape with NO timeMs/figure keys, and nullable-without-
    // optional rejects the whole save as terminal invalid_payload (two real
    // student attempts were lost this way on 2026-07-07 — see save_failures).
    // The RPC coalesces an absent key to null. EVERY future additive wire
    // field must be .optional() for the same reason.
    timeMs: z.number().int().min(0).max(600000).nullable().optional(),
    figure: z.unknown().nullable().optional(),
    // SPR (Format Parity) fields. Listed so zod's strip mode does NOT drop them —
    // sat.save_attempt reads responseFormat + enteredValue off the payload.
    responseFormat: z.enum(['mcq', 'spr']).optional(),
    enteredValue: z.string().nullable().optional(),
    correctAnswer: z.string().nullable().optional(),
    answerTolerance: z.number().nullable().optional(),
  })
  .refine((r) => r.responseFormat === 'spr' || r.choices.length >= 1, {
    message: 'mcq responses require at least one choice',
    path: ['choices'],
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

import { z } from 'zod';

// Zod schema mirroring the `Lesson` interface in app/lib/lessons/types.ts
// EXACTLY. It validates both sources of lesson content:
//   1. the 35 static, hand-authored-in-code lessons (drift-guarded by
//      scripts/check-lesson-schema.ts — if a static lesson fails this schema,
//      the SCHEMA's bounds have drifted, not the lesson), and
//   2. AI-generated base lessons before they are stored in sat.skill_lessons.
//
// The schema stays PURE zod: the choiceless-`correct`-parses-as-SPR guard is
// deliberately NOT here — it lives in the generation module (app/lib/practice/
// generation.ts), which additionally runs parseSpr on a choiceless example.
// Keeping parseSpr out of the schema keeps this module dependency-light and the
// bounds declarative.

const nonEmpty = z.string().min(1);

const workedExampleSchema = z
  .object({
    // Passage/setup shown above the prompt. Optional for bare math prompts.
    passage: z.string().optional(),
    prompt: nonEmpty,
    // Exactly 4 for mcq-style examples; omitted for SPR-style math examples.
    choices: z.array(nonEmpty).length(4).optional(),
    // The full text of the correct choice, or the SPR answer string.
    correct: nonEmpty,
    // Step-by-step reasoning, 2–5 steps, each a plain sentence or two.
    walkthrough: z.array(nonEmpty).min(2).max(5),
  })
  .refine(
    (w) => w.choices === undefined || w.choices.includes(w.correct),
    { message: 'worked example correct must be one of the choices', path: ['correct'] },
  );

export const lessonSchema = z.object({
  // Must exactly match a name in SKILLS (app/lib/questions.ts).
  skill: nonEmpty,
  // One line: what this skill actually tests.
  tagline: nonEmpty,
  // 1–3 short paragraphs. Direct, second-person, coach-like.
  overview: z.array(nonEmpty).min(1).max(3),
  // 3–5 named strategy steps.
  strategies: z.array(z.object({ title: nonEmpty, body: nonEmpty })).min(3).max(5),
  workedExample: workedExampleSchema,
  // 2–4 common traps, each one sentence.
  traps: z.array(nonEmpty).min(2).max(4),
});

export type GeneratedLesson = z.infer<typeof lessonSchema>;

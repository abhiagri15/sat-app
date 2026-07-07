import { z } from 'zod';

// Zod schema for a per-student "Coach's update" (see the Dynamic Practice
// spec §B). Validates AI-generated guidance before it is stored in
// sat.skill_guidance, and is the wire shape read back for rendering.
//
//   summary   — 2–4 sentences on the student's current state in the skill
//               (accuracy, trend, difficulty profile). Bounded 40–800 chars so
//               a degenerate one-word or runaway response is rejected.
//   focus     — 2–5 items, each tied to a SPECIFIC mistake pattern in the
//               student's evidence: {point, why}.
//   nextSteps — 2–4 concrete actions.
//
// Rendered React-escaped in CoachUpdate; the model never references choices by
// letter (enforced by the prompt, not the schema).

const nonEmpty = z.string().min(1);

export const guidanceSchema = z.object({
  summary: z.string().min(40).max(800),
  focus: z.array(z.object({ point: nonEmpty, why: nonEmpty })).min(2).max(5),
  nextSteps: z.array(nonEmpty).min(2).max(4),
});

export type Guidance = z.infer<typeof guidanceSchema>;

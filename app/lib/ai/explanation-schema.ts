import { z } from 'zod';

// Zod schema for the "Explain my mistake" coach follow-up (design spec §E).
// Validates AI-generated per-question explanations before they are returned to
// the client and logged in sat.coach_explains. One retry on a parse miss lives
// at the caller (explainForUser in app/lib/practice/generation.ts).
//
//   explanation — 2–5 sentences: why the student's specific answer is tempting
//                 but wrong, and how to see the correct path. Plain text, no
//                 letter references (enforced by the prompt, not the schema).
//                 Bounded 40–1200 chars so a degenerate one-word or runaway
//                 response is rejected.
//   takeaway    — one short line the student should remember. Bounded 10–200.
//
// Rendered React-escaped in ExplainMistake; the model never references choices
// by letter (enforced by the prompt).
export const explanationSchema = z.object({
  explanation: z.string().min(40).max(1200),
  takeaway: z.string().min(10).max(200),
});

export type MistakeExplanation = z.infer<typeof explanationSchema>;

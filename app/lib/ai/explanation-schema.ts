import { z } from 'zod';
import { parseSpr } from '@/app/lib/spr';

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

// --- mistakeKey (explanation-cache key normalization, design spec §C) --------
//
// Builds the content-stable `chosen_key` for a row in sat.mistake_explanations.
// The key must survive per-test choice SHUFFLES (so an mcq mistake caches once
// regardless of where the wrong choice landed) yet keep equivalent SPR forms
// together ("3.5" and "7/2" → one key). The PK on the table — (question_id,
// chosen_key) — is what keeps identical wrong-answer text on DIFFERENT questions
// separate; this helper is only responsible for the per-answer half.
//
//   mcq → `mcq:<chosenText>` where chosenText is trimmed, lowercased, and its
//         internal whitespace collapsed to single spaces. Keying on the choice
//         TEXT (not its index) is what buys shuffle-invariance.
//   spr → `spr:<canonical>` where canonical is `String(parseSpr(value).value)`
//         when the entered value parses (so "3.5" and "7/2" both canonicalize to
//         "3.5"), else the trimmed raw string (a non-parseable entry keys on its
//         own literal text).
//
// Pure. `chosenText` is used for mcq; `enteredValue` is used for spr; the caller
// passes both and this picks by `responseFormat`.
export function mistakeKey(
  responseFormat: 'mcq' | 'spr',
  chosenText: string,
  enteredValue: string,
): string {
  if (responseFormat === 'spr') {
    const parsed = parseSpr(enteredValue);
    const canonical = parsed !== null ? String(parsed.value) : enteredValue.trim();
    return `spr:${canonical}`;
  }
  const normalized = chosenText.trim().toLowerCase().replace(/\s+/g, ' ');
  return `mcq:${normalized}`;
}

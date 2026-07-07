import type { GeneratedQuestion } from './schema';
import type { SectionKey } from '../questions';
import { OllamaCloudProvider } from './ollama';

// The minimum a solve call needs to re-derive the answer for either format.
// For mcq we need choices; for spr we ignore choices (always empty there).
//
// Sub-project #15 (figures): both members carry an OPTIONAL `figureText` — the
// deterministic plain-text serialization of the item's figure (describeFigure).
// When present, every solve-side prompt appends `Figure: ${figureText}` so the
// re-solver sees exactly what the student sees (the model never sees the SVG).
export type SolveInput =
  | (Pick<Extract<GeneratedQuestion, { responseFormat: 'mcq' }>,
      'responseFormat' | 'section' | 'skill' | 'passage' | 'prompt' | 'choices'>
      & { figureText?: string })
  | (Pick<Extract<GeneratedQuestion, { responseFormat: 'spr' }>,
      'responseFormat' | 'section' | 'skill' | 'prompt'>
      & { figureText?: string });

// Solver result is polymorphic across response formats. For mcq the model
// returns a 0-based choice index; for spr it returns a typed numeric string
// to be compared with the canonical answer via isSprCorrect.
export type SolveResult =
  | { responseFormat: 'mcq'; answerIndex: number }
  | { responseFormat: 'spr'; answer: string };

// One evidence line handed to generateGuidance: a single past response of the
// student's, distilled for the coach prompt. `difficulty` is null when the
// backing question row is gone (a response can outlive its question), in which
// case the prompt omits the difficulty tag. `format` mirrors the question's
// response format so the prompt can phrase mcq vs grid-in mistakes correctly.
export interface GuidanceEvidenceItem {
  prompt: string;
  chosen: string;
  correct: string;
  isCorrect: boolean;
  difficulty: string | null;
  format: 'mcq' | 'spr';
}

// Input to generateGuidance: the skill under coaching plus the student's
// accuracy picture (overall + last-10) and the recent-response evidence.
export interface GuidanceInput {
  section: SectionKey;
  skill: string;
  accuracyPct: number;
  last10Pct: number | null;
  evidence: GuidanceEvidenceItem[];
}

// Input to explainMistake (design spec §E — "Explain my mistake" coach
// follow-up). Everything the coach needs to explain ONE wrong answer:
//   - the question fields (section, skill, prompt, optional passage, choices)
//   - the correct answer, as text
//   - the student's specific wrong answer: `chosenText` (mcq — the text of the
//     choice they picked) OR `enteredValue` (spr — the string they typed)
//   - `responseFormat` so the prompt phrases mcq vs grid-in correctly
//   - `figureText`: the deterministic describeFigure() serialization when the
//     item carries a figure (the model never sees the SVG)
//   - `trusted`: false when the question text came from a client snapshot (a
//     review item whose sat.questions row was since disabled/deleted) rather
//     than a fresh server re-read; the prompt notes the provenance so the coach
//     hedges on question wording it cannot fully vouch for.
export interface ExplainInput {
  section: SectionKey;
  skill: string;
  prompt: string;
  passage?: string;
  choices: string[];
  correctText: string;
  chosenText: string;
  enteredValue?: string;
  responseFormat: 'mcq' | 'spr';
  figureText?: string;
  trusted: boolean;
}

export interface AIProvider {
  // Generate `count` questions for one (section, skill, difficulty).
  // Caller decides mcq vs spr via the `useSpr` flag (spr is Math-only).
  // Sub-project #11 added `targetDifficulty` so the thinnest-first picker
  // can request the difficulty cell that's underfilled.
  //
  // Sub-project #15 (figures): the OPTIONAL trailing `wantFigure` flag asks the
  // model to attach a `figure` spec (per the exact JSON shape documented in the
  // prompt). It is backward-compatible — omitted (default false) means no figure
  // instructions are added and the prompt is byte-identical to before. Only the
  // cron/top-up caller sets it, and only for FIGURE_SKILLS math targets on a
  // coin flip; a schema-invalid figure rejects the candidate (rejectedSchema).
  generateQuestions(
    section: 'rw' | 'math',
    skill: string,
    count: number,
    useSpr: boolean,
    targetDifficulty: 'easy' | 'medium' | 'hard',
    wantFigure?: boolean,
  ): Promise<GeneratedQuestion[]>;
  // Re-solve a question for the self-verify gate. Branches on responseFormat.
  solve(q: SolveInput): Promise<SolveResult>;
  // Multi-validity check for mcq self-verify: ask the model to identify ALL
  // valid choice indices (not just the "best"). Used to reject a candidate
  // when the choice list accidentally contains two correct answers — e.g. a
  // quadratic with two roots where both roots appear in the choice list.
  // Returns the list of 0-based indices the model judges valid (typically
  // length 1; length > 1 means the candidate is faulty).
  findValidChoices(q: Extract<SolveInput, { responseFormat: 'mcq' }>): Promise<number[]>;
  // Repair attempt for a candidate that failed the multi-validity check:
  // the intended answer is at `answerIndex`; the indices in `indicesToReplace`
  // are also valid and need to become plausible-but-wrong distractors.
  // Returns a new 4-element choice array on success, or null if the LLM
  // can't produce a clean replacement. The caller re-runs findValidChoices
  // on the repaired array — only accepts the candidate if the repair holds.
  repairMultiValid(input: {
    section: 'rw' | 'math';
    skill: string;
    passage: string | null | undefined;
    prompt: string;
    choices: string[];
    answerIndex: number;
    indicesToReplace: number[];
    // Sub-project #15 (figures): appended as `Figure: ${figureText}` when present.
    figureText?: string;
  }): Promise<{ choices: string[] } | null>;
  // Generate one AI base lesson for a (section, skill) as a single JSON object
  // matching the `Lesson` shape. Returns `unknown` so zod validation
  // (`lessonSchema`) stays at the caller — same posture as `generateQuestions`
  // deferring to `generatedQuestionSchema`.
  generateLesson(section: SectionKey, skill: string): Promise<unknown>;
  // Generate a per-student "Coach's update" from their accuracy + recent
  // response evidence. Returns `unknown`; the caller validates via
  // `guidanceSchema`.
  generateGuidance(input: GuidanceInput): Promise<unknown>;
  // Explain ONE wrong answer to the student (design spec §E). The prompt gets
  // the question + choices + correct answer + the student's specific answer and
  // asks why their pick is tempting but wrong and how to see the correct path
  // (2–5 sentences) plus one takeaway line. Returns `unknown`; the caller
  // validates via `explanationSchema`. Student content is treated as quoted
  // data, never instructions; the response is plain text with no letter refs.
  explainMistake(input: ExplainInput): Promise<unknown>;
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

// Lesson content model for the Practice section. Lessons are static,
// hand-authored-in-code data (see docs/superpowers/specs/
// 2026-07-07-focus-area-practice-design.md): plain strings only — every field
// renders React-escaped, so no HTML. Never reference choices by letter
// ("Choice A"); quote the option's text instead.

export interface WorkedExample {
  /** Passage/setup shown above the prompt. Optional for bare math prompts. */
  passage?: string;
  prompt: string;
  /** Exactly 4 for mcq-style examples; omit for SPR-style math examples. */
  choices?: string[];
  /** The full text of the correct choice, or the SPR answer string. */
  correct: string;
  /** Step-by-step reasoning, 2–5 steps, each one plain sentence or two. */
  walkthrough: string[];
}

export interface Lesson {
  /** Must exactly match a name in SKILLS (app/lib/questions.ts). */
  skill: string;
  /** One line: what this skill actually tests. */
  tagline: string;
  /** 1–3 short paragraphs. Direct, second-person, coach-like. */
  overview: string[];
  /** 3–5 named strategy steps. */
  strategies: { title: string; body: string }[];
  workedExample: WorkedExample;
  /** 2–4 common traps, each one sentence. */
  traps: string[];
}

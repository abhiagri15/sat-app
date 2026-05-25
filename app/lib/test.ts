import type { Question, SectionKey } from './questions';
import { BANK as DEFAULT_BANK, SECTION_CONFIG, SECTION_ORDER } from './questions';
import { isSprCorrect } from './spr';

export const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

// A per-question response. mcq answers are the chosen index (0..3); spr
// answers are the entered string (e.g. "3.14" or "1/2"); null = unanswered.
export type ResponseValue = number | string | null;

export interface TestSection {
  key: SectionKey;
  name: string;
  questions: Question[];   // already shuffled; choice order already shuffled per-question
  timeLimit: number;       // seconds
}

export interface Test {
  name: string;
  sections: TestSection[];
}

export interface Results {
  perSection: { name: string; correct: number; total: number }[];
  pct: number;
  scaled: number;          // 400..1600, rounded to nearest 10
}

export type TestLength = 'short' | 'full';

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Shuffles a question's `choices` and rewrites `answerIndex` to point to the
// new position. No-op for SPR questions (their `choices` is a placeholder
// empty array; the answer is the typed `correct_answer` text).
export function shuffleChoices(q: Question): Question {
  if (q.response_format === 'spr') return q;
  const idxs = shuffle(q.choices.map((_, i) => i));
  return {
    ...q,
    choices: idxs.map((i) => q.choices[i]),
    answerIndex: idxs.indexOf(q.answerIndex),
  };
}

export function buildTest(
  name: string,
  testLength: TestLength,
  bank: Question[] = DEFAULT_BANK,
): Test {
  const sections: TestSection[] = SECTION_ORDER.map((secKey) => {
    const cfg = SECTION_CONFIG[secKey];
    const pool = shuffle(bank.filter((q) => q.section === secKey));
    const count = testLength === 'short' ? Math.min(cfg.shortCount, pool.length) : pool.length;
    const questions = pool.slice(0, count).map(shuffleChoices);
    return {
      key: secKey,
      name: cfg.name,
      questions,
      timeLimit: count * cfg.secsPerQ,
    };
  });
  return { name: name || 'Student', sections };
}

export function computeResults(
  test: Test,
  responses: ResponseValue[][],
): Results {
  let totalCorrect = 0;
  let totalQ = 0;
  const perSection = test.sections.map((sec, si) => {
    let correct = 0;
    sec.questions.forEach((q, qi) => {
      const v = responses[si][qi];
      if (q.response_format === 'spr') {
        if (
          typeof v === 'string' &&
          q.correct_answer &&
          isSprCorrect(v, q.correct_answer, q.answer_tolerance ?? null)
        ) {
          correct++;
        }
      } else if (v === q.answerIndex) {
        correct++;
      }
    });
    totalCorrect += correct;
    totalQ += sec.questions.length;
    return { name: sec.name, correct, total: sec.questions.length };
  });
  const pct = totalQ ? totalCorrect / totalQ : 0;
  const scaled = Math.round((400 + pct * 1200) / 10) * 10;
  return { perSection, pct, scaled };
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

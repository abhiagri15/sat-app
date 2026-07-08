import type { Question, SectionKey } from './questions';
import { BANK, SECTION_CONFIG, SECTION_ORDER } from './questions';
import { isSprCorrect } from './spr';
import { projectShort, scoreComposite, scoreFullSection } from './scoring';

export const LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

// Per-question active-display time cap (milliseconds) — 10 minutes. A single
// question's accumulated display time is clamped to this at capture so a
// walked-away tab (or a wall-clock jump) can't poison the pacing averages.
// Timing is display/analytics-only — it never feeds scoring (Section A / the
// security invariants). Shared by both timing stopwatches (useTestSession +
// usePracticeSession) and the zod bound in both payload schemas.
export const TIME_MS_CAP = 600_000;

// A per-question response. mcq answers are the chosen index (0..3); spr
// answers are the entered string (e.g. "3.14" or "1/2"); null = unanswered.
export type ResponseValue = number | string | null;

// The single "answered" predicate, shared across the runner (submitModule's
// unanswered counts), the navigator, Check-Your-Work, and the review "skipped"
// inverse. A response counts as answered when it is non-null AND, for SPR, its
// trimmed string is non-empty (a cleared grid-in "" is unanswered). mcq index 0
// counts. Keep every call site on this one predicate — the counts disagreed
// on cleared SPR entries before it existed (audit A6).
export function isAnswered(r: ResponseValue): boolean {
  return r !== null && (typeof r !== 'string' || r.trim() !== '');
}

// Sub-project #11: a section is now composed of one or more modules.
// Short tests have a single module per section (length 1). Full tests
// build Module 1 up-front; Module 2 is appended via `appendModule2`
// after the Module 1 submit decides the routing path.
export interface TestModule {
  index: number;            // 0 = Module 1, 1 = Module 2
  questions: Question[];    // already shuffled; choice order also shuffled per-q
  timeLimit: number;        // seconds — moduleSize × secsPerQ
}

export interface TestSection {
  key: SectionKey;
  name: string;
  modules: TestModule[];                       // length 1 (short) or 2 (full)
  module2Path?: 'easier' | 'harder';           // set when Module 2 is appended
}

export type TestLength = 'short' | 'full';

export interface Test {
  name: string;
  length: TestLength;                          // drives the scoring branch
  sections: TestSection[];
}

export interface Results {
  perSection: {
    name: string;
    sectionKey: SectionKey;                    // routes scale_section + propagates to payload
    correct: number;
    total: number;
    scaled: number;                            // 200..800 per section
    projectedRaw?: number;                     // set only when the test was 'short'
    module2Path?: 'easier' | 'harder';         // set only when the test was 'full'
  }[];
  pct: number;
  scaled: number;                              // composite, 400..1600
}

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

// Convenience: flatten a section's questions across all modules.
// Useful for cross-module navigation and bulk review rendering.
export function sectionQuestions(s: TestSection): Question[] {
  return s.modules.flatMap((m) => m.questions);
}

// buildTest builds Module 1 only. Module 2 is appended via `appendModule2`
// once routing is decided after the Module 1 submit.
//
// `module1Bank` is optional — when omitted, builds from the in-code BANK
// offline fallback (the catch branch of useTestSession.start()).
export function buildTest(
  name: string,
  testLength: TestLength,
  module1Bank?: Record<SectionKey, Question[]>,
): Test {
  const bank = module1Bank ?? buildFallbackBank();
  const sections: TestSection[] = SECTION_ORDER.map((secKey) => {
    const cfg = SECTION_CONFIG[secKey];
    const moduleSize = testLength === 'short'
      ? Math.min(cfg.shortCount, bank[secKey].length)
      : Math.min(cfg.moduleSize, bank[secKey].length);
    const questions = bank[secKey].slice(0, moduleSize).map(shuffleChoices);
    // Full-test Module 1 seeds from the official `moduleSeconds`; short tests
    // from the derived per-question budget. `secsPerQ` is fractional now, so
    // Math.round keeps the seed integral (see SECTION_CONFIG comment). When a
    // cold-start pool draw yields fewer than a full module, the seed scales
    // down proportionally rather than over-timing the shortened module.
    const timeLimit = testLength === 'full' && moduleSize === cfg.moduleSize
      ? cfg.moduleSeconds
      : Math.round(moduleSize * cfg.secsPerQ);
    return {
      key: secKey,
      name: cfg.name,
      modules: [{ index: 0, questions, timeLimit }],
    };
  });
  return { name: name || 'Student', length: testLength, sections };
}

// Append Module 2 to a section after the Module 1 routing decision.
// Returns a new Test (sections re-mapped immutably) so React state
// updates can rely on a fresh top-level reference.
export function appendModule2(
  test: Test,
  secIdx: number,
  drawn: Question[],
  path: 'easier' | 'harder',
): Test {
  const sec = test.sections[secIdx];
  const cfg = SECTION_CONFIG[sec.key];
  const moduleSize = Math.min(cfg.moduleSize, drawn.length);
  const questions = drawn.slice(0, moduleSize).map(shuffleChoices);
  // Module 2 is full-test-only. A complete module seeds from the official
  // `moduleSeconds`; a cold-start short module scales down proportionally.
  // `secsPerQ` is fractional, so Math.round keeps the seed integral.
  const timeLimit = moduleSize === cfg.moduleSize
    ? cfg.moduleSeconds
    : Math.round(moduleSize * cfg.secsPerQ);
  const m2: TestModule = { index: 1, questions, timeLimit };
  const newSections = test.sections.map((s, i) =>
    i === secIdx ? { ...s, modules: [s.modules[0], m2], module2Path: path } : s,
  );
  return { ...test, sections: newSections };
}

// Offline-fallback bank: shuffle BANK per section. Difficulty isn't
// represented in BANK; the resulting Module 1 is whatever falls out of
// shuffle. Acceptable for the fallback path — the real composition rule
// (9 easy + 9 medium + 9 hard, etc.) only applies when the pool draw
// succeeded.
function buildFallbackBank(): Record<SectionKey, Question[]> {
  return {
    rw:   shuffle(BANK.filter((q) => q.section === 'rw')),
    math: shuffle(BANK.filter((q) => q.section === 'math')),
  };
}

// computeResults: scores a finished test. Responses are 3-D —
// [section][module][question] — to match the per-module FSM in the hook.
// Throws if a full-test section is missing `module2Path`: that would mean
// the FSM let Module 2 finish without recording the routing decision,
// which is a programmer error (and would silently mis-score otherwise).
export function computeResults(
  test: Test,
  responses: ResponseValue[][][],
): Results {
  let totalCorrect = 0;
  let totalQ = 0;
  const perSection = test.sections.map((sec, si) => {
    let correct = 0;
    let total = 0;
    sec.modules.forEach((mod, mi) => {
      mod.questions.forEach((q, qi) => {
        const v = responses[si]?.[mi]?.[qi];
        if (q.response_format === 'spr') {
          if (
            typeof v === 'string' &&
            q.correct_answer &&
            isSprCorrect(v, q.correct_answer, q.answer_tolerance ?? null)
          ) {
            correct++;
          }
        } else if (typeof v === 'number' && v === q.answerIndex) {
          correct++;
        }
      });
      total += mod.questions.length;
    });
    totalCorrect += correct;
    totalQ += total;

    if (test.length === 'short') {
      const p = projectShort(sec.key, correct, total);
      return {
        name: sec.name,
        sectionKey: sec.key,
        correct,
        total,
        scaled: p.scaled,
        projectedRaw: p.projectedRaw,
      };
    }
    if (!sec.module2Path) {
      throw new Error(
        `computeResults: full-test section ${sec.key} missing module2Path`,
      );
    }
    return {
      name: sec.name,
      sectionKey: sec.key,
      correct,
      total,
      scaled: scoreFullSection(sec.key, correct, sec.module2Path),
      module2Path: sec.module2Path,
    };
  });
  const pct = totalQ ? totalCorrect / totalQ : 0;
  const scaled = scoreComposite(
    perSection[0]?.scaled ?? 200,
    perSection[1]?.scaled ?? 200,
  );
  return { perSection, pct, scaled };
}

export function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

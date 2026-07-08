'use client';

import { createClient } from '@/app/lib/supabase/client';
import {
  SECTION_CONFIG,
  SECTION_ORDER,
  skillsInDomain,
  rowToQuestion,
  type Question,
  type SectionKey,
} from '@/app/lib/questions';
import {
  allocateModule,
  type Difficulty,
  type DifficultySlot,
  type DomainDifficultyCell,
} from '@/app/lib/assembly';

// Pool layer: three top-level entry points (drawShortTest / drawFullTestModule1
// / drawModule2) over a shared, domain-aware slot filler.
//
// Full tests are assembled to the official Digital SAT domain blueprint:
// `allocateModule` produces a domain×difficulty matrix (rows = blueprint quotas,
// columns = the difficulty composition), and each non-zero cell is filled by a
// skill-restricted draw. Short tests stay a simple per-section random draw.

// Short tests: one pool call per section, no difficulty/domain filter.
export async function drawShortTest(): Promise<Record<SectionKey, Question[]>> {
  const result: Record<SectionKey, Question[]> = { rw: [], math: [] };
  for (const sec of SECTION_ORDER) {
    const cfg = SECTION_CONFIG[sec];
    const drawn = await rpcDraw(sec, null, null, cfg.shortCount);
    if (drawn.length === 0) {
      throw new Error(`drawShortTest: no questions for section "${sec}"`);
    }
    result[sec] = drawn;
  }
  return result;
}

// Full-test Module 1: domain-weighted AND difficulty-composed per section.
// Difficulty margins: R&W 9 easy / 9 medium / 9 hard; Math 8 / 7 / 7.
// Domain margins: the blueprint (allocateModule). Question order within the
// module is shuffled so the domain/difficulty cells are not presented in blocks.
export async function drawFullTestModule1(): Promise<Record<SectionKey, Question[]>> {
  const result: Record<SectionKey, Question[]> = { rw: [], math: [] };
  for (const sec of SECTION_ORDER) {
    const collected = await fillModule(sec, allocateModule(sec, MODULE1_COMPOSITION[sec]));
    if (collected.length === 0) {
      throw new Error(`drawFullTestModule1: no questions for section "${sec}"`);
    }
    result[sec] = shuffle(collected);
  }
  return result;
}

// Module 2: lazy draw after Module 1 submit decides the routing path.
// Difficulty margins: 70% primary (easy on 'easier', hard on 'harder') + 30%
// medium. Domain margins: the same blueprint, so the full section (both
// modules) lands on the blueprint.
export async function drawModule2(
  section: SectionKey,
  path: 'easier' | 'harder',
): Promise<Question[]> {
  const cfg = SECTION_CONFIG[section];
  const moduleSize = cfg.moduleSize;
  const primaryDifficulty: Difficulty = path === 'easier' ? 'easy' : 'hard';
  const primaryCount = Math.round(moduleSize * 0.7); // 19 (R&W), 15 (Math)
  const mediumCount = moduleSize - primaryCount; //      8 (R&W),  7 (Math)
  const slots: DifficultySlot[] = [
    { difficulty: primaryDifficulty, count: primaryCount },
    { difficulty: 'medium', count: mediumCount },
  ];
  return shuffle(await fillModule(section, allocateModule(section, slots)));
}

// Fill every cell of an allocated module, de-duplicating across cells.
async function fillModule(
  section: SectionKey,
  cells: DomainDifficultyCell[],
): Promise<Question[]> {
  const drawn = new Set<string>();
  const collected: Question[] = [];
  for (const cell of cells) {
    collected.push(...(await fillCell(section, cell, drawn)));
  }
  return collected;
}

// Fill one domain×difficulty cell with a graceful fallback that prioritises the
// DOMAIN (the blueprint goal) over difficulty: (1) domain + exact difficulty →
// (2) domain, any difficulty → (3) any domain, that difficulty → (4) anything
// in the section. `alreadyDrawn` is shared across cells and mutated here, so a
// question is never used twice in a module. Returns up to `cell.count`
// questions (fewer only if the whole section pool is exhausted).
async function fillCell(
  section: SectionKey,
  cell: DomainDifficultyCell,
  alreadyDrawn: Set<string>,
): Promise<Question[]> {
  const skills = skillsInDomain(section, cell.domain);
  const collected: Question[] = [];
  const need = (): number => cell.count - collected.length;
  const add = (qs: Question[]): void => {
    for (const q of qs) {
      if (collected.length >= cell.count) break;
      if (!alreadyDrawn.has(q.id)) {
        alreadyDrawn.add(q.id);
        collected.push(q);
      }
    }
  };

  add(await rpcDraw(section, skills, cell.difficulty, need())); // tier 1
  if (need() > 0) add(await rpcDraw(section, skills, null, need())); // tier 2
  if (need() > 0) add(await rpcDraw(section, null, cell.difficulty, need())); // tier 3
  if (need() > 0) add(await rpcDraw(section, null, null, need())); // tier 4
  return collected;
}

async function rpcDraw(
  section: SectionKey,
  skills: string[] | null,
  difficulty: Difficulty | null,
  count: number,
): Promise<Question[]> {
  if (count <= 0) return [];
  const supabase = createClient();
  const { data, error } = await supabase.schema('sat').rpc('draw_questions', {
    p_section: section,
    p_skill: null,
    p_skills: skills,
    p_difficulty: difficulty,
    p_count: count,
    // Every pool.ts draw feeds a SCORED test — strict mode excludes
    // needs_review items (design spec §A). Drills use draw_drill (untouched).
    p_strict: true,
  });
  if (error) {
    throw new Error(
      `draw_questions failed (section=${section}, difficulty=${difficulty ?? 'any'}, skills=${
        skills ? skills.length : 'any'
      }): ${error.message}`,
    );
  }
  return (data ?? []).map(rowToQuestion);
}

// Fisher-Yates; used to randomise question order within an assembled module so
// the domain/difficulty cells are not surfaced in blocks.
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Per-section Module 1 difficulty composition. R&W 27 = 9/9/9; Math 22 = 8/7/7.
// These are the column margins handed to allocateModule; the domain blueprint
// supplies the row margins.
const MODULE1_COMPOSITION: Record<SectionKey, DifficultySlot[]> = {
  rw: [
    { difficulty: 'easy', count: 9 },
    { difficulty: 'medium', count: 9 },
    { difficulty: 'hard', count: 9 },
  ],
  math: [
    { difficulty: 'easy', count: 8 },
    { difficulty: 'medium', count: 7 },
    { difficulty: 'hard', count: 7 },
  ],
};

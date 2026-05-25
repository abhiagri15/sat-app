'use client';

import { createClient } from '@/app/lib/supabase/client';
import {
  SECTION_CONFIG,
  SECTION_ORDER,
  rowToQuestion,
  type Question,
  type SectionKey,
} from '@/app/lib/questions';

// Sub-project #11: pool layer is split into three top-level entry points
// (drawShortTest / drawFullTestModule1 / drawModule2) plus a shared
// 3-tier difficulty-aware slot filler. The single drawTestQuestions
// helper from #2 is replaced.
//
// Short tests: one pool call per section, no difficulty filter.
export async function drawShortTest(): Promise<Record<SectionKey, Question[]>> {
  const result: Record<SectionKey, Question[]> = { rw: [], math: [] };
  for (const sec of SECTION_ORDER) {
    const cfg = SECTION_CONFIG[sec];
    const drawn = await rpcDraw(sec, null, cfg.shortCount);
    if (drawn.length === 0) {
      throw new Error(`drawShortTest: no questions for section "${sec}"`);
    }
    result[sec] = drawn;
  }
  return result;
}

// Full-test Module 1: composition-aware per section.
// R&W: 9 easy + 9 medium + 9 hard.  Math: 8 easy + 7 medium + 7 hard.
export async function drawFullTestModule1(): Promise<Record<SectionKey, Question[]>> {
  const result: Record<SectionKey, Question[]> = { rw: [], math: [] };
  for (const sec of SECTION_ORDER) {
    const drawn = new Set<string>();
    const slots = MODULE1_COMPOSITION[sec];
    const collected: Question[] = [];
    for (const slot of slots) {
      const qs = await fillSlot(sec, slot.difficulty, slot.count, drawn);
      qs.forEach((q) => drawn.add(q.id));
      collected.push(...qs);
    }
    if (collected.length === 0) {
      throw new Error(`drawFullTestModule1: no questions for section "${sec}"`);
    }
    result[sec] = collected;
  }
  return result;
}

// Module 2: lazy draw after Module 1 submit decides the routing path.
// 70% primary (easy on 'easier' path, hard on 'harder' path) + 30% medium.
export async function drawModule2(
  section: SectionKey,
  path: 'easier' | 'harder',
): Promise<Question[]> {
  const drawn = new Set<string>();
  const primaryDifficulty = path === 'easier' ? 'easy' : 'hard';
  const cfg = SECTION_CONFIG[section];
  const moduleSize = cfg.moduleSize;
  const primaryCount = Math.round(moduleSize * 0.7);   // 19 (R&W), 15 (Math)
  const mediumCount = moduleSize - primaryCount;        // 8 (R&W),  7 (Math)
  const primary = await fillSlot(section, primaryDifficulty, primaryCount, drawn);
  primary.forEach((q) => drawn.add(q.id));
  const medium = await fillSlot(section, 'medium', mediumCount, drawn);
  return [...primary, ...medium];
}

// 3-tier slot fill: try the primary difficulty first; if the pool can't
// supply the requested count, top up with medium; if still short, fall
// back to any-difficulty. Caller passes in `alreadyDrawn` so the second
// and third tiers don't duplicate ids the slot has just collected.
// Returns up to `count` distinct questions (may be fewer if the entire
// pool for the section is smaller than `count`).
async function fillSlot(
  section: SectionKey,
  primary: 'easy' | 'medium' | 'hard',
  count: number,
  alreadyDrawn: Set<string>,
): Promise<Question[]> {
  const t1 = (await rpcDraw(section, primary, count)).filter((q) => !alreadyDrawn.has(q.id));
  if (t1.length >= count) return t1.slice(0, count);
  const need2 = count - t1.length;
  const t2 = primary === 'medium'
    ? []
    : (await rpcDraw(section, 'medium', need2)).filter(
        (q) => !alreadyDrawn.has(q.id) && !t1.some((p) => p.id === q.id),
      );
  const combined = [...t1, ...t2];
  if (combined.length >= count) return combined.slice(0, count);
  const need3 = count - combined.length;
  const t3 = (await rpcDraw(section, null, need3)).filter(
    (q) => !alreadyDrawn.has(q.id) && !combined.some((p) => p.id === q.id),
  );
  return [...combined, ...t3].slice(0, count);
}

async function rpcDraw(
  section: SectionKey,
  difficulty: 'easy' | 'medium' | 'hard' | null,
  count: number,
): Promise<Question[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema('sat')
    .rpc('draw_questions', {
      p_section: section,
      p_skill: null,
      p_difficulty: difficulty,
      p_count: count,
    });
  if (error) {
    throw new Error(
      `draw_questions failed (section=${section}, difficulty=${difficulty ?? 'any'}): ${error.message}`,
    );
  }
  return (data ?? []).map(rowToQuestion);
}

// Per-section Module 1 composition. R&W has 27 questions split 9/9/9;
// Math has 22 split 8/7/7. These slots fan out to the 3-tier fillSlot
// helper, which guarantees the requested count when the pool can supply it.
const MODULE1_COMPOSITION: Record<
  SectionKey,
  { difficulty: 'easy' | 'medium' | 'hard'; count: number }[]
> = {
  rw:   [
    { difficulty: 'easy',   count: 9 },
    { difficulty: 'medium', count: 9 },
    { difficulty: 'hard',   count: 9 },
  ],
  math: [
    { difficulty: 'easy',   count: 8 },
    { difficulty: 'medium', count: 7 },
    { difficulty: 'hard',   count: 7 },
  ],
};

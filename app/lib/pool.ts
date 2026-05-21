'use client';

import { createClient } from '@/app/lib/supabase/client';
import {
  SECTION_ORDER,
  SECTION_CONFIG,
  rowToQuestion,
  type Question,
} from '@/app/lib/questions';
import type { TestLength } from '@/app/lib/test';

// Draws a test's worth of questions from sat.questions for the signed-in user,
// via the draw_questions RPC (excludes already-served; recycles if exhausted).
export async function drawTestQuestions(testLength: TestLength): Promise<Question[]> {
  const supabase = createClient();
  const out: Question[] = [];
  for (const section of SECTION_ORDER) {
    const count =
      testLength === 'short'
        ? SECTION_CONFIG[section].shortCount
        : SECTION_CONFIG[section].fullCount;
    const { data, error } = await supabase
      .schema('sat')
      .rpc('draw_questions', { p_section: section, p_count: count });
    if (error) {
      throw new Error(`draw_questions failed for section "${section}": ${error.message}`);
    }
    const rows = data ?? [];
    if (rows.length === 0) {
      // An empty section would yield a broken test — fail so the caller falls
      // back to the in-code BANK rather than serving a section with no questions.
      throw new Error(`draw_questions returned no questions for section "${section}"`);
    }
    for (const row of rows) out.push(rowToQuestion(row));
  }
  return out;
}

'use client';

import { createClient } from '@/app/lib/supabase/client';
import { rowToQuestion, type Question } from '@/app/lib/questions';

// Draws a drill for one skill via the missed-first draw_drill RPC.
// Order is meaningful (missed questions first) — do not shuffle the array;
// only choices within each mcq get shuffled (the caller does that).
export async function drawDrill(
  skill: string,
  count = 10,
): Promise<Question[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .schema('sat')
    .rpc('draw_drill', { p_skill: skill, p_count: count });
  if (error) {
    throw new Error(`draw_drill failed (skill=${skill}): ${error.message}`);
  }
  return (data ?? []).map(rowToQuestion);
}

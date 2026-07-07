'use client';

import { createClient } from '@/app/lib/supabase/client';

// One practice_responses row, as needed to wire miss-reason chips onto the
// drill recap (#18, design spec §A). `position` is the drill index the client
// sent, which save_practice persists verbatim — the recap maps chips to
// results by it. RLS (select-own on sat.practice_responses) scopes the rows to
// the caller.
export interface PracticeResponseTagRow {
  id: string;
  position: number;
  is_correct: boolean;
  miss_reason: string | null;
}

// Fetches the just-saved drill's response rows so the recap can render
// miss-reason chips (mapped by position). Called once the summary knows the
// saved session id. Degrades silently: on any error it returns [] and the
// caller simply renders no chips.
export async function fetchSessionResponseTags(
  sessionId: string,
): Promise<PracticeResponseTagRow[]> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .schema('sat')
      .from('practice_responses')
      .select('id, position, is_correct, miss_reason')
      .eq('session_id', sessionId)
      .order('position', { ascending: true });
    if (error) {
      console.error('[fetchSessionResponseTags] failed:', error.message);
      return [];
    }
    return (data ?? []) as unknown as PracticeResponseTagRow[];
  } catch (e) {
    console.error('[fetchSessionResponseTags] threw:', e);
    return [];
  }
}

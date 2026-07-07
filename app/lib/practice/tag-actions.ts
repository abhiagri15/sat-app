'use server';

import { createClient } from '@/app/lib/supabase/server';
import { MISS_REASON_VALUES } from './miss-reasons';

// The write path for a miss-reason tag (#18, design spec §A). Wraps the
// sat.tag_miss_reason security-definer RPC, which guards the UPDATE on
// `id = p_response_id and user_id = auth.uid() and is_correct = false` and is a
// SILENT no-op (returns false) for a stale/foreign/correct row — a stale client
// id must never 500.
//
// `origin` picks the table ('test' → attempt_responses, 'practice' →
// practice_responses). `reason` is one of the closed MISS_REASONS values, or
// null to clear the tag (re-taggable). Both are validated here before the RPC;
// the SQL CHECK + the RPC's own guards are the backstops.
//
// NEVER throws. Returns:
//   { ok: true, applied: true }  — the row was updated (FOUND).
//   { ok: true, applied: false } — valid call, but no matching row (silent
//                                  no-op — the caller reverts its optimistic UI).
//   { ok: false }                — bad input or an RPC error (also reverts).
export type TagMissReasonResult =
  | { ok: true; applied: boolean }
  | { ok: false };

export async function tagMissReason(
  origin: 'test' | 'practice',
  responseId: string,
  reason: string | null,
): Promise<TagMissReasonResult> {
  // Validate origin/reason against the closed sets (null reason allowed).
  if (origin !== 'test' && origin !== 'practice') {
    return { ok: false };
  }
  if (typeof responseId !== 'string' || responseId.length === 0) {
    return { ok: false };
  }
  if (reason !== null && !MISS_REASON_VALUES.includes(reason)) {
    return { ok: false };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.schema('sat').rpc('tag_miss_reason', {
      p_origin: origin,
      p_response_id: responseId,
      p_reason: reason,
    });
    if (error) {
      console.error('[tagMissReason] failed:', error.message);
      return { ok: false };
    }
    // The RPC returns the boolean FOUND: true when a matching row was updated.
    return { ok: true, applied: data === true };
  } catch (e) {
    console.error('[tagMissReason] threw:', e);
    return { ok: false };
  }
}

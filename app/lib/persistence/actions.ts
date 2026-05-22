'use server';

import { createClient } from '@/app/lib/supabase/server';
import { attemptPayloadSchema } from './schema';
import type { AttemptPayload } from './payload';

export type SaveAttemptResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

// Persists a finished test. Validates the payload, then calls the
// sat.save_attempt RPC — transactional, and it sets user_id from auth.uid()
// itself, so the client never supplies an identity.
export async function saveAttempt(
  payload: AttemptPayload,
): Promise<SaveAttemptResult> {
  const parsed = attemptPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    console.error('[saveAttempt] invalid payload', parsed.error);
    return { ok: false, error: 'invalid payload' };
  }
  const p = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.schema('sat').rpc('save_attempt', {
    p_attempt: {
      studentName: p.studentName,
      testLength: p.testLength,
      totalCorrect: p.totalCorrect,
      totalQuestions: p.totalQuestions,
      scaledScore: p.scaledScore,
      sectionBreakdown: p.sectionBreakdown,
    },
    p_responses: p.responses,
  });
  if (error) {
    console.error('[saveAttempt] rpc error', error);
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data as string };
}

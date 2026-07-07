'use server';

import { createClient } from '@/app/lib/supabase/server';
import { logSaveFailure } from '@/app/lib/persistence/failures';
import { practicePayloadSchema } from './schema';
import type { PracticePayload } from './payload';

export interface SavePracticeResult {
  ok: boolean;
  sessionId?: string;
  error?: string;
}

// Persists a finished drill. Validates the payload, then calls the
// sat.save_practice RPC — transactional, idempotent on (user_id, sessionUuid),
// and it re-verifies correctness server-side (the client's isCorrect is a
// display hint only). On failure it records a save_failures diagnostics row.
export async function savePractice(
  payload: PracticePayload,
): Promise<SavePracticeResult> {
  const parsed = practicePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    await logSaveFailure({
      errorMessage: 'invalid practice payload',
      errorCode: 'invalid_payload',
      retryable: false,
      context: { kind: 'practice', skill: payload?.skill },
    });
    return { ok: false, error: 'invalid payload' };
  }
  const { responses, ...session } = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema('sat')
    .rpc('save_practice', { p_session: session, p_responses: responses });
  if (error) {
    console.error('[practice] save_practice failed:', error.message);
    await logSaveFailure({
      errorMessage: error.message,
      errorCode: 'rpc_error',
      retryable: true,
      context: { kind: 'practice', skill: parsed.data.skill },
    });
    return { ok: false, error: error.message };
  }
  return { ok: true, sessionId: data as string };
}

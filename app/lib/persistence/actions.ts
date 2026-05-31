'use server';

import { createClient } from '@/app/lib/supabase/server';
import { createAdminClient } from '@/app/lib/supabase/admin';
import { attemptPayloadSchema } from './schema';
import { classifyError, isRetryable, type SaveErrorCode } from './retry';
import type { AttemptPayload } from './payload';

export type SaveAttemptResult =
  | { ok: true; id: string }
  | { ok: false; error: string; code: SaveErrorCode; retryable: boolean };

// Diagnostic metadata for the save_failures log. Optional — the save works
// without it; it just gives us a queryable trail when a save fails.
export interface SaveAttemptMeta {
  attemptUuid?: string;
  attemptNo?: number; // 1-indexed retry counter from the client
  userAgent?: string;
}

// Best-effort: record a failed save so the root-cause trigger is queryable
// (the failure message used to be console.error'd in the browser and lost).
// Uses the service-role client so it records even the "not authenticated"
// failure mode, where the caller has no usable session. Never throws — a
// logging failure must not mask the real error from the user.
async function logSaveFailure(
  error: string,
  code: SaveErrorCode,
  retryable: boolean,
  userId: string | null,
  payload: AttemptPayload,
  meta?: SaveAttemptMeta,
): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.schema('sat').from('save_failures').insert({
      user_id: userId,
      error_message: error.slice(0, 2000),
      error_code: code,
      retryable,
      attempt_no: meta?.attemptNo ?? null,
      context: {
        testLength: payload.testLength,
        totalQuestions: payload.totalQuestions,
        attemptUuid: meta?.attemptUuid ?? null,
        userAgent: meta?.userAgent ?? null,
      },
    });
  } catch (e) {
    console.error('[saveAttempt] failed to log save failure (non-fatal):', e);
  }
}

// Persists a finished test. Validates the payload, then calls the
// sat.save_attempt RPC — transactional, and it sets user_id from auth.uid()
// itself, so the client never supplies an identity. On failure it returns a
// classified, retryable-flagged error AND records a save_failures row.
export async function saveAttempt(
  payload: AttemptPayload,
  meta?: SaveAttemptMeta,
): Promise<SaveAttemptResult> {
  const parsed = attemptPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    console.error('[saveAttempt] invalid payload', parsed.error);
    const code = classifyError('invalid payload');
    await logSaveFailure('invalid payload', code, isRetryable(code), null, payload, meta);
    return { ok: false, error: 'invalid payload', code, retryable: isRetryable(code) };
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
      // Idempotency key: lets a lost-response resave (same uuid) be a no-op in
      // sat.save_attempt instead of creating a duplicate attempt. Omitted →
      // the RPC falls back to always-insert.
      attemptUuid: meta?.attemptUuid ?? null,
    },
    p_responses: p.responses,
  });
  if (error) {
    console.error('[saveAttempt] rpc error', error);
    const code = classifyError(error.message);
    const retryable = isRetryable(code);
    // Read the user id for the log (best-effort; null is itself informative
    // when the failure is the session being gone).
    let userId: string | null = null;
    try {
      const { data: u } = await supabase.auth.getUser();
      userId = u.user?.id ?? null;
    } catch {
      /* ignore — logging is best-effort */
    }
    await logSaveFailure(error.message, code, retryable, userId, payload, meta);
    return { ok: false, error: error.message, code, retryable };
  }
  return { ok: true, id: data as string };
}

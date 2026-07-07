'use server';

import { createClient } from '@/app/lib/supabase/server';
import { logSaveFailure } from './failures';
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

// Builds the attempt-specific save_failures context blob (the shape the
// inline logger used to write). Kept here so both call sites stay identical.
function attemptFailureContext(
  payload: AttemptPayload,
  meta?: SaveAttemptMeta,
): Record<string, unknown> {
  return {
    testLength: payload.testLength,
    totalQuestions: payload.totalQuestions,
    attemptUuid: meta?.attemptUuid ?? null,
    userAgent: meta?.userAgent ?? null,
  };
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
    await logSaveFailure({
      errorMessage: 'invalid payload',
      errorCode: code,
      retryable: isRetryable(code),
      userId: null,
      attemptNo: meta?.attemptNo,
      context: attemptFailureContext(payload, meta),
    });
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
      breaksUsed: p.breaksUsed ?? false,
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
    await logSaveFailure({
      errorMessage: error.message,
      errorCode: code,
      retryable,
      userId,
      attemptNo: meta?.attemptNo,
      context: attemptFailureContext(payload, meta),
    });
    return { ok: false, error: error.message, code, retryable };
  }
  return { ok: true, id: data as string };
}

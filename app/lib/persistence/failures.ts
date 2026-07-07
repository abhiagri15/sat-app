import { createAdminClient } from '@/app/lib/supabase/admin';

// Server-only diagnostics writer for the sat.save_failures trail. NOT a
// 'use server' module — it exports an interface (which 'use server' forbids)
// and is imported only from server code (persistence/actions.ts,
// practice/actions.ts). Uses the service-role client, so it records even the
// "not authenticated" failure mode where the caller has no usable session.
// SERVER ONLY: it imports createAdminClient (the service-role key) — never
// import this from a 'use client' module.

export interface SaveFailureLog {
  errorMessage: string;
  errorCode: string; // keep the existing SaveErrorCode values for attempts
  retryable: boolean;
  userId?: string | null;
  attemptNo?: number;
  // Caller-built diagnostics blob. Attempts: { testLength, totalQuestions,
  // attemptUuid, userAgent }. Practice: { kind: 'practice', skill }.
  context: Record<string, unknown>;
}

// Best-effort: record a failed save so the root-cause trigger is queryable
// (the failure message used to be console.error'd in the browser and lost).
// Never throws — a logging failure must not mask the real error from the user.
export async function logSaveFailure(log: SaveFailureLog): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.schema('sat').from('save_failures').insert({
      user_id: log.userId ?? null,
      error_message: log.errorMessage.slice(0, 2000),
      error_code: log.errorCode,
      retryable: log.retryable,
      attempt_no: log.attemptNo ?? null,
      context: log.context,
    });
  } catch (e) {
    console.error('[logSaveFailure] failed to log save failure (non-fatal):', e);
  }
}

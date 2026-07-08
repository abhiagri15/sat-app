'use server';

import { z } from 'zod';
import { createClient } from '@/app/lib/supabase/server';

export interface SaveStudyPlanResult {
  ok: boolean;
  error?: string;
}

// Bounds mirror the SQL CHECKs on sat.study_plans (target 400–1600 in steps of
// 10 on the UI, but validated as a plain range here; sessions 2–7). test_date is
// null or a parseable date string; the empty string from an untouched date input
// coerces to null. The RPC (sat.upsert_study_plan) re-validates the bounds and
// sets user_id := auth.uid() itself — this zod pass is the client-facing guard.
const saveStudyPlanSchema = z.object({
  target: z.number().int().min(400).max(1600),
  testDate: z
    .string()
    .nullable()
    .refine(
      (v) => v === null || v === '' || !Number.isNaN(Date.parse(v)),
      { message: 'test date must be a valid date' },
    )
    .transform((v) => (v === '' ? null : v)),
  sessions: z.number().int().min(2).max(7),
  // Captured client-side from Intl.DateTimeFormat().resolvedOptions().timeZone;
  // null when the browser doesn't resolve one. The RPC re-validates the IANA
  // shape and stores as-is (used only inside Intl.DateTimeFormat, which throws →
  // UTC fallback in the week helper), so this pass is a lightweight length guard.
  timezone: z.string().max(64).nullable(),
});

// Upserts the signed-in user's study plan via the sat.upsert_study_plan
// security-definer RPC (the only write path — sat.study_plans has no write
// policy). Returns {ok:true} on success, {ok:false,error} on a validation or RPC
// failure. Never throws.
export async function saveStudyPlan(
  target: number,
  testDate: string | null,
  sessions: number,
  timezone: string | null,
): Promise<SaveStudyPlanResult> {
  const parsed = saveStudyPlanSchema.safeParse({ target, testDate, sessions, timezone });
  if (!parsed.success) {
    return { ok: false, error: 'Please check the target, date, and sessions.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.schema('sat').rpc('upsert_study_plan', {
    p_target: parsed.data.target,
    p_test_date: parsed.data.testDate,
    p_sessions: parsed.data.sessions,
    p_timezone: parsed.data.timezone,
  });
  if (error) {
    console.error('[planner] upsert_study_plan failed:', error.message);
    return { ok: false, error: 'Could not save your plan. Please try again.' };
  }
  return { ok: true };
}

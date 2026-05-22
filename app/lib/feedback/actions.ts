'use server';

import { z } from 'zod';
import { createClient } from '@/app/lib/supabase/server';

const flagSchema = z.object({
  questionId: z.string().min(1),
  reason: z.enum(['wrong_answer', 'unclear', 'typo', 'other']),
  comment: z.string().max(500),
});

export type SubmitFlagResult = { ok: true } | { ok: false; error: string };

// Files a user-reported problem with a pool question. Validates, then calls the
// submit_flag RPC (security definer — it sets user_id from auth.uid()).
export async function submitFlag(input: {
  questionId: string;
  reason: string;
  comment: string;
}): Promise<SubmitFlagResult> {
  const parsed = flagSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Please choose a reason.' };
  }
  const { questionId, reason, comment } = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.schema('sat').rpc('submit_flag', {
    p_question_id: questionId,
    p_reason: reason,
    p_comment: comment,
  });
  if (error) {
    console.error('[submitFlag] failed:', error);
    return { ok: false, error: 'Could not submit the report. Please try again.' };
  }
  return { ok: true };
}

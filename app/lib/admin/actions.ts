'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from './guard';
import { createAdminClient } from '@/app/lib/supabase/admin';

// Enable or disable a pool question. Admin-only. sat.questions is RLS
// write-locked, so the write goes through the service-role client; a disabled
// question is excluded by draw_questions and never served again.
export async function setQuestionEnabled(
  id: string,
  enabled: boolean,
): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .schema('sat')
    .from('questions')
    .update({ enabled })
    .eq('id', id);
  if (error) {
    console.error('[setQuestionEnabled] failed:', error);
    throw new Error('Failed to update the question.');
  }
  revalidatePath('/admin');
  revalidatePath(`/admin/questions/${id}`);
}

// Resolve a question flag. Admin-only; writes via the service-role client
// (question_flags has no RLS policy).
export async function resolveFlag(flagId: string): Promise<void> {
  const profile = await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin
    .schema('sat')
    .from('question_flags')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolved_by: profile.id,
    })
    .eq('id', flagId);
  if (error) {
    console.error('[resolveFlag] failed:', error);
    throw new Error('Failed to resolve the flag.');
  }
  revalidatePath('/admin/flags');
  revalidatePath('/admin');
}

// Update the app-wide daily test-attempt limit (sat.app_config). Admin-only;
// writes via the service-role client (app_config has no write policy).
export async function setDailyAttemptLimit(formData: FormData): Promise<void> {
  await requireAdmin();
  const limit = Number(formData.get('limit'));
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) {
    throw new Error('Daily limit must be a whole number between 0 and 100.');
  }
  const admin = createAdminClient();
  const { error } = await admin
    .schema('sat')
    .from('app_config')
    .update({ daily_attempt_limit: limit, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) {
    console.error('[setDailyAttemptLimit] failed:', error);
    throw new Error('Failed to update the daily limit.');
  }
  revalidatePath('/admin/settings');
  revalidatePath('/');
}

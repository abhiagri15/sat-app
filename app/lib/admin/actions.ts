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

// Set the content-trust review status on a pool question (#19 Trust & Coverage).
// Admin-only; writes via the service-role client (sat.questions is RLS
// write-locked). Only the two ADMIN-settable targets are allowed here —
// 'needs_review' is machine-set by sat.flag_needs_review and must never be an
// admin action (Approve blesses an item; Clear returns a flagged item to
// 'active'). Follows the setQuestionEnabled pattern. review_status is
// orthogonal to `enabled`: only 'needs_review' is excluded from scored draws
// (via draw_questions p_strict), and only for scored tests — drills still serve it.
export async function setReviewStatus(
  questionId: string,
  status: 'active' | 'approved',
): Promise<void> {
  await requireAdmin();
  if (status !== 'active' && status !== 'approved') {
    throw new Error('Invalid review status.');
  }
  const admin = createAdminClient();
  const { error } = await admin
    .schema('sat')
    .from('questions')
    .update({ review_status: status })
    .eq('id', questionId);
  if (error) {
    console.error('[setReviewStatus] failed:', error);
    throw new Error('Failed to update the review status.');
  }
  revalidatePath('/admin/review');
  revalidatePath(`/admin/questions/${questionId}`);
}

// Update the per-section Module 2 routing thresholds. Admin-only; writes
// via the service-role client. Sub-project #11 follow-up.
export async function setModule2Thresholds(formData: FormData): Promise<void> {
  await requireAdmin();
  const rw = Number(formData.get('rw_threshold'));
  const math = Number(formData.get('math_threshold'));
  if (!Number.isInteger(rw) || rw < 0 || rw > 100) {
    throw new Error('R&W threshold must be a whole number between 0 and 100.');
  }
  if (!Number.isInteger(math) || math < 0 || math > 100) {
    throw new Error('Math threshold must be a whole number between 0 and 100.');
  }
  const admin = createAdminClient();
  const { error } = await admin
    .schema('sat')
    .from('app_config')
    .update({
      rw_module2_threshold_pct: rw,
      math_module2_threshold_pct: math,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
  if (error) {
    console.error('[setModule2Thresholds] failed:', error);
    throw new Error('Failed to update the thresholds.');
  }
  revalidatePath('/admin/settings');
}

// Update the difficulty tag on a pool question. Admin-only; writes via the
// service-role client (sat.questions is RLS write-locked). Sub-project #11.
export async function setQuestionDifficulty(
  id: string,
  difficulty: 'easy' | 'medium' | 'hard',
): Promise<void> {
  await requireAdmin();
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    throw new Error('Invalid difficulty.');
  }
  const admin = createAdminClient();
  const { error } = await admin
    .schema('sat')
    .from('questions')
    .update({ difficulty, classified_at: new Date().toISOString() })
    .eq('id', id);
  if (error) {
    console.error('[setQuestionDifficulty] failed:', error);
    throw new Error('Failed to update the difficulty.');
  }
  revalidatePath(`/admin/questions/${id}`);
  revalidatePath('/admin/questions');
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

// Update the per-(section, skill, difficulty) never-served floor that drives
// question replenishment. Admin-only; writes via the service-role client
// (app_config has no write policy). Both the n8n workflow (via the
// sat.generator_state() RPC) and the Vercel cron (via getNeverServedFloor)
// read this value on their next run.
export async function setNeverServedFloor(formData: FormData): Promise<void> {
  await requireAdmin();
  const floor = Number(formData.get('floor'));
  if (!Number.isInteger(floor) || floor < 1 || floor > 100) {
    throw new Error('Floor must be a whole number between 1 and 100.');
  }
  const admin = createAdminClient();
  const { error } = await admin
    .schema('sat')
    .from('app_config')
    .update({ never_served_floor: floor, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) {
    console.error('[setNeverServedFloor] failed:', error);
    throw new Error('Failed to update the floor.');
  }
  revalidatePath('/admin/pool');
  revalidatePath('/admin');
}

// Toggle the app-wide AI kill switch (sat.app_config.ai_enabled, audit C4).
// Admin-only; writes via the service-role client (app_config has no write
// policy). Follows the setDailyAttemptLimit pattern. The checkbox posts "on"
// only when checked, so its ABSENCE means off — do not treat a missing field
// as an error. When disabled, runGeneration still calibrates/flags + writes its
// run row, and every expensive AI entry point returns its graceful no-op shape.
export async function setAiEnabled(formData: FormData): Promise<void> {
  await requireAdmin();
  const enabled = formData.get('ai_enabled') === 'on';
  const admin = createAdminClient();
  const { error } = await admin
    .schema('sat')
    .from('app_config')
    .update({ ai_enabled: enabled, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) {
    console.error('[setAiEnabled] failed:', error);
    throw new Error('Failed to update the AI setting.');
  }
  revalidatePath('/admin/settings');
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

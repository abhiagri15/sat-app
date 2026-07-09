'use server';

// Account deletion — SERVER ONLY. This module imports the service-role client
// (`createAdminClient`), so it is one of the allow-listed service-role modules
// (see CLAUDE.md's AI sub-project gotchas — the service-role file scan). Never
// import it into a 'use client' module.
//
// Ordering is load-bearing: we delete the user's DATA ROWS FIRST and the AUTH
// USER LAST. If any step crashes, the auth user still exists, so the account
// still works and the user (or we) can retry — we never leave a half-deleted
// auth user with orphaned or inaccessible history.
import { redirect } from 'next/navigation';
import { createClient } from '@/app/lib/supabase/server';
import { createAdminClient } from '@/app/lib/supabase/admin';

// User-scoped `sat` tables, deleted in this order. Children cascade via FK:
//   test_attempts     → attempt_responses
//   practice_sessions → practice_responses
// The rest are leaf tables owned per-user. This mirrors e2e/support/cleanup.ts's
// list PLUS profiles (the sat.profiles row itself — deleted last of the rows,
// before the auth user). We intentionally do NOT touch the shared/pool tables.
//
// practice_topups (the top-up rate-cap trail) and save_failures (the save
// diagnostics trail) carry the user's user_id but have NO FK to auth.users,
// so they are NOT cascade-deleted by auth.admin.deleteUser — they must be in
// this list or deleted accounts leave residual rows (found by the 2026-07-09
// erasure-completeness review; the privacy page promises full removal).
// save_failures.user_id is nullable (it records not-authenticated failures
// too) — the .eq() match only removes THIS user's rows, never the null ones.
const USER_SCOPED_TABLES = [
  'test_attempts',
  'practice_sessions',
  'study_plans',
  'served_questions',
  'coach_explains',
  'skill_guidance',
  'practice_topups',
  'save_failures',
  'profiles',
] as const;

export type DeleteAccountResult = { ok: true } | { ok: false; error: string };

// Deletes the signed-in user's account and all of their user-scoped data.
// Returns an error shape on any failure (never throws for an expected failure);
// on success it signs out and redirects to /login (redirect() throws its own
// control-flow signal, which is expected and must not be caught).
export async function deleteAccount(): Promise<DeleteAccountResult> {
  const supabase = await createClient();

  // Verify the session via the auth server (not just a decoded cookie).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'You are not signed in.' };
  }
  const userId = user.id;

  const admin = createAdminClient();

  // 1) Delete data rows first. Any failure here leaves the auth user intact, so
  //    the account keeps working and the delete can be retried.
  for (const table of USER_SCOPED_TABLES) {
    const { error } = await admin
      .schema('sat')
      .from(table)
      .delete()
      .eq(table === 'profiles' ? 'id' : 'user_id', userId);
    if (error) {
      console.error(`[deleteAccount] delete sat.${table} failed:`, error.message);
      return {
        ok: false,
        error: 'We couldn’t delete your data. Nothing was removed — please try again.',
      };
    }
  }

  // 2) Delete the auth user LAST — only after every data row is gone.
  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) {
    console.error('[deleteAccount] auth.admin.deleteUser failed:', authError.message);
    return {
      ok: false,
      error: 'We removed your data but couldn’t finish deleting your account. Please contact support.',
    };
  }

  // 3) Clear the (now-dangling) session cookie and send them to /login.
  await supabase.auth.signOut();
  redirect('/login');
}

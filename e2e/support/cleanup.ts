// Service-role cleanup shared by global-teardown AND global-setup (belt-and-
// suspenders: a prior crashed run whose teardown never fired must not wedge the
// suite against the daily attempt cap). Deletes STRICTLY the test user's rows
// (`user_id = <test user id>`) from the five parent tables — child response
// rows cascade via FK. NEVER touches other users' rows or the question pool.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireEnv, E2E_EMAIL } from './env';

// Parent tables owned per-user; children cascade:
//   test_attempts    → attempt_responses (FK on delete cascade)
//   practice_sessions → practice_responses (FK on delete cascade)
//   study_plans      (leaf)
//   served_questions (leaf — reset so drills draw fresh)
//   coach_explains   (leaf)
//   skill_guidance   (leaf — per-user coaching)
//   practice_topups  (leaf — the top-up cooldown trail; leftover rows from a
//                     prior run can wedge the top-up path against its rate cap)
//   save_failures    (leaf — diagnostics; user_id-scoped rows only)
const USER_SCOPED_TABLES = [
  'test_attempts',
  'practice_sessions',
  'study_plans',
  'served_questions',
  'coach_explains',
  'skill_guidance',
  'practice_topups',
  'save_failures',
] as const;

export function adminClient(): SupabaseClient {
  const { url, serviceKey } = requireEnv();
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

// Resolve the test user's auth id via the admin API (paged listUsers). Returns
// null if the account doesn't exist yet.
export async function findTestUserId(
  admin: SupabaseClient,
): Promise<string | null> {
  // The dev project is small; a single generous page is enough.
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) throw error;
  const user = data.users.find(
    (u) => u.email?.toLowerCase() === E2E_EMAIL.toLowerCase(),
  );
  return user?.id ?? null;
}

// Delete every user-scoped row for the given user id. Idempotent — a no-op when
// the user has no rows. Throws on a real error so a broken teardown is loud.
export async function cleanupUserData(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  for (const table of USER_SCOPED_TABLES) {
    const { error } = await admin
      .schema('sat')
      .from(table)
      .delete()
      .eq('user_id', userId);
    if (error) {
      throw new Error(`cleanup of sat.${table} failed: ${error.message}`);
    }
  }
}

import { loadEnvLocal } from './support/env';
import { adminClient, findTestUserId, cleanupUserData } from './support/cleanup';

// Service-role teardown: delete STRICTLY the test user's rows from the five
// user-scoped parent tables (children cascade), so reruns never hit the daily
// attempt limit and the account stays fresh. Never touches other users' rows or
// the question pool.
export default async function globalTeardown() {
  loadEnvLocal();
  const admin = adminClient();
  const userId = await findTestUserId(admin);
  if (!userId) return; // user never created — nothing to clean.
  await cleanupUserData(admin, userId);
}

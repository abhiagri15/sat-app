import { chromium, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvLocal, E2E_EMAIL, e2ePassword } from './support/env';
import { adminClient, findTestUserId, cleanupUserData } from './support/cleanup';

const STORAGE_STATE = resolve(process.cwd(), 'e2e/.auth/user.json');

// Ensure the dedicated E2E user exists and is email-confirmed. Creates it on
// first run; otherwise updates the password (in case E2E_USER_PASSWORD changed)
// so the UI sign-in below always succeeds. Returns the user id.
async function ensureTestUser(): Promise<string> {
  const admin = adminClient();
  const existing = await findTestUserId(admin);
  if (existing) {
    await admin.auth.admin.updateUserById(existing, {
      password: e2ePassword(),
      email_confirm: true,
    });
    return existing;
  }
  const { data, error } = await admin.auth.admin.createUser({
    email: E2E_EMAIL,
    password: e2ePassword(),
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`could not create E2E user: ${error?.message ?? 'no user returned'}`);
  }
  return data.user.id;
}

export default async function globalSetup(config: FullConfig) {
  loadEnvLocal();

  const userId = await ensureTestUser();

  // Belt-and-suspenders: run the SAME cleanup teardown runs, FIRST, so a prior
  // crashed run (teardown never fired) cannot wedge the suite against the daily
  // attempt cap.
  await cleanupUserData(adminClient(), userId);

  // Sign in through the real UI (#email / #password / submit) so the saved
  // storageState is a genuine browser session, then persist it.
  const baseURL =
    config.projects[0]?.use?.baseURL ?? 'http://localhost:3000';
  mkdirSync(resolve(process.cwd(), 'e2e/.auth'), { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  try {
    await page.goto('/login');
    await page.locator('#email').fill(E2E_EMAIL);
    await page.locator('#password').fill(e2ePassword());
    await page.getByRole('button', { name: 'Sign in' }).click();
    // The login page pushes to '/' on success; wait for the authenticated app
    // to render (the Start screen heading) rather than a bare URL match.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
      timeout: 45_000,
    });
    await page
      .getByRole('heading', { name: 'SAT Practice Test' })
      .waitFor({ timeout: 45_000 });
    await page.context().storageState({ path: STORAGE_STATE });
  } finally {
    await browser.close();
  }
}

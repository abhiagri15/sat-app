import { defineConfig, devices } from '@playwright/test';

// Playwright E2E config (design spec §D). Local gate only — NOT part of the
// check-script battery and there is no CI. Requires `.env.local` (service-role
// key for the setup/teardown user provisioning) and a one-time
// `pnpm dlx playwright install chromium`.
//
// - baseURL http://localhost:3000; webServer spawns `pnpm dev` and reuses an
//   already-running dev server if one is up.
// - workers: 1, retries: 0 — the whole suite shares ONE Supabase account and
//   is subject to the per-user daily attempt limit, so specs must run serially.
// - global setup provisions + signs in the test user and saves storageState;
//   global teardown deletes that user's rows so reruns never hit the cap.
export default defineConfig({
  testDir: './e2e',
  // The auth setup writes storageState; specs read it. Serial, single worker.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Draw RPCs (pool assembly) can be slow; keep per-test and expect timeouts
  // generous so pool latency never flakes a spec.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    // The signed-in session saved by global-setup.
    storageState: 'e2e/.auth/user.json',
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    // Next.js dev cold-start + first compile can be slow.
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

// Manual .env.local loader — mirrors the seed-questions.ts pattern (the E2E
// harness runs in a plain node context, NOT Next.js, so process.env is not
// pre-populated). Reads KEY=VALUE lines, ignoring blanks/comments, and only
// sets keys that aren't already present in the environment.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let loaded = false;

export function loadEnvLocal(): void {
  if (loaded) return;
  loaded = true;
  const path = resolve(process.cwd(), '.env.local');
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    // No .env.local — rely on whatever is already in process.env.
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip surrounding quotes if present.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

// The dedicated E2E account. Password comes from E2E_USER_PASSWORD or a fixed
// dev-only default (this account only ever exists on the shared dev DB).
export const E2E_EMAIL = 'sat-e2e@example.com';

export function e2ePassword(): string {
  return process.env.E2E_USER_PASSWORD ?? 'e2e-Sat-Pass-1!';
}

export function requireEnv(): { url: string; serviceKey: string } {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'E2E setup needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local',
    );
  }
  return { url, serviceKey };
}

// Guardrail (sub-project #21 discipline): the PLAYWRIGHT suite runs against
// the LOCAL Supabase stack ONLY — its setup creates/deletes the test user and
// runs service-role cleanup, so if .env.local ever points at a cloud project
// (e.g. prod creds pasted in during an incident) it must refuse loudly rather
// than mutate it. Called from the Playwright global-setup/teardown — NOT from
// requireEnv(), because the live smokes (scripts/smoke-live-rpcs.ts,
// smoke-lying-save.ts) share requireEnv and are DELIBERATELY pointed at prod
// via --env-file=.env.operator-prod. Override with E2E_ALLOW_REMOTE_SUPABASE=1
// only when deliberately targeting a disposable remote stack.
export function assertLocalSupabase(url: string): void {
  const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(url);
  if (!isLocal && process.env.E2E_ALLOW_REMOTE_SUPABASE !== '1') {
    throw new Error(
      `E2E refuses to run against a non-local Supabase URL (${url}). ` +
        'Point .env.local at the local stack (npx supabase start), or set ' +
        'E2E_ALLOW_REMOTE_SUPABASE=1 to override deliberately.',
    );
  }
}

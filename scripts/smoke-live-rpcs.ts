/* Live smoke: prove every user-facing RPC resolves and returns sanely against
 * the LIVE database — the repeatable post-migration check. Run:
 *   pnpm dlx tsx scripts/smoke-live-rpcs.ts
 * (loads .env.local itself; needs the service-role key + anon key)
 *
 * How it authenticates: signs in as the dedicated E2E account
 * (sat-e2e@example.com — created if missing, same as e2e/global-setup), so the
 * authenticated checks exercise the REAL grant + RLS path a student hits. The
 * two service-role-only reads use the admin client. This is specifically the
 * regression net for the OVERLOAD RULE (PGRST203): `draw_questions` and
 * `upsert_study_plan` are called with the app's exact named-arg shapes, so a
 * surviving old overload after a future migration fails HERE, not in prod.
 *
 * Side effects are confined to the E2E user and cleaned up afterward via the
 * shared e2e cleanup (study_plans, served_questions, ...). Deliberately NOT
 * covered: save_attempt / save_practice (the Playwright suite exercises them
 * end-to-end through the UI) and calibrate_difficulty / flag_needs_review
 * (service-only WRITES that relabel real pool rows — the daily cron owns
 * those; a repeatable smoke must not mutate the question pool).
 */
import { createClient } from '@supabase/supabase-js';
import { loadEnvLocal, requireEnv, E2E_EMAIL, e2ePassword } from '../e2e/support/env';
import { adminClient, findTestUserId, cleanupUserData } from '../e2e/support/cleanup';

interface Check {
  name: string;
  run: () => Promise<string>; // resolves to a short detail, throws on failure
}

async function main() {
  loadEnvLocal();
  const { url } = requireEnv();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error('needs NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local');

  const admin = adminClient();

  // Ensure the dedicated E2E account exists (mirrors e2e/global-setup).
  let userId = await findTestUserId(admin);
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email: E2E_EMAIL,
      password: e2ePassword(),
      email_confirm: true,
    });
    if (error) throw new Error(`could not create E2E user: ${error.message}`);
    userId = data.user.id;
  }

  const user = createClient(url, anonKey, { auth: { persistSession: false } });
  const signIn = await user.auth.signInWithPassword({
    email: E2E_EMAIL,
    password: e2ePassword(),
  });
  if (signIn.error) throw new Error(`E2E sign-in failed: ${signIn.error.message}`);

  const sat = () => user.schema('sat');
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    const { data, error } = await sat().rpc(name, args);
    if (error) throw new Error(`${name}: ${error.code ?? ''} ${error.message}`);
    return data;
  };

  const checks: Check[] = [
    {
      // The app's exact named-arg call from pool.ts — the PGRST203 canary.
      name: 'draw_questions (strict, named args)',
      run: async () => {
        const data = await rpc('draw_questions', {
          p_section: 'math',
          p_skill: null,
          p_skills: null,
          p_difficulty: null,
          p_count: 3,
          p_strict: true,
        });
        const n = Array.isArray(data) ? data.length : 0;
        if (n < 1) throw new Error('returned no questions');
        return `${n} questions`;
      },
    },
    {
      name: 'draw_drill',
      run: async () => {
        const data = await rpc('draw_drill', {
          p_skill: 'Linear Equations',
          p_count: 3,
        });
        const n = Array.isArray(data) ? data.length : 0;
        if (n < 1) throw new Error('returned no questions');
        return `${n} questions`;
      },
    },
    {
      name: 'practice_skill_stats',
      run: async () => `${((await rpc('practice_skill_stats')) as unknown[]).length} rows`,
    },
    {
      // Returns a JSON document (not a row set) — report its shape, not a count.
      name: 'user_analytics',
      run: async () => {
        const data = await rpc('user_analytics');
        return Array.isArray(data) ? `${data.length} rows` : `json ${typeof data}`;
      },
    },
    {
      name: 'user_pacing',
      run: async () => `${((await rpc('user_pacing')) as unknown[]).length} rows`,
    },
    {
      name: 'skill_evidence',
      run: async () =>
        `${((await rpc('skill_evidence', { p_skill: 'Linear Equations', p_limit: 5 })) as unknown[]).length} rows`,
    },
    {
      name: 'skill_latest_response',
      run: async () =>
        `latest=${JSON.stringify(await rpc('skill_latest_response', { p_skill: 'Linear Equations' }))}`,
    },
    {
      name: 'unseen_count_for_skill',
      run: async () => {
        const n = await rpc('unseen_count_for_skill', { p_skill: 'Linear Equations' });
        if (typeof n !== 'number') throw new Error(`expected a number, got ${typeof n}`);
        return `unseen=${n}`;
      },
    },
    {
      name: 'miss_reason_mix',
      run: async () => `${((await rpc('miss_reason_mix')) as unknown[]).length} rows`,
    },
    {
      // Documented contract: silent no-op (returns false) on a non-matching id.
      name: 'tag_miss_reason (no-op on foreign id)',
      run: async () => {
        const data = await rpc('tag_miss_reason', {
          p_origin: 'practice',
          p_response_id: '00000000-0000-4000-8000-0000000000ff',
          p_reason: 'careless',
        });
        if (data !== false) throw new Error(`expected false, got ${JSON.stringify(data)}`);
        return 'no-op returned false';
      },
    },
    {
      // The app's exact 4-arg named call — the other PGRST203 canary. The row
      // is the E2E user's own and is wiped in the cleanup below.
      name: 'upsert_study_plan (with timezone)',
      run: async () => {
        await rpc('upsert_study_plan', {
          p_target: 1400,
          p_test_date: '2027-06-01',
          p_sessions: 3,
          p_timezone: 'America/New_York',
        });
        const { data, error } = await sat()
          .from('study_plans')
          .select('target_score, timezone')
          .maybeSingle();
        if (error) throw new Error(`readback failed: ${error.message}`);
        if (data?.target_score !== 1400 || data?.timezone !== 'America/New_York') {
          throw new Error(`readback mismatch: ${JSON.stringify(data)}`);
        }
        return 'upserted + read back';
      },
    },
    {
      name: 'admin_review_queue (service role)',
      run: async () => {
        const { data, error } = await admin
          .schema('sat')
          .rpc('admin_review_queue', { p_limit: 5 });
        if (error) throw new Error(`${error.code ?? ''} ${error.message}`);
        return `${(data as unknown[]).length} rows`;
      },
    },
    {
      name: 'min_active_user_unseen (service role)',
      run: async () => {
        const { data, error } = await admin.schema('sat').rpc('min_active_user_unseen');
        if (error) throw new Error(`${error.code ?? ''} ${error.message}`);
        return `min_unseen=${JSON.stringify(data)}`;
      },
    },
  ];

  let failures = 0;
  for (const check of checks) {
    try {
      const detail = await check.run();
      console.log(`ok   ${check.name} — ${detail}`);
    } catch (err) {
      failures += 1;
      console.error(`FAIL ${check.name} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Same scoped cleanup the E2E suite uses (draws marked served_questions and
  // the upsert wrote a study_plans row — all confined to the E2E user).
  await cleanupUserData(admin, userId);

  console.log(
    failures === 0
      ? `\nall ${checks.length} live RPC checks passed`
      : `\n${failures}/${checks.length} live RPC checks FAILED`,
  );
  return failures === 0;
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  },
);

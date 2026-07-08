/* Live smoke: prove the explanation cache — first call generates (AI),
 * second returns cached instantly without touching the daily cap. Run:
 *   pnpm dlx tsx --env-file=.env.local scripts/smoke-explain-cache.ts
 *
 * Self-cleaning: synthetic rows (the fake question id + the two fake user
 * ids below) are deleted before AND after the run, so reruns are
 * deterministic and a killed run never leaves rows behind. Each explain
 * call is raced against a hard timeout so an Ollama Cloud latency spike
 * fails fast with a clear message instead of hanging the shell.
 */
import { createAdminClient } from '../app/lib/supabase/admin';
import { explainForUser } from '../app/lib/practice/generation';

const QUESTION_ID = 'smoke-cache-question';
const USER_A = '00000000-0000-4000-8000-00000000000a';
const USER_B = '00000000-0000-4000-8000-00000000000b';
const CALL_TIMEOUT_MS = 120_000;

const input = {
  questionId: QUESTION_ID,
  section: 'math' as const,
  skill: 'Linear Equations',
  prompt: 'If 4x - 3 = 13, what is the value of x?',
  choices: ['2', '4', '10/4', '16/4'],
  correctText: '4',
  chosenText: '10/4',
  responseFormat: 'mcq' as const,
  trusted: true,
};

async function cleanup() {
  const admin = createAdminClient();
  await admin
    .schema('sat')
    .from('mistake_explanations')
    .delete()
    .eq('question_id', QUESTION_ID);
  await admin
    .schema('sat')
    .from('coach_explains')
    .delete()
    .in('user_id', [USER_A, USER_B]);
}

function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `${label} exceeded ${CALL_TIMEOUT_MS / 1000}s — likely an Ollama Cloud latency spike; rerun later`,
            ),
          ),
        CALL_TIMEOUT_MS,
      ),
    ),
  ]);
}

async function main() {
  await cleanup(); // a prior partial run must not pre-populate the cache

  const t0 = Date.now();
  const first = await withTimeout(explainForUser(USER_A, input), 'first call (AI generation)');
  const firstSecs = Math.round((Date.now() - t0) / 1000);

  const t1 = Date.now();
  // different user, same mistake — must hit the shared cache
  const second = await withTimeout(explainForUser(USER_B, input), 'second call (cache hit)');
  const secondMs = Date.now() - t1;

  console.log(
    `first:  ${first.status} cached=${'cached' in first ? first.cached : '?'} in ${firstSecs}s`,
  );
  console.log(
    `second: ${second.status} cached=${'cached' in second ? second.cached : '?'} in ${secondMs}ms`,
  );

  const ok =
    first.status === 'ok' &&
    second.status === 'ok' &&
    (second as { cached?: boolean }).cached === true &&
    secondMs < 2000;
  return ok;
}

main()
  .then(
    (ok) => (ok ? 0 : 1),
    (err) => {
      console.error(String(err instanceof Error ? err.message : err));
      return 1;
    },
  )
  .then(async (code) => {
    try {
      await cleanup(); // never leave synthetic rows in live tables
    } catch (err) {
      console.error('cleanup failed:', String(err));
      code = 1;
    }
    process.exit(code); // hard exit — a timed-out fetch may still be pending
  });

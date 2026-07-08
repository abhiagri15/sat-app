/* One-off smoke: prove the explanation cache — first call generates (AI),
 * second returns cached instantly without touching the daily cap. Run:
 *   pnpm dlx tsx --env-file=.env.local scripts/smoke-explain-cache.ts
 */
import { explainForUser } from '../app/lib/practice/generation';

const input = {
  questionId: 'smoke-cache-question',
  section: 'math' as const,
  skill: 'Linear Equations',
  prompt: 'If 4x - 3 = 13, what is the value of x?',
  choices: ['2', '4', '10/4', '16/4'],
  correctText: '4',
  chosenText: '10/4',
  responseFormat: 'mcq' as const,
  trusted: true,
};

async function main() {
  const userA = '00000000-0000-4000-8000-00000000000a';
  const userB = '00000000-0000-4000-8000-00000000000b';

  const t0 = Date.now();
  const first = await explainForUser(userA, input);
  const firstSecs = Math.round((Date.now() - t0) / 1000);

  const t1 = Date.now();
  const second = await explainForUser(userB, input); // different user, same mistake
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
  if (!ok) process.exit(1);
}

main();

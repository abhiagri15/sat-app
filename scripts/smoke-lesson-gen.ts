/* One-off smoke: exercise ensureBaseLesson end-to-end against Ollama Cloud +
 * the live DB. Not part of the app. Run:
 *   pnpm dlx tsx --env-file=.env.local scripts/smoke-lesson-gen.ts
 */
import { ensureBaseLesson } from '../app/lib/practice/generation';

async function main() {
  const t0 = Date.now();
  const result = await ensureBaseLesson('rw', 'Transitions');
  console.log(
    `ensureBaseLesson('rw', 'Transitions') -> ${JSON.stringify(result)} in ${
      Math.round((Date.now() - t0) / 1000)
    }s`,
  );
  if (result.status === 'failed') process.exit(1);
}

main();

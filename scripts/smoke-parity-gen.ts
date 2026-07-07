/* One-off smoke: exercise the parity-pack AI paths end-to-end against Ollama
 * Cloud + the live DB. Not part of the app. Run:
 *   pnpm dlx tsx --env-file=.env.local scripts/smoke-parity-gen.ts
 */
import { generateBatchForSkill } from '../app/lib/ai/generate';
import { explainForUser } from '../app/lib/practice/generation';

async function main() {
  // 1. Figure-bearing generation: Scatterplots & Models has FIGURE_PROBABILITY
  //    0.5 — run one batch of 2 and report whether a figure landed.
  const t0 = Date.now();
  const batch = await generateBatchForSkill('math', 'Scatterplots & Models', 2, 'medium');
  console.log(
    `generateBatchForSkill(math, Scatterplots & Models, 2) -> ${JSON.stringify(batch)} in ${
      Math.round((Date.now() - t0) / 1000)
    }s`,
  );

  // 2. Explain-my-mistake, direct module call (route needs a browser session).
  const t1 = Date.now();
  const explain = await explainForUser('00000000-0000-4000-8000-000000000001', {
    questionId: 'smoke-question-id',
    section: 'math',
    skill: 'Linear Equations',
    prompt: 'If 3x + 5 = 20, what is the value of x?',
    choices: ['3', '5', '15/3', '25/3'],
    correctText: '5',
    chosenText: '25/3',
    responseFormat: 'mcq',
    trusted: true,
  });
  const summary =
    explain.status === 'ok'
      ? `ok (${explain.explanation.length} chars, takeaway: "${explain.takeaway}")`
      : JSON.stringify(explain);
  console.log(`explainForUser -> ${summary} in ${Math.round((Date.now() - t1) / 1000)}s`);

  if (batch.accepted === 0 && explain.status !== 'ok') process.exit(1);
}

main();
